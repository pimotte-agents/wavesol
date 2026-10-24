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
