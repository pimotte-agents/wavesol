// Computes world placements. Each frame's children are laid out on their own (ELK), then scaled to
// fit the frame's content box; the top level is laid out the same way with frames as ordinary boxes.
// Edges between nodes in different subtrees are projected onto their ancestors at each level.
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { z } from "zod";
import type { Layout } from "../model/schema.ts";

type LayoutOpts = z.infer<typeof Layout>;

export interface LayoutNode {
  id: string;
  parent?: string;
  size: [number, number];
  scale: number;
  isFrame: boolean;
  layout?: LayoutOpts;
  pin?: [number, number];
  near?: Partial<Record<"left-of" | "right-of" | "above" | "below", string>>;
}

export interface Placement {
  x: number;
  y: number;
  /** World units per node unit. */
  scale: number;
}

/** Frame chrome in node units: title band on top, padding around the content box. */
export const FRAME_HEADER = 150;
export const FRAME_PAD = 60;
const GAP = 160;

const DIRECTIONS = { right: "RIGHT", down: "DOWN", left: "LEFT", up: "UP" } as const;
const elk = new ELK();

interface Local {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How a frame places its children: world = frame + (d + local · s) · frame scale (see FrameSpace users). */
export interface FrameSpace {
  s: number;
  dx: number;
  dy: number;
}

/** `frames`, if given, receives each frame's child space (for turning world positions into pins). */
export async function layout(
  nodes: LayoutNode[],
  edges: { from: string; to: string }[],
  defaults: LayoutOpts = {},
  frames?: Map<string, FrameSpace>,
): Promise<Map<string, Placement>> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | undefined, string[]>();
  for (const n of nodes) childrenOf.set(n.parent, [...(childrenOf.get(n.parent) ?? []), n.id]);

  const ancestorAt = (id: string, level: string | undefined): string | undefined => {
    for (let cur: string | undefined = id; cur !== undefined; cur = byId.get(cur)?.parent) {
      if (byId.get(cur)?.parent === level) return cur;
    }
    return undefined;
  };

  // Local positions (in the parent's layout space) and the scale each frame applies to its children.
  const local = new Map<string, Local>();
  const childScale = new Map<string, { s: number; dx: number; dy: number }>();

  async function layoutLevel(parent: string | undefined, opts: LayoutOpts) {
    const ids = childrenOf.get(parent) ?? [];
    for (const id of ids) if (byId.get(id)!.isFrame) await layoutLevel(id, { ...defaults, ...byId.get(id)!.layout });

    const box = (id: string) => {
      const n = byId.get(id)!;
      return { w: n.size[0] * n.scale, h: n.size[1] * n.scale };
    };
    const levelEdges = new Map<string, { from: string; to: string }>();
    for (const e of edges) {
      const a = ancestorAt(e.from, parent);
      const b = ancestorAt(e.to, parent);
      if (a && b && a !== b) levelEdges.set(`${a}->${b}`, { from: a, to: b });
    }

    // target aspect: the frame's content box, or the 16:9 screen at the top level
    const frameSize = parent === undefined ? undefined : byId.get(parent)!.size;
    const aspect = frameSize ? (frameSize[0] - 2 * FRAME_PAD) / (frameSize[1] - FRAME_HEADER - FRAME_PAD) : 16 / 9;
    const pos = await place(ids, box, [...levelEdges.values()], opts, aspect);
    for (const id of ids) {
      const n = byId.get(id)!;
      if (n.pin) pos.set(id, { x: n.pin[0], y: n.pin[1] });
    }
    for (const id of ids) {
      const n = byId.get(id)!;
      const [rel, target] = Object.entries(n.near ?? {})[0] ?? [];
      const t = target !== undefined ? pos.get(target) : undefined;
      if (!rel || !t) continue;
      const tb = box(target!);
      const b = box(id);
      pos.set(id, {
        "left-of": { x: t.x - b.w - GAP, y: t.y },
        "right-of": { x: t.x + tb.w + GAP, y: t.y },
        above: { x: t.x, y: t.y - b.h - GAP },
        below: { x: t.x, y: t.y + tb.h + GAP },
      }[rel as "left-of"]);
    }
    for (const id of ids) local.set(id, { ...pos.get(id)!, ...box(id) });

    if (parent !== undefined && ids.length) {
      const minX = Math.min(...ids.map((id) => local.get(id)!.x));
      const minY = Math.min(...ids.map((id) => local.get(id)!.y));
      const bw = Math.max(...ids.map((id) => local.get(id)!.x + local.get(id)!.w)) - minX;
      const bh = Math.max(...ids.map((id) => local.get(id)!.y + local.get(id)!.h)) - minY;
      const [fw, fh] = byId.get(parent)!.size;
      const cw = fw - 2 * FRAME_PAD;
      const ch = fh - FRAME_HEADER - FRAME_PAD;
      const s = Math.min(cw / bw, ch / bh, 1);
      childScale.set(parent, { s, dx: FRAME_PAD + (cw - bw * s) / 2 - minX * s, dy: FRAME_HEADER + (ch - bh * s) / 2 - minY * s });
    }
  }

  await layoutLevel(undefined, defaults);

  const world = new Map<string, Placement>();
  const resolve = (id: string): Placement => {
    const done = world.get(id);
    if (done) return done;
    const n = byId.get(id)!;
    const l = local.get(id)!;
    let p: Placement;
    if (n.parent === undefined) p = { x: l.x, y: l.y, scale: n.scale };
    else {
      const parent = resolve(n.parent);
      const cs = childScale.get(n.parent)!;
      p = { x: parent.x + (cs.dx + l.x * cs.s) * parent.scale, y: parent.y + (cs.dy + l.y * cs.s) * parent.scale, scale: parent.scale * cs.s * n.scale };
    }
    world.set(id, p);
    return p;
  };
  for (const n of nodes) resolve(n.id);
  if (frames) for (const [id, cs] of childScale) frames.set(id, cs);
  return world;
}

async function place(
  ids: string[],
  box: (id: string) => { w: number; h: number },
  edges: { from: string; to: string }[],
  opts: LayoutOpts,
  aspect: number,
): Promise<Map<string, { x: number; y: number }>> {
  const spacing = opts.spacing ?? 1;
  const algorithm = opts.algorithm ?? "layered";
  const pos = new Map<string, { x: number; y: number }>();
  if (algorithm === "grid" || algorithm === "manual") {
    // manual: unpinned nodes still need a position; a grid keeps them visible
    const cols = Math.ceil(Math.sqrt(ids.length));
    const cell = Math.max(...ids.map((id) => box(id).w), 1) + GAP * spacing;
    const row = Math.max(...ids.map((id) => box(id).h), 1) + GAP * spacing;
    ids.forEach((id, i) => pos.set(id, { x: (i % cols) * cell, y: Math.floor(i / cols) * row }));
    return pos;
  }
  // force on a level that is only chains falls back to layered, which wraps them into rows
  if (algorithm === "force" && !isChains(edges)) return forceLayout(ids, box, edges, spacing, aspect);
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": DIRECTIONS[opts.direction ?? "right"],
      "elk.spacing.nodeNode": String(GAP * spacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(GAP * 1.5 * spacing),
      "elk.spacing.componentComponent": String(GAP * spacing),
      "elk.randomSeed": "1",
      // wrap long chains into rows so the level fills a 16:9-ish area instead of one long ribbon
      "elk.layered.wrapping.strategy": opts.wrap === false ? "OFF" : "MULTI_EDGE",
      "elk.aspectRatio": String(aspect),
    },
    children: ids.map((id) => ({ id, width: box(id).w, height: box(id).h })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
  const result = await elk.layout(graph);
  for (const c of result.children ?? []) pos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  return pos;
}

/** True if no node branches (at most one edge in and one out): chains, which force would draw as a line. */
function isChains(edges: { from: string; to: string }[]): boolean {
  const out = new Map<string, number>();
  const inc = new Map<string, number>();
  for (const e of edges) {
    out.set(e.from, (out.get(e.from) ?? 0) + 1);
    inc.set(e.to, (inc.get(e.to) ?? 0) + 1);
  }
  return [...out.values(), ...inc.values()].every((d) => d <= 1);
}

/**
 * Force layout for web-like talks: stress majorization (few edge crossings, even edge lengths), then
 * the rotation and per-axis stretch that best fill the target aspect while keeping every pair of
 * boxes at least a quarter node width apart. Affine maps keep crossings, so the fit costs no untangling.
 */
async function forceLayout(
  ids: string[],
  box: (id: string) => { w: number; h: number },
  edges: { from: string; to: string }[],
  spacing: number,
  aspect: number,
): Promise<Map<string, { x: number; y: number }>> {
  const sizes = ids.map(box);
  const meanW = sizes.reduce((s, b) => s + b.w, 0) / Math.max(ids.length, 1);
  const result = await elk.layout({
    id: "root",
    layoutOptions: { "elk.algorithm": "stress", "elk.stress.desiredEdgeLength": String(1.5 * meanW), "elk.randomSeed": "1" },
    children: ids.map((id, i) => ({ id, width: sizes[i]!.w, height: sizes[i]!.h })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  });
  const at = new Map((result.children ?? []).map((c) => [c.id, c]));
  const centers = ids.map((id, i) => [(at.get(id)?.x ?? 0) + sizes[i]!.w / 2, (at.get(id)?.y ?? 0) + sizes[i]!.h / 2] as const);
  const gap = (meanW / 4) * spacing;

  let best = { fill: -1, pts: centers.map(([x, y]) => [x, y]) };
  for (let deg = 0; deg < 180; deg += 3) {
    const a = (deg * Math.PI) / 180;
    const rot = centers.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as const);
    for (let k = -12; k <= 12; k++) {
      const stretchY = 1.15 ** k;
      // smallest uniform scale at which every pair is separated by `gap` along x or y
      let t = 0;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const dx = Math.abs(rot[i]![0] - rot[j]![0]);
          const dy = Math.abs(rot[i]![1] - rot[j]![1]) * stretchY;
          if (dx + dy < 1e-9) continue; // coincident centers: no scale separates them
          const needX = (sizes[i]!.w + sizes[j]!.w) / 2 + gap;
          const needY = (sizes[i]!.h + sizes[j]!.h) / 2 + gap;
          t = Math.max(t, Math.min(dx ? needX / dx : Infinity, dy ? needY / dy : Infinity));
        }
      }
      if (t === 0) t = 1;
      const pts = rot.map(([x, y]) => [x * t, y * stretchY * t]);
      const minX = Math.min(...pts.map(([x], i) => x! - sizes[i]!.w / 2));
      const maxX = Math.max(...pts.map(([x], i) => x! + sizes[i]!.w / 2));
      const minY = Math.min(...pts.map(([, y], i) => y! - sizes[i]!.h / 2));
      const maxY = Math.max(...pts.map(([, y], i) => y! + sizes[i]!.h / 2));
      const fill = Math.min(aspect / (maxX - minX), 1 / (maxY - minY)); // node scale when fitted to the target box
      if (fill > best.fill) best = { fill, pts };
    }
  }
  return new Map(ids.map((id, i) => [id, { x: best.pts[i]![0]! - sizes[i]!.w / 2, y: best.pts[i]![1]! - sizes[i]!.h / 2 }]));
}
