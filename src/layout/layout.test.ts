import { describe, expect, it } from "vitest";
import { layout, FRAME_HEADER, FRAME_PAD, type LayoutNode } from "./layout.ts";

const node = (id: string, extra: Partial<LayoutNode> = {}): LayoutNode => ({ id, size: [1600, 900], scale: 1, isFrame: false, ...extra });
const round = (m: Map<string, { x: number; y: number; scale: number }>) =>
  Object.fromEntries([...m].map(([k, p]) => [k, { x: Math.round(p.x), y: Math.round(p.y), scale: +p.scale.toFixed(4) }]));

describe("layout", () => {
  it("lays a chain out left to right by default", async () => {
    const p = await layout([node("a"), node("b"), node("c")], [{ from: "a", to: "b" }, { from: "b", to: "c" }], { wrap: false });
    expect(p.get("a")!.x).toBeLessThan(p.get("b")!.x);
    expect(p.get("b")!.x).toBeLessThan(p.get("c")!.x);
    expect(p.get("a")!.y).toBe(p.get("b")!.y);
  });

  it("respects direction: down", async () => {
    const p = await layout([node("a"), node("b")], [{ from: "a", to: "b" }], { direction: "down", wrap: false });
    expect(p.get("a")!.y).toBeLessThan(p.get("b")!.y);
  });

  it("wraps long chains into rows by default", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const p = await layout(ids.map((id) => node(id)), ids.slice(1).map((id, i) => ({ from: ids[i]!, to: id })));
    const rows = new Set(ids.map((id) => p.get(id)!.y));
    expect(rows.size).toBeGreaterThan(1);
  });

  it("scales frame children into the frame's content box", async () => {
    const nodes = [node("f", { isFrame: true }), node("x", { parent: "f" }), node("y", { parent: "f" }), node("z")];
    const p = await layout(nodes, [{ from: "x", to: "y" }, { from: "f", to: "z" }]);
    const f = p.get("f")!;
    for (const id of ["x", "y"]) {
      const c = p.get(id)!;
      expect(c.scale).toBeLessThan(1);
      expect(c.x).toBeGreaterThanOrEqual(f.x + FRAME_PAD - 1e-6);
      expect(c.y).toBeGreaterThanOrEqual(f.y + FRAME_HEADER - 1e-6);
      expect(c.x + 1600 * c.scale).toBeLessThanOrEqual(f.x + 1600 - FRAME_PAD + 1e-6);
      expect(c.y + 900 * c.scale).toBeLessThanOrEqual(f.y + 900 - FRAME_PAD + 1e-6);
    }
  });

  it("nests scales multiplicatively", async () => {
    const nodes = [node("f", { isFrame: true }), node("g", { parent: "f", isFrame: true }), node("h", { parent: "g" }), node("i", { parent: "f" })];
    const p = await layout(nodes, []);
    expect(p.get("h")!.scale).toBeLessThan(p.get("g")!.scale);
    expect(p.get("g")!.scale).toBeLessThan(1);
  });

  it("applies pins and near hints", async () => {
    const p = await layout([node("a"), node("b", { pin: [5000, 100] }), node("c", { near: { below: "b" } })], [{ from: "a", to: "b" }]);
    expect(p.get("b")).toMatchObject({ x: 5000, y: 100 });
    expect(p.get("c")).toMatchObject({ x: 5000, y: 100 + 900 + 160 });
  });

  it("is deterministic (snapshot)", async () => {
    const nodes = [node("intro"), node("bg", { isFrame: true }), node("d1", { parent: "bg" }), node("d2", { parent: "bg" }), node("thm"), node("app", { scale: 0.5 })];
    const edges = [{ from: "intro", to: "bg" }, { from: "d1", to: "d2" }, { from: "d2", to: "thm" }, { from: "intro", to: "thm" }, { from: "thm", to: "app" }];
    expect(round(await layout(nodes, edges))).toMatchSnapshot();
  });
});

describe("force layout density", () => {
  // like the docs: a start, a hub with an edge to every topic, topics in a chain, some of them frames
  const topics = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];
  const nodes: LayoutNode[] = [node("start"), node("hub"), node("end"), ...topics.map((t, i) => node(t, i % 2 ? { size: [2400, 1350] } : {}))];
  const edges = [
    { from: "start", to: "hub" },
    ...topics.map((t) => ({ from: "hub", to: t })),
    ...topics.slice(1).map((t, i) => ({ from: topics[i]!, to: t })),
    { from: "t8", to: "end" },
    { from: "end", to: "start" },
  ];
  const boxes = async () => {
    const p = await layout(nodes, edges, { algorithm: "force" });
    return nodes.map((n) => ({ id: n.id, x: p.get(n.id)!.x, y: p.get(n.id)!.y, w: n.size[0], h: n.size[1] }));
  };

  it("keeps a quarter slide between nodes", async () => {
    const b = await boxes();
    for (const a of b) {
      for (const c of b) {
        if (a === c) continue;
        const gap = Math.max(c.x - (a.x + a.w), a.x - (c.x + c.w), c.y - (a.y + a.h), a.y - (c.y + c.h));
        expect(gap, `${a.id}–${c.id}`).toBeGreaterThanOrEqual(1600 / 4 - 1);
      }
    }
  });

  it("is compact: the nodes cover a good part of their bounding box, which is near 16:9", async () => {
    const b = await boxes();
    const w = Math.max(...b.map((n) => n.x + n.w)) - Math.min(...b.map((n) => n.x));
    const h = Math.max(...b.map((n) => n.y + n.h)) - Math.min(...b.map((n) => n.y));
    const covered = b.reduce((s, n) => s + n.w * n.h, 0) / (w * h);
    expect(covered).toBeGreaterThan(0.33);
    expect(w / h).toBeGreaterThan(1.3);
    expect(w / h).toBeLessThan(2.3);
  });
});
