// The projector-side presentation: mounts nodes on one world canvas, draws edges, runs the camera and
// applies navigation intents. UI chrome (panels, help) subscribes to its state from React.
import type { CompiledEdge, CompiledNode, CompiledTalk } from "../model/compiled.ts";
import type { NodeInstance, RuntimePlugin } from "../plugins/types.ts";
import { Animator, fitBox, panBy, zoomAt, type Box, type View } from "./camera.ts";
import { NavGraph, initialState, navigate, type Intent, type NavState } from "./nav.ts";

const NODE_MARGIN = 0.03;
const OVERVIEW_MARGIN = 0.05;
/** Slides narrower than this on screen show a title card instead of their content. */
const FAR_PX = 160;
/** Pointer travel (px) after which a press in the overview is a drag, not a click. */
const DRAG_PX = 5;
/** Fraction of the remaining distance the laser dot covers per frame. */
const LASER_EASE = 0.35;
/** The laser dot hides after this long without an update. */
const LASER_IDLE_MS = 4000;

export interface PresentationState {
  nav: NavState;
  overview: boolean;
  node: CompiledNode;
  outgoing: { edge: CompiledEdge; target: CompiledNode }[];
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
  private listeners = new Set<(s: PresentationState) => void>();
  private laser: HTMLElement;
  /** Laser pointer: where it is drawn, where it is heading (screen px), and when it last moved. */
  private laserAt?: { x: number; y: number };
  private laserTarget?: { x: number; y: number };
  private laserMoved = 0;
  private laserFrame = 0;

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
    this.stage.append(this.world, this.laser);
    root.append(this.stage);

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
        if (!this.overview || this.dragged) return;
        e.stopPropagation();
        this.dispatch({ type: "goto", node: n.id });
      });
    }

    this.animator = new Animator({
      apply: (v) => this.applyView(v),
      setOpacity: (o) => (this.world.style.opacity = String(o)),
      moving: (on) => (this.world.style.willChange = on ? "transform" : "auto"),
    });

    this.bindPanZoom();

    this.nav = initialState(this.graph, parseHash(location.hash) ?? { node: talk.start, step: 0 }, talk.start);
    this.instances.get(this.nav.node)?.setStep(this.nav.step, { animate: false });
    this.applyView(this.targetView());
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

  /** A laser "click" at a normalised screen position: clicks whatever is there, with a ripple. */
  clickAt(at: [number, number]): void {
    const { vw, vh } = this.viewport();
    const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    const x = clamp(at[0]) * vw;
    const y = clamp(at[1]) * vh;
    const ripple = el("div", "ws-laser-click");
    ripple.style.transform = `translate(${x}px, ${y}px)`;
    this.stage.append(ripple);
    setTimeout(() => ripple.remove(), 600);
    const r = this.stage.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + x, r.top + y);
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: r.left + x, clientY: r.top + y }));
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
    this.laserFrame = requestAnimationFrame(() => this.drawLaser());
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
    if (this.overview) return fitBox(bounds(this.talk.nodes.filter((n) => n.depth === 0)), vw, vh, OVERVIEW_MARGIN);
    return fitBox(this.nodes.get(this.nav.node)!, vw, vh, NODE_MARGIN);
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
