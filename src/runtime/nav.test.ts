import { describe, expect, it } from "vitest";
import type { CompiledTalk } from "../model/compiled.ts";
import { NavGraph, initialState, navigate, type Intent, type NavState } from "./nav.ts";

const node = (id: string, steps = 0, transition?: "cut") => ({
  id, type: "slide", title: id, children: [], depth: 0, x: 0, y: 0, w: 1600, h: 900, scale: 1, size: [1600, 900] as [number, number], steps, data: {}, transition,
});
const talk: CompiledTalk = {
  version: 1,
  meta: { title: "t" },
  start: "a",
  theme: { base: "academic-light", vars: {} },
  transitions: { default: "fly" },
  sync: { phone: true, ice: [] },
  nodes: [node("a", 2), node("b"), node("c", 1, "cut"), node("d")],
  edges: [
    { from: "a", to: "b", default: true },
    { from: "a", to: "c", label: "detour", transition: "fade" },
    { from: "b", to: "d" },
    { from: "c", to: "a" },
  ],
};
const g = new NavGraph(talk);

function run(intents: Intent[], from: NavState = initialState(g, { node: "a", step: 0 }, "a")) {
  let s = from;
  const trace: string[] = [];
  for (const i of intents) {
    const r = navigate(g, s, i);
    s = r.state;
    trace.push(`${s.node}/${s.step}${r.kind === "move" ? ` (${typeof r.transition === "string" ? r.transition : r.transition?.type})` : r.kind === "none" ? " -" : ""}`);
  }
  return { s, trace };
}

describe("navigation", () => {
  it("steps through fragments, then follows the default edge", () => {
    expect(run([{ type: "step" }, { type: "step" }, { type: "step" }]).trace).toEqual(["a/1", "a/2", "b/0 (fly)"]);
  });

  it("does nothing at a node without default edge", () => {
    expect(run([{ type: "edge", index: 0 }, { type: "step" }]).trace).toEqual(["b/0 (fly)", "b/0 -"]);
  });

  it("takes edges by index at any step, using the edge's transition", () => {
    expect(run([{ type: "step" }, { type: "edge", index: 1 }]).trace).toEqual(["a/1", "c/0 (fade)"]);
    expect(run([{ type: "edge", index: 5 }]).trace).toEqual(["a/0 -"]);
  });

  it("goes back through history, restoring the step", () => {
    const { trace, s } = run([{ type: "step" }, { type: "edge", index: 1 }, { type: "edge", index: 0 }, { type: "back" }, { type: "back" }, { type: "back" }]);
    expect(trace).toEqual(["a/1", "c/0 (fade)", "a/0 (fly)", "c/0 (cut)", "a/1 (fly)", "a/1 -"]);
    expect(s.history).toEqual([]);
  });

  it("prev steps backwards, then goes back", () => {
    expect(run([{ type: "step" }, { type: "step" }, { type: "step" }, { type: "prev" }, { type: "prev" }]).trace).toEqual([
      "a/1", "a/2", "b/0 (fly)", "a/2 (fly)", "a/1",
    ]);
  });

  it("goto jumps anywhere, clamps the step and records history", () => {
    const { trace, s } = run([{ type: "goto", node: "c", step: 9 }, { type: "goto", node: "nope" }, { type: "goto", node: "c", step: 0 }]);
    expect(trace).toEqual(["c/1 (cut)", "c/1 -", "c/0"]);
    expect(s.history).toEqual([{ node: "a", step: 0 }]);
  });
});

describe("frames", () => {
  const frame = (id: string, children: string[]) => ({ ...node(id), type: "frame", children });
  const ft: CompiledTalk = {
    ...talk,
    start: "s",
    nodes: [node("s"), frame("f", ["x", "y", "z"]), { ...node("x"), parent: "f" }, { ...node("y"), parent: "f" }, { ...node("z", 0, "cut"), parent: "f" }, node("after")],
    edges: [
      { from: "s", to: "f", default: true },
      { from: "f", to: "y", label: "start here", default: true },
      { from: "f", to: "after" },
    ],
  };
  const fg = new NavGraph(ft);

  it("a frame has an edge to every node inside it, after its own edges", () => {
    expect(fg.outgoing("f").map((e) => `${e.to}${e.label ? `:${e.label}` : ""}${e.default ? "*" : ""}`)).toEqual(["y:start here*", "after", "x", "z"]);
  });

  it("children are taken by index like any edge; zoom-through unless the child has its own transition", () => {
    const at = initialState(fg, { node: "f", step: 0 }, "s");
    const take = (index: number) => navigate(fg, at, { type: "edge", index });
    expect(take(2)).toMatchObject({ state: { node: "x" }, transition: "zoom-through" });
    expect(take(3)).toMatchObject({ state: { node: "z" }, transition: "cut" });
  });

  it("up goes to the frame a node is in, with zoom-through; back returns", () => {
    const at = initialState(fg, { node: "z", step: 0 }, "s");
    const up = navigate(fg, at, { type: "up" });
    expect(up).toMatchObject({ state: { node: "f", step: 0 }, kind: "move", transition: "zoom-through" });
    expect(navigate(fg, up.state, { type: "back" }).state.node).toBe("z");
  });

  it("up does nothing outside a frame", () => {
    for (const node of ["s", "f"]) expect(navigate(fg, initialState(fg, { node, step: 0 }, "s"), { type: "up" }).kind).toBe("none");
  });

  it("the default edge and other nodes are unchanged", () => {
    expect(navigate(fg, initialState(fg, { node: "f", step: 0 }, "s"), { type: "step" }).state.node).toBe("y");
    expect(fg.outgoing("x")).toEqual([]);
    expect(fg.outgoing("s").map((e) => e.to)).toEqual(["f"]);
  });

  it("uses transitions.local between nearby slides, unless the edge or node sets one", () => {
    const at = (id: string, x: number, transition?: "cut") => ({ ...node(id, 0, transition), x });
    const frame = { ...node("f"), type: "frame", children: [], x: 1800 };
    const lg = new NavGraph({
      ...talk,
      transitions: { default: "fly", local: "pan" },
      nodes: [at("p", 0), at("q", 1800), at("far", 20000), at("own", 3600, "cut"), frame],
      edges: [
        { from: "p", to: "q", default: true },
        { from: "q", to: "far", label: "far" },
        { from: "q", to: "own", label: "own" },
        { from: "p", to: "f", label: "frame" },
        { from: "p", to: "q", label: "edge", transition: "fade" },
      ],
    });
    const take = (from: string, index: number) => navigate(lg, initialState(lg, { node: from, step: 0 }, from), { type: "edge", index }).transition;
    expect(take("p", 0)).toBe("pan"); // 1800 apart, within 2.5 slide widths
    expect(take("q", 0)).toBe("fly"); // too far
    expect(take("q", 1)).toBe("cut"); // the node's own transition wins
    expect(take("p", 1)).toBe("fly"); // frames are never local
    expect(take("p", 2)).toBe("fade"); // the edge's transition wins
    // back is local too
    const there = navigate(lg, initialState(lg, { node: "p", step: 0 }, "p"), { type: "step" }).state;
    expect(navigate(lg, there, { type: "back" }).transition).toBe("pan");
  });
});
