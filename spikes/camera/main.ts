// Camera spike. Keys: n/p next/prev node, o overview, f parent frame, m cycle render mode, l toggle LOD.
// URL params: ?mode=world-toggle|world-always|world-never|per-node  ?lod=0  ?margin=0.05  ?ref=<id>  ?copies=4
// window.spike exposes goTo/overview/stats for the Playwright measurements in tests/e2e.
import "katex/dist/katex.min.css";
import "./style.css";
import { buildFabric, renderContent, NODE_W, NODE_H, type WorldNode } from "./fabric.ts";
import { smoothZoom, easeInOut, type View } from "./camera.ts";

type Mode = "world-toggle" | "world-always" | "world-never" | "per-node";
const MODES: Mode[] = ["world-toggle", "world-always", "world-never", "per-node"];

const params = new URLSearchParams(location.search);
let mode = (params.get("mode") as Mode) ?? "world-toggle";
let lod = params.get("lod") !== "0";
const margin = Number(params.get("margin") ?? 0.05);

const nodes = buildFabric(Number(params.get("copies") ?? 1));
const byId = new Map(nodes.map((n) => [n.id, n]));
const stage = document.getElementById("stage")!;
const hud = document.getElementById("hud")!;

const refId = params.get("ref");
if (refId) {
  // Reference rendering: the node at native size with no transforms, for sharpness comparison.
  const n = byId.get(refId)!;
  stage.innerHTML = `<div class="node ${n.kind} ref"><div class="content">${renderContent(n, nodes.indexOf(n))}</div></div>`;
  hud.remove();
  (window as unknown as { spike: object }).spike = { ready: true };
  throw new Error("reference mode"); // stop here; not an actual failure
}

const world = document.createElement("div");
world.id = "world";
stage.append(world);
const els = new Map<string, HTMLElement>();
nodes.forEach((n, i) => {
  const el = document.createElement("div");
  el.className = `node ${n.kind} depth-${n.depth}`;
  el.innerHTML = `<div class="content">${renderContent(n, i)}</div><div class="far-title">${n.title}</div>`;
  els.set(n.id, el);
  world.append(el);
});

const vp = () => ({ w: stage.clientWidth, h: stage.clientHeight });

function fit(n: WorldNode): View {
  const { w: vw, h: vh } = vp();
  const nw = NODE_W * n.scale;
  const nh = NODE_H * n.scale;
  return { cx: n.x + nw / 2, cy: n.y + nh / 2, w: Math.max(nw, (nh * vw) / vh) / (1 - 2 * margin) };
}

function overviewView(): View {
  const top = nodes.filter((n) => n.depth === 0);
  const minX = Math.min(...top.map((n) => n.x));
  const minY = Math.min(...top.map((n) => n.y));
  const maxX = Math.max(...top.map((n) => n.x + NODE_W));
  const maxY = Math.max(...top.map((n) => n.y + NODE_H));
  const { w: vw, h: vh } = vp();
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: Math.max(maxX - minX, ((maxY - minY) * vw) / vh) * 1.1 };
}

let view = overviewView();
let animating = false;

function applyView(v: View) {
  const { w: vw, h: vh } = vp();
  const k = vw / v.w;
  const tx = vw / 2 - v.cx * k;
  const ty = vh / 2 - v.cy * k;
  if (mode === "per-node") {
    world.style.transform = "";
    for (const n of nodes) {
      const el = els.get(n.id)!;
      el.style.transform = `translate(${tx + n.x * k}px, ${ty + n.y * k}px) scale(${n.scale * k})`;
    }
  } else {
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    for (const n of nodes) els.get(n.id)!.style.transform = `translate(${n.x}px, ${n.y}px) scale(${n.scale})`;
  }
  updateLod(k, tx, ty, vw, vh);
}

// Level of detail: nodes smaller than FAR_PX on screen show only a title card; nodes outside the
// viewport are hidden entirely.
const FAR_PX = 160;
function updateLod(k: number, tx: number, ty: number, vw: number, vh: number) {
  for (const n of nodes) {
    const el = els.get(n.id)!;
    const sw = NODE_W * n.scale * k;
    const sh = NODE_H * n.scale * k;
    const sx = tx + n.x * k;
    const sy = ty + n.y * k;
    const off = sx > vw || sy > vh || sx + sw < 0 || sy + sh < 0;
    el.classList.toggle("off", lod && off);
    el.classList.toggle("far", lod && !off && sw < FAR_PX && n.kind === "slide");
  }
}

function setWillChange(on: boolean) {
  const wc = (v: boolean) => (v ? "transform" : "auto");
  if (mode === "per-node") {
    world.style.willChange = "auto";
    for (const el of els.values()) el.style.willChange = wc(on);
  } else {
    world.style.willChange = wc(mode === "world-always" || (mode === "world-toggle" && on));
    for (const el of els.values()) el.style.willChange = "auto";
  }
}

const frameTimes: number[] = [];
function fly(to: View, opts: { duration?: number; speed?: number } = {}): Promise<void> {
  const path = smoothZoom(view, to);
  const duration = opts.duration ?? Math.min(2500, Math.max(400, path.duration / (opts.speed ?? 1.2)));
  frameTimes.length = 0;
  animating = true;
  setWillChange(true);
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = t0;
    const tick = (now: number) => {
      frameTimes.push(now - last);
      last = now;
      const t = Math.min(1, (now - t0) / duration);
      view = path.at(easeInOut(t));
      applyView(view);
      if (t < 1) requestAnimationFrame(tick);
      else {
        view = to;
        applyView(view);
        animating = false;
        setWillChange(false);
        // let the browser re-raster at the final scale before reporting "settled"
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }
    };
    requestAnimationFrame(tick);
  });
}

// Navigation order for n/p: depth-first through the fabric
const order = nodes.map((n) => n.id);
let current = -1;
const goTo = (id: string, o?: { duration?: number }) => {
  current = order.indexOf(id);
  renderHud();
  return fly(fit(byId.get(id)!), o);
};
const overview = (o?: { duration?: number }) => {
  current = -1;
  renderHud();
  return fly(overviewView(), o);
};

function renderHud() {
  const id = order[current];
  hud.textContent = `mode ${mode} · lod ${lod ? "on" : "off"} · ${id ? byId.get(id)!.title : "overview"} · keys: n p o f m l`;
}

window.addEventListener("keydown", (e) => {
  if (animating) return;
  if (e.key === "n") void goTo(order[(current + 1) % order.length]!);
  else if (e.key === "p") void goTo(order[(current - 1 + order.length) % order.length]!);
  else if (e.key === "o") void overview();
  else if (e.key === "f") {
    const parent = byId.get(order[current] ?? "")?.parent;
    if (parent) void goTo(parent);
    else void overview();
  } else if (e.key === "m") {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
    setWillChange(false);
    applyView(view);
    renderHud();
  } else if (e.key === "l") {
    lod = !lod;
    applyView(view);
    renderHud();
  }
});
window.addEventListener("resize", () => applyView(view));

applyView(view);
setWillChange(false);
renderHud();

function stats() {
  const ft = frameTimes.slice(1).sort((a, b) => a - b);
  const q = (p: number) => ft[Math.min(ft.length - 1, Math.floor(p * ft.length))] ?? 0;
  return { frames: ft.length, p50: q(0.5), p95: q(0.95), max: ft.at(-1) ?? 0, over33: ft.filter((t) => t > 33.4).length };
}

(window as unknown as { spike: object }).spike = {
  ready: true,
  nodes: nodes.map(({ id, kind, depth, parent }) => ({ id, kind, depth, parent })),
  goTo,
  overview,
  stats,
};
