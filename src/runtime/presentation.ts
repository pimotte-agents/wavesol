// The projector-side presentation: mounts nodes on one world canvas, draws edges, runs the camera and
// applies navigation intents. UI chrome (panels, help) subscribes to its state from React.
import type { CompiledEdge, CompiledNode, CompiledTalk } from "../model/compiled.ts";
import type { NodeInstance, RuntimePlugin } from "../plugins/types.ts";
import { Animator, fitBox, panBy, zoomAt, type Box, type View } from "./camera.ts";
import { NavGraph, initialState, navigate, type Intent, type NavState } from "./nav.ts";

const NODE_MARGIN = 0.03;
const OVERVIEW_MARGIN = 0.05;
/** Slides narrower than this on screen show a title card instead of their content. */
const FAR_PX = 300;
/** Pointer travel (px) after which a press in the overview is a drag, not a click. */
const DRAG_PX = 5;
const DRAG_KEY = "wavesol:drag-mode";
/** Fraction of the remaining distance the laser dot covers per frame. */
const LASER_EASE = 0.35;
/** The laser dot hides after this long without an update. */
const LASER_IDLE_MS = 4000;
/** The laser selects what it rests on this long (e.g. a Lean tactic). */
/** A swipe: at least this far sideways (screen px), and mostly sideways. */
const SWIPE_PX = 50;
const LASER_DWELL_MS = 100;

export interface PresentationState {
  nav: NavState;
  overview: boolean;
  node: CompiledNode;
  outgoing: { edge: CompiledEdge; target: CompiledNode }[];
  /** A detail of the current step the laser selected (e.g. a Lean tactic), until the next navigation. */
  focus?: number;
  /** Drag mode (wavesol dev): dragging nodes pins them. */
  dragMode: boolean;
  /** The screen is black (b). */
  blackout: boolean;
}

export class Presentation {
  readonly graph: NavGraph;
  private nodes = new Map<string, CompiledNode>();
  private els = new Map<string, HTMLElement>();
  private instances = new Map<string, NodeInstance>();
  private edgePaths: { edge: CompiledEdge; el: SVGGElement }[] = [];
  private stage: HTMLElement;
  private world: HTMLElement;
  private animator: Animator;
  private view: View = { cx: 0, cy: 0, w: 1 };
  private nav: NavState;
  private overview = false;
  /** Set once the current overview press has moved far enough to be a pan; suppresses the click. */
  private dragged = false;
  private dragging = false;
  private black = false;
  private blackLayer: HTMLElement;
  private listeners = new Set<(s: PresentationState) => void>();
  private laser: HTMLElement;
  /** Laser pointer: where it is drawn, where it is heading (screen px), and when it last moved. */
  private laserAt?: { x: number; y: number };
  private laserTarget?: { x: number; y: number };
  private laserMoved = 0;
  private laserFrame = 0;
  private focus?: number;
  /** The references node with works marked by a citation click. */
  private marked?: string;
  private dwellKey?: string;
  private dwellSince = 0;
  private dwellDone = false;
  /** Screen space the touch bars take at the top and bottom; the camera fits nodes between them. */
  private insets = { top: 0, bottom: 0 };

  constructor(
    root: HTMLElement,
    readonly talk: CompiledTalk,
    plugins: Record<string, RuntimePlugin>,
  ) {
    this.graph = new NavGraph(talk);
    for (const n of talk.nodes) this.nodes.set(n.id, n);

    this.stage = el("div", "ws-stage");
    this.world = el("div", "ws-world");
    this.laser = el("div", "ws-laser");
    this.blackLayer = el("div", "ws-blackout");
    this.blackLayer.hidden = true;
    this.stage.append(this.world, this.laser);
    root.append(this.stage);
    document.body.append(this.blackLayer); // above the stage and the UI panels

    // Paint order per depth d: edges whose shallower endpoint is at depth d, then the nodes at depth d.
    // So frames cover edges that pass behind them, while edges between their children stay visible.
    const edgeLayers = this.drawEdges();
    for (const n of [...talk.nodes].sort((a, b) => a.depth - b.depth)) {
      const layer = edgeLayers.get(n.depth);
      if (layer) {
        this.world.append(layer);
        edgeLayers.delete(n.depth);
      }
      const nodeEl = el("div", `ws-node ws-type-${n.type}`);
      nodeEl.dataset.id = n.id;
      Object.assign(nodeEl.style, { width: `${n.size[0]}px`, height: `${n.size[1]}px`, transform: `translate(${n.x}px, ${n.y}px) scale(${n.scale})` });
      const content = el("div", "ws-content");
      const far = el("div", "ws-far-title");
      far.textContent = n.title;
      nodeEl.append(content, far);
      this.world.append(nodeEl);
      this.els.set(n.id, nodeEl);
      const plugin = plugins[n.type];
      if (plugin) {
        const inst = plugin.mount(content, n, { requestStep: (step) => this.dispatch({ type: "goto", node: n.id, step }) });
        inst.setStep(0, { animate: false });
        this.instances.set(n.id, inst);
      }
      nodeEl.addEventListener("click", (e) => {
        if (!this.overview || this.dragged || this.dragMode) return;
        e.stopPropagation();
        this.dispatch({ type: "goto", node: n.id });
      });
    }

    this.animator = new Animator({
      apply: (v) => this.applyView(v),
      setOpacity: (o) => (this.world.style.opacity = String(o)),
      moving: (on) => (this.world.style.willChange = on ? "transform" : "auto"),
    });

    this.bindCitations();
    this.bindNodeLinks();
    this.bindSwipe();
    this.bindNodeDrag(); // before pan/zoom, so a node drag isn't also a pan
    this.bindPanZoom();

    this.nav = initialState(this.graph, parseHash(location.hash) ?? { node: talk.start, step: 0 }, talk.start);
    this.instances.get(this.nav.node)?.setStep(this.nav.step, { animate: false });
    this.applyView(this.targetView());
    this.restoreDragMode();
    this.writeHash();

    window.addEventListener("resize", () => this.applyView(this.targetView()));
    window.addEventListener("hashchange", () => {
      const pos = parseHash(location.hash);
      if (pos && (pos.node !== this.nav.node || pos.step !== this.nav.step)) this.dispatch({ type: "goto", ...pos });
    });
  }

  get state(): PresentationState {
    const node = this.nodes.get(this.nav.node)!;
    return {
      nav: this.nav,
      overview: this.overview,
      node,
      outgoing: this.graph.outgoing(node.id).map((edge) => ({ edge, target: this.nodes.get(edge.to)! })),
      ...(this.focus !== undefined ? { focus: this.focus } : {}),
      dragMode: this.dragging,
      blackout: this.black,
    };
  }

  subscribe(fn: (s: PresentationState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Applies a navigation intent (keyboard now; presenter view and phone later). */
  dispatch(intent: Intent): void {
    const wasOverview = this.overview;
    this.overview = false; // any navigation leaves the overview
    const result = navigate(this.graph, this.nav, intent);
    // leaving the references slide clears the works a citation click marked there
    if (result.kind === "move" && this.marked !== undefined) {
      this.instances.get(this.marked)?.mark?.([]);
      this.marked = undefined;
    }
    if (result.kind !== "none" && this.focus !== undefined) {
      this.focus = undefined;
      this.instances.get(this.nav.node)?.setFocus?.(undefined);
    }
    this.nav = result.state;
    if (result.kind === "move") this.instances.get(this.nav.node)?.setStep(this.nav.step, { animate: false });
    if (result.kind === "step") this.instances.get(this.nav.node)?.setStep(this.nav.step, { animate: true });
    if (result.kind === "move" || wasOverview !== this.overview) {
      void this.animator.run(this.view, this.targetView(), result.transition ?? "fly");
    }
    this.writeHash();
    this.emit();
  }

  toggleOverview(on = !this.overview): void {
    if (on === this.overview) return;
    this.overview = on;
    void this.animator.run(this.view, this.targetView(), on ? { type: "fly", duration: 900 } : this.graph.transitionTo(this.nav.node));
    this.emit();
  }

  /** Zooms the overview around the screen center; ignored outside the overview. */
  zoomOverview(factor: number): void {
    if (!this.overview) return;
    const { vw, vh } = this.viewport();
    this.setOverviewView(zoomAt(this.view, factor, vw / 2, vh / 2, vw, vh));
  }

  /** Applies a user pan/zoom, cancelling any transition and keeping the view on the talk. */
  private setOverviewView(v: View) {
    this.animator.stop();
    const { vw, vh } = this.viewport();
    const fit = fitBox(bounds(this.talk.nodes.filter((n) => n.depth === 0)), vw, vh, OVERVIEW_MARGIN);
    const minW = Math.min(...this.talk.nodes.map((n) => n.w)) / (1 - 2 * NODE_MARGIN);
    const w = Math.min(Math.max(v.w, minW), fit.w * 2);
    // the view's center may roam over the area the fitted overview shows, no further
    const halfW = fit.w / 2;
    const halfH = (fit.w * vh) / vw / 2;
    const clamp = (x: number, c: number, r: number) => Math.min(Math.max(x, c - r), c + r);
    this.applyView({ cx: clamp(v.cx, fit.cx, halfW), cy: clamp(v.cy, fit.cy, halfH), w });
  }

  /** Clicking a citation flies to the references slide (if the talk has one), with the cited works marked. */
  private bindCitations() {
    const refs = this.talk.nodes.find((n) => n.type === "references");
    if (!refs) return;
    this.stage.classList.add("ws-has-references");
    this.world.addEventListener("click", (e) => {
      if (this.overview || this.dragging) return;
      const cite = (e.target as Element).closest<HTMLElement>(".ws-cite[data-keys]");
      if (!cite) return;
      e.stopPropagation();
      this.dispatch({ type: "goto", node: refs.id });
      this.marked = refs.id;
      this.instances.get(refs.id)?.mark?.(cite.dataset.keys!.split(" "));
    });
  }

  /** [text](#node-id) links fly to that node, like taking an edge (Back returns). */
  private bindNodeLinks() {
    this.world.addEventListener("click", (e) => {
      if (this.overview || this.dragging) return;
      const link = (e.target as Element).closest<HTMLElement>("a.ws-node-link[data-node]");
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      this.dispatch({ type: "goto", node: link.dataset.node! });
    });
  }

  /**
   * Touch: a horizontal swipe from right to left is next (like Space), from left to right previous
   * (like ←). Not in the overview, where dragging pans, nor when it starts on something to tap.
   */
  private bindSwipe() {
    let start: { id: number; x: number; y: number; t: number } | undefined;
    this.stage.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || !e.isPrimary || this.overview || this.dragging) return void (start = undefined);
      if ((e.target as Element).closest("a, button, input, textarea, .ws-tac, .ws-cite")) return void (start = undefined);
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    });
    this.stage.addEventListener("pointercancel", () => (start = undefined));
    this.stage.addEventListener("pointerup", (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const quick = performance.now() - start.t < 800;
      start = undefined;
      if (!quick || Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
      this.dispatch({ type: dx < 0 ? "step" : "prev" });
    });
  }

  /** Reserves screen space at the top and bottom (touch bars): nodes are fitted between them. */
  setInsets(top: number, bottom: number): void {
    if (top === this.insets.top && bottom === this.insets.bottom) return;
    this.insets = { top, bottom };
    this.animator.stop();
    this.applyView(this.targetView());
  }

  /** Drag mode (`wavesol dev` only): dragging a node pins it there, written to talk.yaml by the dev server. */
  get dragMode(): boolean {
    return this.dragging;
  }

  setDragMode(on: boolean): void {
    if (!import.meta.env.DEV || on === this.dragging) return;
    this.dragging = on;
    this.stage.classList.toggle("ws-drag-mode", on);
    this.emit();
  }

  /** After the reload that follows a pin, come back in drag mode with the same view. */
  private restoreDragMode() {
    if (!import.meta.env.DEV) return;
    let saved: { overview: boolean; view: View } | undefined;
    try {
      saved = JSON.parse(sessionStorage.getItem(DRAG_KEY) ?? "null") ?? undefined;
      sessionStorage.removeItem(DRAG_KEY);
    } catch {
      return;
    }
    if (!saved) return;
    this.overview = saved.overview;
    this.setDragMode(true);
    this.applyView(saved.view);
  }

  private bindNodeDrag() {
    if (!import.meta.env.DEV) return;
    const stage = this.stage;
    let drag: { id: string; nodes: CompiledNode[]; start: { x: number; y: number }; d: { x: number; y: number } } | undefined;
    const place = (n: CompiledNode, dx: number, dy: number) => {
      this.els.get(n.id)!.style.transform = `translate(${n.x + dx}px, ${n.y + dy}px) scale(${n.scale})`;
    };
    stage.addEventListener("pointerdown", (e) => {
      if (!this.dragging || (e.pointerType === "mouse" && e.button !== 0)) return;
      const id = (e.target as Element).closest<HTMLElement>(".ws-node")?.dataset.id;
      if (!id) return;
      e.stopImmediatePropagation();
      // a frame takes everything inside it along
      const inside = (n: CompiledNode): boolean => n.id === id || (n.parent !== undefined && inside(this.nodes.get(n.parent)!));
      drag = { id, nodes: this.talk.nodes.filter(inside), start: { x: e.clientX, y: e.clientY }, d: { x: 0, y: 0 } };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      e.stopImmediatePropagation();
      const k = this.viewport().vw / this.view.w; // screen px per world unit
      drag.d = { x: (e.clientX - drag.start.x) / k, y: (e.clientY - drag.start.y) / k };
      for (const n of drag.nodes) place(n, drag.d.x, drag.d.y);
    });
    const end = (e: PointerEvent) => {
      if (!drag) return;
      e.stopImmediatePropagation();
      const { id, nodes, d } = drag;
      drag = undefined;
      const moved = Math.hypot(d.x, d.y) * (this.viewport().vw / this.view.w) >= DRAG_PX;
      const node = this.nodes.get(id)!;
      if (!moved) return;
      try {
        sessionStorage.setItem(DRAG_KEY, JSON.stringify({ overview: this.overview, view: this.view }));
      } catch {
        // the reload then just doesn't keep drag mode
      }
      // the dev server writes the pin into talk.yaml; its watcher then rebuilds and reloads the page
      void fetch("__wavesol/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node: id, at: [node.x + d.x, node.y + d.y] }),
      }).then(
        (r) => r.ok || Promise.reject(new Error(`${r.status}`)),
      ).catch((err) => {
        console.error(`could not pin ${id}:`, err);
        for (const n of nodes) place(n, 0, 0);
      });
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  }

  /** Overview only: wheel or pinch zooms around the pointer, dragging pans. */
  private bindPanZoom() {
    const stage = this.stage;
    stage.addEventListener(
      "wheel",
      (e) => {
        if (!this.overview) return;
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? r.height : 1;
        // ctrlKey marks a trackpad pinch, whose deltas are much smaller than wheel ticks
        const factor = Math.exp(e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.0015));
        const { vw, vh } = this.viewport();
        this.setOverviewView(zoomAt(this.view, factor, e.clientX - r.left, e.clientY - r.top, vw, vh));
      },
      { passive: false },
    );

    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | undefined;
    const centroid = () => {
      const ps = [...pointers.values()];
      const x = ps.reduce((s, p) => s + p.x, 0) / ps.length;
      const y = ps.reduce((s, p) => s + p.y, 0) / ps.length;
      return { x, y, spread: ps.length > 1 ? Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y) : 0 };
    };
    stage.addEventListener("pointerdown", (e) => {
      if (!this.overview || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (pointers.size === 0) {
        this.dragged = false;
        start = { x: e.clientX, y: e.clientY };
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    stage.addEventListener("pointermove", (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev || !this.overview) return;
      if (!this.dragged && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_PX) return;
      if (!this.dragged) {
        this.dragged = true;
        stage.classList.add("ws-panning");
        // capture only once it is a drag: capturing on press would retarget the click away from the node
        for (const id of pointers.keys()) if (!stage.hasPointerCapture(id)) stage.setPointerCapture(id);
      }
      const before = centroid();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = centroid();
      const r = stage.getBoundingClientRect();
      const { vw, vh } = this.viewport();
      let v = panBy(this.view, after.x - before.x, after.y - before.y, vw);
      if (before.spread > 0 && after.spread > 0) v = zoomAt(v, before.spread / after.spread, after.x - r.left, after.y - r.top, vw, vh);
      this.setOverviewView(v);
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) stage.classList.remove("ws-panning");
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  }

  /**
   * Shows the laser pointer at a normalised position of the screen ([0,1]², from a phone), or hides it.
   * Updates arrive throttled (and over a relay, unevenly), so the dot glides towards each new target.
   */
  setPointer(at: [number, number] | null): void {
    if (!at) {
      this.laserTarget = undefined;
      return this.drawLaser();
    }
    const { vw, vh } = this.viewport();
    const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.laserTarget = { x: clamp(at[0]) * vw, y: clamp(at[1]) * vh };
    this.laserMoved = performance.now();
    this.laserAt ??= this.laserTarget;
    if (!this.laserFrame) this.laserFrame = requestAnimationFrame(() => this.drawLaser());
  }

  /**
   * The laser rests on the current node: after LASER_DWELL_MS on the same target, the node's plugin
   * says what to select (a Lean tactic: its step, maybe a focus), once per target. Sweeping across
   * selects nothing.
   */
  private dwell(at: { x: number; y: number }) {
    const now = performance.now();
    const r = this.stage.getBoundingClientRect();
    const hit = this.overview ? null : document.elementFromPoint(r.left + at.x, r.top + at.y);
    const inst = hit?.closest<HTMLElement>(".ws-node")?.dataset.id === this.nav.node ? this.instances.get(this.nav.node) : undefined;
    const target = hit ? inst?.pointAt?.(hit) : undefined;
    const key = target && JSON.stringify(target);
    if (key !== this.dwellKey) {
      this.dwellKey = key;
      this.dwellSince = now;
      this.dwellDone = false;
      return;
    }
    if (!target || this.dwellDone || now - this.dwellSince < LASER_DWELL_MS) return;
    this.dwellDone = true;
    if (target.step !== this.nav.step) this.dispatch({ type: "goto", node: this.nav.node, step: target.step });
    if (target.focus !== this.focus) {
      this.focus = target.focus;
      inst!.setFocus?.(target.focus);
      this.emit();
    }
  }

  private drawLaser() {
    this.laserFrame = 0;
    const t = this.laserTarget;
    // a phone that stops sending (dropped connection) must not leave the dot on screen
    if (!t || performance.now() - this.laserMoved > LASER_IDLE_MS) {
      this.laserAt = this.laserTarget = undefined;
      this.laser.classList.remove("ws-on");
      return;
    }
    const a = this.laserAt!;
    a.x += (t.x - a.x) * LASER_EASE;
    a.y += (t.y - a.y) * LASER_EASE;
    this.laser.style.transform = `translate(${a.x}px, ${a.y}px)`;
    this.laser.classList.add("ws-on");
    this.dwell(a);
    this.laserFrame = requestAnimationFrame(() => this.drawLaser());
  }

  /** Black screen (b): covers everything; navigation goes on behind it. No argument toggles. */
  setBlackout(on = !this.black): void {
    if (on === this.black) return;
    this.black = on;
    this.blackLayer.hidden = !on;
    this.emit();
  }

  /** Passes live data (e.g. a poll's votes) to a node's plugin. */
  setLive(id: string, live: unknown): void {
    this.instances.get(id)?.setLive?.(live);
  }

  /** Opens the presenter view in a pop-out window (or focuses it if it is already open). */
  openPresenter(): void {
    const url = new URL(location.href);
    url.hash = "";
    url.search = "?presenter";
    // open by name first: an existing presenter window is reused as is instead of reloaded
    const w = window.open("", "wavesol-presenter", "popup,width=1280,height=800");
    if (!w) return;
    if (w.location.href === "about:blank") w.location.href = url.href;
    w.focus();
  }

  private emit() {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }

  private viewport() {
    return { vw: this.stage.clientWidth || window.innerWidth, vh: this.stage.clientHeight || window.innerHeight };
  }

  private targetView(): View {
    const { vw, vh } = this.viewport();
    // fit into the space between the insets, then move the view so that space's centre is the node's
    const h = Math.max(1, vh - this.insets.top - this.insets.bottom);
    const box = this.overview ? bounds(this.talk.nodes.filter((n) => n.depth === 0)) : this.nodes.get(this.nav.node)!;
    const v = fitBox(box, vw, h, this.overview ? OVERVIEW_MARGIN : NODE_MARGIN);
    return { ...v, cy: v.cy - ((this.insets.top - this.insets.bottom) / 2) * (v.w / vw) };
  }

  private applyView(v: View) {
    this.view = v;
    const { vw, vh } = this.viewport();
    const k = vw / v.w;
    const tx = vw / 2 - v.cx * k;
    const ty = vh / 2 - v.cy * k;
    this.world.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    this.stage.classList.toggle("ws-overview", this.overview);

    for (const n of this.talk.nodes) {
      const nodeEl = this.els.get(n.id)!;
      const sx = tx + n.x * k;
      const sy = ty + n.y * k;
      const sw = n.w * k;
      const off = sx > vw || sy > vh || sx + sw < 0 || sy + n.h * k < 0;
      const far = !off && sw < FAR_PX && n.type !== "frame";
      const level = off || far ? "overview" : n.id === this.nav.node ? "active" : "near";
      nodeEl.classList.toggle("ws-off", off);
      nodeEl.classList.toggle("ws-far", far);
      // a frame far away keeps its children, but its title grows to stay readable
      nodeEl.classList.toggle("ws-far-frame", !off && n.type === "frame" && k * 1600 < FAR_PX);
      if (nodeEl.dataset.detail !== level) {
        nodeEl.dataset.detail = level;
        this.instances.get(n.id)?.setDetail?.(level);
      }
      nodeEl.classList.toggle("ws-current", n.id === this.nav.node);
    }
    for (const { edge, el: g } of this.edgePaths) g.classList.toggle("ws-edge-out", edge.from === this.nav.node);
  }

  private drawEdges(): Map<number, SVGSVGElement> {
    const layers = new Map<number, SVGSVGElement>();
    const isAncestor = (a: string, b: string) => {
      for (let p = this.nodes.get(b)?.parent; p; p = this.nodes.get(p)?.parent) if (p === a) return true;
      return false;
    };
    for (const edge of this.talk.edges) {
      const a = this.nodes.get(edge.from)!;
      const b = this.nodes.get(edge.to)!;
      if (a.id === b.id || isAncestor(a.id, b.id) || isAncestor(b.id, a.id)) continue;
      const g = svgEl("g", "ws-edge") as SVGGElement;
      const s = Math.min(a.scale, b.scale);
      const { d, tip, angle } = edgePath(a, b);
      const path = svgEl("path");
      path.setAttribute("d", d);
      path.setAttribute("stroke-width", String(4 * s));
      const head = svgEl("path", "ws-edge-head");
      const L = 26 * s;
      head.setAttribute("d", `M0,0 L${-L},${-L * 0.45} L${-L},${L * 0.45} Z`);
      head.setAttribute("transform", `translate(${tip.x},${tip.y}) rotate(${(angle * 180) / Math.PI})`);
      g.append(path, head);
      const depth = Math.min(a.depth, b.depth);
      if (!layers.has(depth)) layers.set(depth, svgEl("svg", "ws-edges") as SVGSVGElement);
      layers.get(depth)!.append(g);
      this.edgePaths.push({ edge, el: g });
    }
    return layers;
  }

  private writeHash() {
    const hash = `#/${this.nav.node}/${this.nav.step}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function svgEl(tag: string, cls?: string): SVGElement {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (cls) e.setAttribute("class", cls);
  return e;
}

export function parseHash(hash: string): { node: string; step: number } | undefined {
  const m = hash.match(/^#\/([a-z0-9][a-z0-9_-]*)(?:\/(\d+))?$/);
  return m ? { node: m[1]!, step: Number(m[2] ?? 0) } : undefined;
}

function bounds(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** Cubic curve from the side of `a` facing `b` to the side of `b` facing `a`. */
function edgePath(a: Box, b: Box) {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const horizontal = Math.abs(dx) * (a.h + b.h) >= Math.abs(dy) * (a.w + b.w);
  const side = (box: Box, c: { x: number; y: number }, sign: number) =>
    horizontal ? { x: c.x + (sign * box.w) / 2, y: c.y } : { x: c.x, y: c.y + (sign * box.h) / 2 };
  const p0 = side(a, ca, horizontal ? Math.sign(dx) || 1 : Math.sign(dy) || 1);
  const p3 = side(b, cb, -(horizontal ? Math.sign(dx) || 1 : Math.sign(dy) || 1));
  const reach = Math.max(Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.4, 40);
  const p1 = horizontal ? { x: p0.x + Math.sign(dx) * reach, y: p0.y } : { x: p0.x, y: p0.y + Math.sign(dy) * reach };
  const p2 = horizontal ? { x: p3.x - Math.sign(dx) * reach, y: p3.y } : { x: p3.x, y: p3.y - Math.sign(dy) * reach };
  return {
    d: `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`,
    tip: p3,
    angle: Math.atan2(p3.y - p2.y, p3.x - p2.x),
  };
}
