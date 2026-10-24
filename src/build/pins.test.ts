import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileTalk } from "./compile.ts";
import { pinFor, writePin } from "./pins.ts";

const TALK = `# a talk
title: Pins
nodes:
  a: {}            # the start
  b: { near: { right-of: a } }
  c:
  f:
    type: frame
    title: F
    children: [x, y]
  x: {}
  y: {}
edges:
  - a -> b -> f
`;

describe("writing pins", () => {
  it("adds a pin to a flow-map entry, keeping comments", () => {
    const out = writePin(TALK, "a", [100, -20])!;
    expect(out).toContain("  a: { pin: [100, -20] }            # the start");
    expect(out).toContain("# a talk");
  });

  it("replaces an existing pin and drops near, which would override it", () => {
    const once = writePin(TALK, "b", [1, 2])!;
    expect(once).toContain("  b: { pin: [1, 2] }");
    expect(writePin(once, "b", [3, 4])).toContain("  b: { pin: [3, 4] }");
  });

  it("handles an empty entry and a block map", () => {
    expect(writePin(TALK, "c", [5, 6])).toContain("  c: { pin: [5, 6] }\n");
    const f = writePin(TALK, "f", [7, 8])!;
    expect(f).toContain("    children: [x, y]\n    pin: [7, 8]\n");
    expect(writePin(f, "f", [9, 9])).toContain("    pin: [9, 9]\n");
  });

  it("changes nothing but the entry", () => {
    const out = writePin(TALK, "a", [1, 1])!;
    expect(out.replace("{ pin: [1, 1] }", "{}")).toBe(TALK);
  });

  it("refuses unknown nodes", () => {
    expect(writePin(TALK, "nope", [0, 0])).toBeUndefined();
  });
});

describe("pins from world positions", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "wavesol-pins-"));
    mkdirSync(join(dir, "nodes"));
    for (const id of ["a", "b", "c", "x", "y"]) writeFileSync(join(dir, "nodes", `${id}.md`), `# ${id}\n`);
    writeFileSync(join(dir, "talk.yaml"), TALK);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** Pins `id` at world `at`, recompiles, and returns where it ended up. */
  async function dragTo(id: string, at: [number, number]) {
    const r = await compileTalk(dir);
    const pin = pinFor(r.talk!, r.frames!, id, at)!;
    const { readFileSync } = await import("node:fs");
    writeFileSync(join(dir, "talk.yaml"), writePin(readFileSync(join(dir, "talk.yaml"), "utf8"), id, pin)!);
    const after = await compileTalk(dir);
    expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const n = after.talk!.nodes.find((x) => x.id === id)!;
    return [n.x, n.y];
  }

  it("a top-level node lands where it was dropped", async () => {
    const [x, y] = await dragTo("c", [5000, -3000]);
    expect(x).toBeCloseTo(5000, 0);
    expect(y).toBeCloseTo(-3000, 0);
  });

  it("inside a frame, the node moves relative to its siblings (the frame then re-fits its content)", async () => {
    const before = await compileTalk(dir);
    const local = (r: typeof before, id: string) => {
      const n = r.talk!.nodes.find((m) => m.id === id)!;
      return pinFor(r.talk!, r.frames!, id, [n.x, n.y])!;
    };
    const y0 = local(before, "y");
    const y = before.talk!.nodes.find((n) => n.id === "y")!;
    // drop x just below y
    const target: [number, number] = [y.x, y.y + y.h * 1.2];
    const pin = pinFor(before.talk!, before.frames!, "x", target)!;
    await dragTo("x", target);
    const after = await compileTalk(dir);
    // in the frame's layout space: x is exactly at its pin, y where it was
    const x1 = local(after, "x");
    const y1 = local(after, "y");
    expect(Math.abs(x1[0] - pin[0]) + Math.abs(x1[1] - pin[1])).toBeLessThanOrEqual(2);
    expect(Math.abs(y1[0] - y0[0]) + Math.abs(y1[1] - y0[1])).toBeLessThanOrEqual(2);
  });
});
