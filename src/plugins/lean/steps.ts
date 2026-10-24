// Which tactics are steps, and where pointing at a tactic (the phone's laser) puts the step.
// Shared by the build (step count) and the runtime (laser selection).
import type { Tactic } from "./subverso.ts";

/** Steps: each innermost tactic (a `rw` steps through its rules), case arms and bullets included. */
export function tacticSteps(tactics: Tactic[]): number[] {
  const parents = new Set(tactics.map((t) => t.parent).filter((p) => p !== undefined));
  return tactics.flatMap((t, i) => (t.kind !== "by" && !parents.has(i) ? [i] : []));
}

/**
 * The step that pointing at tactic `t` selects, so Space continues after it. Tactics are numbered in
 * source order, so that is the number of steps up to `t`. A tactic that is not a step itself (a `rw`
 * around its rules) is also the focus: shown with its own goals, with the step just before its parts.
 * `by` comes first, so it is step 0, the start.
 */
export function pointTarget(steps: number[], t: number): { step: number; focus?: number } {
  const step = steps.filter((s) => s <= t).length;
  return steps.includes(t) || step === 0 ? { step } : { step, focus: t };
}
