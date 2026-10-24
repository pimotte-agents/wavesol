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

export async function layout(nodes: LayoutNode[], edges: { from: string; to: string }[], defaults: LayoutOpts = {}): Promise<Map<string, Placement>> {
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
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": algorithm,
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
