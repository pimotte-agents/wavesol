import { describe, expect, it } from "vitest";
import type { CompiledTalk } from "../../model/compiled.ts";
import { printOrder } from "./order.ts";

const node = (id: string, steps = 0, extra: object = {}) => ({
  id, type: "slide", title: id, children: [], depth: 0, x: 0, y: 0, w: 1600, h: 900, scale: 1, size: [1600, 900] as [number, number], steps, data: {}, ...extra,
});
const talk = (nodes: ReturnType<typeof node>[], edges: CompiledTalk["edges"], start = "a"): CompiledTalk => ({
  version: 1, meta: { title: "t" }, start, theme: { base: "academic-light", vars: {} }, transitions: { default: "fly" }, sync: { phone: true, ice: [] }, nodes, edges,
});

describe("print order", () => {
  it("the main path first, then detours in graph order, then unreachable nodes", () => {
    const t = talk(
      [node("a"), node("b"), node("c"), node("detour"), node("deeper"), node("island")],
      [
        { from: "a", to: "b", default: true },
        { from: "a", to: "detour" },
        { from: "b", to: "c", default: true },
        { from: "detour", to: "deeper" },
        { from: "c", to: "a" },
      ],
    );
    expect(printOrder(t, "last").map((p) => p.node)).toEqual(["a", "b", "c", "detour", "deeper", "island"]);
  });

  it("frames come with their children (the frame's edges to them)", () => {
    const t = talk(
      [node("a"), node("f", 0, { type: "frame", children: ["x", "y"] }), node("x", 0, { parent: "f", depth: 1 }), node("y", 0, { parent: "f", depth: 1 }), node("z")],
      [
        { from: "a", to: "f", default: true },
        { from: "f", to: "z", default: true },
      ],
    );
    expect(printOrder(t, "last").map((p) => p.node)).toEqual(["a", "f", "z", "x", "y"]);
  });

  it("steps: last gives one page per node, all one per step", () => {
    const t = talk([node("a", 2), node("b")], [{ from: "a", to: "b", default: true }]);
    expect(printOrder(t, "last")).toEqual([{ node: "a", step: 2 }, { node: "b", step: 0 }]);
    expect(printOrder(t, "all")).toEqual([{ node: "a", step: 0 }, { node: "a", step: 1 }, { node: "a", step: 2 }, { node: "b", step: 0 }]);
  });

  it("does not loop on a cyclic main path", () => {
    const t = talk([node("a"), node("b")], [{ from: "a", to: "b", default: true }, { from: "b", to: "a", default: true }]);
    expect(printOrder(t, "last").map((p) => p.node)).toEqual(["a", "b"]);
  });
});
