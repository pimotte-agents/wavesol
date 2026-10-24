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
