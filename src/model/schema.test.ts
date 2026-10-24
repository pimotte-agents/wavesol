import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { LeanFrontmatter, Talk, expandEdgeItem } from "./schema.ts";

function specExample(): unknown {
  const spec = readFileSync(new URL("../../spec/FORMAT.md", import.meta.url), "utf8");
  const block = spec.match(/## `talk.yaml`\n\n```yaml\n([\s\S]*?)```/);
  return parse(block![1]!);
}

describe("Talk schema", () => {
  it("accepts the example from spec/FORMAT.md", () => {
    expect(Talk.safeParse(specExample()).error).toBeUndefined();
  });

  it("rejects bad node ids and malformed edges", () => {
    expect(Talk.safeParse({ title: "t", nodes: { Intro: {} } }).success).toBe(false);
    expect(Talk.safeParse({ title: "t", nodes: { a: {} }, edges: ["a => b"] }).success).toBe(false);
    expect(Talk.safeParse({ title: "t", nodes: { a: {} }, edges: [{ "a -> b": {}, "b -> a": {} }] }).success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    expect(Talk.safeParse({ title: "t", nodes: { a: {} }, nodez: {} }).success).toBe(false);
  });
});

describe("expandEdgeItem", () => {
  it("expands chains and copies options", () => {
    expect(expandEdgeItem({ "a -> b -> c": { label: "x" } })).toEqual([
      { from: "a", to: "b", label: "x" },
      { from: "b", to: "c", label: "x" },
    ]);
    expect(expandEdgeItem("a->b")).toEqual([{ from: "a", to: "b" }]);
  });
});

describe("Lean frontmatter", () => {
  it("requires exactly one of anchor and decl", () => {
    const base = { type: "lean", source: "Demo/Basic.lean" };
    expect(LeanFrontmatter.safeParse({ ...base, anchor: "a" }).success).toBe(true);
    expect(LeanFrontmatter.safeParse(base).success).toBe(false);
    expect(LeanFrontmatter.safeParse({ ...base, anchor: "a", decl: "b" }).success).toBe(false);
  });
});
