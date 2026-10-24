import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { select, type LeanSelection, type ModuleJson } from "./subverso.ts";
import { pointTarget, tacticSteps } from "./steps.ts";

const lists = JSON.parse(readFileSync(join(import.meta.dirname, "../../../tests/fixtures/lean/Lists.json"), "utf8")) as ModuleJson;
const sel = select(lists, { anchor: "revRev" }) as LeanSelection;
// tactics: 0 by, 1 | nil =>, 2 rfl, 3 | cons … =>, 4 rw [...], 5–7 its rules, 8 rfl
const steps = tacticSteps(sel.tactics);

describe("Lean steps", () => {
  it("steps are the innermost tactics, without `by`", () => {
    expect(steps).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });

  it("pointing at a step tactic makes it the current step", () => {
    expect(pointTarget(steps, 6)).toEqual({ step: 5 }); // the rule List.reverse_append
    expect(pointTarget(steps, 1)).toEqual({ step: 1 });
    expect(pointTarget(steps, 8)).toEqual({ step: 7 });
  });

  it("pointing at a tactic that is not a step focuses it; the step stops just before its parts", () => {
    // rw: Space then goes on to its first rule (step 4)
    expect(pointTarget(steps, 4)).toEqual({ step: 3, focus: 4 });
  });

  it("pointing at `by` is the start", () => {
    expect(pointTarget(steps, 0)).toEqual({ step: 0 });
  });
});
