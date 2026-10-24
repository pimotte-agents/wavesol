// The SubVerso reader against fixtures from the pinned SubVerso (tests/fixtures/lean/README.md).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { select, type CodeNode, type Goal, type LeanSelection, type ModuleJson } from "./subverso.ts";

const load = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "../../../tests/fixtures/lean", name), "utf8")) as ModuleJson;
const lists = load("Lists.json");
const fixture = load("Fixture.json");

const text = (ns: CodeNode[]): string => ns.map((n) => (typeof n === "string" ? n : "tac" in n ? text(n.c) : n.t)).join("");
/** Code with tactic spans shown as ⟦index:…⟧. */
const marked = (ns: CodeNode[]): string => ns.map((n) => (typeof n === "string" ? n : "tac" in n ? `⟦${n.tac}:${marked(n.c)}⟧` : n.t)).join("");
const goal = (g: Goal) => `${g.name ? `[${g.name}] ` : ""}${g.hyps.map((h) => `${h.names.join(" ")} : ${text(h.type)}`).join(", ")} ${g.prefix}${text(g.concl)}`;
const goals = (gs?: Goal[]) => gs?.map(goal);
function ok(r: LeanSelection | { error: string }): LeanSelection {
  if ("error" in r) throw new Error(r.error);
  return r;
}

describe("SubVerso reader", () => {
  it("selects an anchor region without marker comments", () => {
    const r = ok(select(lists, { anchor: "revRev" }));
    expect(marked(r.code)).toBe(
      [
        "theorem reverse_reverse (xs : List α) : xs.reverse.reverse = xs := ⟦0:by⟧",
        "  induction xs with",
        "  ⟦1:| nil =>⟧ ⟦2:rfl⟧",
        "  ⟦3:| cons x xs ih =>⟧",
        "    ⟦4:rw [⟦5:List.reverse_cons,⟧ ⟦6:List.reverse_append,⟧ ⟦7:ih⟧]⟧",
        "    ⟦8:rfl⟧",
      ].join("\n"),
    );
  });

  it("gives each tactic its goals before and after", () => {
    const r = ok(select(lists, { anchor: "revRev" }));
    expect(r.tactics.map((t) => `${t.kind} ${t.text}`)).toEqual([
      "by by",
      "case | nil =>",
      "tactic rfl",
      "case | cons x xs ih =>",
      "tactic rw [List.reverse_cons, List.reverse_append, ih]",
      "tactic List.reverse_cons,",
      "tactic List.reverse_append,",
      "tactic ih",
      "tactic rfl",
    ]);
    const [by, nil, rfl, cons, rw, rule1, rule2, rule3, rfl2] = r.tactics;
    expect(by!.before).toBeUndefined();
    expect(goals(by!.after)).toEqual(["α : Type u_1, xs : List α ⊢ xs.reverse.reverse = xs"]);
    // a case arm only opens its case
    expect(nil!.before).toBeUndefined();
    expect(goals(nil!.after)).toEqual(["[nil] α : Type u_1 ⊢ [].reverse.reverse = []"]);
    expect(goals(rfl!.before)).toEqual(goals(nil!.after));
    expect(goals(rfl!.after)).toEqual([]);
    const ih = "[cons] α : Type u_1, x : α, xs : List α, ih : xs.reverse.reverse = xs ⊢ ";
    expect(goals(cons!.after)).toEqual([`${ih}(x :: xs).reverse.reverse = x :: xs`]);
    // the first rule starts where the rw starts; each rule continues from the previous one
    expect(goals(rule1!.before)).toEqual(goals(rw!.before));
    expect(goals(rule1!.after)).toEqual([`${ih}(xs.reverse ++ [x]).reverse = x :: xs`]);
    expect(goals(rule2!.before)).toEqual(goals(rule1!.after));
    expect(goals(rule3!.after)).toEqual(goals(rw!.after));
    expect(goals(rfl2!.before)).toEqual(goals(rw!.after));
    expect([rule1, rule2, rule3].map((t) => t!.parent)).toEqual([4, 4, 4]);
    expect(rw!.parent).toBeUndefined();
  });

  it("names PROOF_STATE comments after the tactic just before them", () => {
    expect(ok(select(lists, { anchor: "revRev" })).states).toEqual({ cons: 3 });
    expect(ok(select(fixture, { decl: "bullets" })).states).toEqual({ left: 3 });
  });

  it("selects a declaration, also by its short name in a namespace, keeping the doc comment", () => {
    const r = ok(select(fixture, { decl: "double" }));
    expect(text(r.code)).toBe("/-- Doubles a number.\nThe second line of the docstring. -/\ndef double (n : Nat) : Nat := n + n");
    expect(r.tactics).toEqual([]);
    expect(ok(select(fixture, { decl: "Fx.double" })).code).toEqual(r.code);
  });

  it("an anchor inside a proof: dedented, and the surrounding `by` is not a span", () => {
    const r = ok(select(fixture, { anchor: "inner" }));
    expect(marked(r.code)).toBe("⟦0:omega⟧");
    expect(goals(r.tactics[0]!.before)).toEqual(["n : Nat ⊢ n + n = 2 * n"]);
  });

  it("nested `by` and bullets", () => {
    const h = ok(select(fixture, { anchor: "haveBlock" }));
    expect(marked(h.code)).toContain("⟦1:have h' : b = a := by\n    ⟦2:rw [⟦3:h⟧]⟧⟧\n  ⟦4:exact h'⟧");
    expect(goals(h.tactics[4]!.before)).toEqual(["a : Nat, b : Nat, h : a = b, h' : b = a ⊢ b = a"]);
    const b = ok(select(fixture, { decl: "bullets" }));
    expect(b.tactics.map((t) => t.kind)).toEqual(["by", "tactic", "case", "tactic", "case", "tactic"]);
    expect(goals(b.tactics[5]!.before)).toEqual(["[right] p : Prop, q : Prop, hp : p, hq : q ⊢ q"]);
  });

  it("hovers: signatures and docstrings, deduplicated, none on brackets", () => {
    const r = ok(select(lists, { decl: "Palindrome" }));
    const tokens: { t: string; h?: number }[] = [];
    const visit = (ns: CodeNode[]) => ns.forEach((n) => (typeof n === "object" && ("tac" in n ? visit(n.c) : tokens.push(n))));
    visit(r.code);
    const hoverOf = (t: string) => r.hovers[tokens.find((x) => x.t === t)!.h!];
    expect(hoverOf("Palindrome")).toEqual({ sig: "Palindrome.{u_1} {α : Type u_1} (xs : List α) : Prop", doc: "A list is a *palindrome* if it reads the same backwards." });
    expect(hoverOf("reverse")?.sig).toMatch(/^List\.reverse/);
    expect(tokens.find((x) => x.t === "(")!.h).toBeUndefined();
    expect(new Set(r.hovers.map((h) => JSON.stringify(h))).size).toBe(r.hovers.length);
  });

  it("explains what is missing", () => {
    expect(select(lists, { decl: "nope" })).toEqual({ error: 'declaration "nope" not found' });
    expect(select(lists, { anchor: "nope" })).toEqual({ error: 'anchor "nope" not found (expected a line "-- ANCHOR: nope")' });
  });
});
