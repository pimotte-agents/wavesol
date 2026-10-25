import { describe, expect, it } from "vitest";
import { matchTokens } from "./match.ts";

const words = (s: string) => s.split(" ");

describe("matching goal tokens", () => {
  it("pairs the tokens a rewrite keeps, in order", () => {
    // key : d ∈ D ↔ d ∉ f d   →   key : d ∈ D ↔ d ∉ D
    const a = words("key : d ∈ D ↔ d ∉ f d");
    const b = words("key : d ∈ D ↔ d ∉ D");
    const pairs = matchTokens(a, b);
    // everything up to "∉" stays; "f d" goes and "D" comes
    expect(pairs).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i, i]));
  });

  it("keeps hypotheses that stay when new ones come in between", () => {
    const a = words("f : α → Set α hf : Surjective f ⊢ False");
    const b = words("f : α → Set α hf : Surjective f d : α hd : f d = D ⊢ False");
    const pairs = matchTokens(a, b);
    expect(pairs).toHaveLength(a.length);
    expect(b[pairs.at(-1)![1]]).toBe("False");
  });

  it("handles empty sides", () => {
    expect(matchTokens([], ["a"])).toEqual([]);
    expect(matchTokens(["a"], [])).toEqual([]);
  });
});
