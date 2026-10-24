// Navigation state machine (pure). Intents come from the keyboard now, and from the presenter view and
// phone later; the projector applies them and broadcasts the resulting state.
import type { CompiledEdge, CompiledTalk, TransitionSpec } from "../model/compiled.ts";

export interface Position {
  node: string;
  step: number;
}

export interface NavState extends Position {
  history: Position[];
}

export type Intent =
  | { type: "step" }
  | { type: "prev" }
  | { type: "edge"; index: number }
  | { type: "back" }
  | { type: "goto"; node: string; step?: number };

export interface NavResult {
  state: NavState;
  /** "move" = the node changed (camera transition), "step" = same node, other step. */
  kind: "none" | "step" | "move";
  transition?: TransitionSpec;
}

const HISTORY_LIMIT = 200;

export class NavGraph {
  private steps = new Map<string, number>();
  private out = new Map<string, CompiledEdge[]>();
  private nodeTransition = new Map<string, TransitionSpec | undefined>();
  private defaultTransition: TransitionSpec;

  constructor(talk: CompiledTalk) {
    for (const n of talk.nodes) {
      this.steps.set(n.id, n.steps);
      this.out.set(n.id, []);
      this.nodeTransition.set(n.id, n.transition);
    }
    for (const e of talk.edges) this.out.get(e.from)!.push(e);
    this.defaultTransition = talk.transitions.default;
  }

  has(id: string): boolean {
    return this.steps.has(id);
  }
  stepsOf(id: string): number {
    return this.steps.get(id) ?? 0;
  }
  outgoing(id: string): CompiledEdge[] {
    return this.out.get(id) ?? [];
  }
  /** Edge transition > target node transition > talk default. */
  transitionTo(target: string, edge?: CompiledEdge): TransitionSpec {
    return edge?.transition ?? this.nodeTransition.get(target) ?? this.defaultTransition;
  }
}

/** `fallback` is used when `start` names an unknown node (e.g. a stale URL). */
export function initialState(g: NavGraph, start: Position, fallback: string): NavState {
  const node = g.has(start.node) ? start.node : fallback;
  return { node, step: Math.max(0, Math.min(start.step, g.stepsOf(node))), history: [] };
}

export function navigate(g: NavGraph, s: NavState, intent: Intent): NavResult {
  const none: NavResult = { state: s, kind: "none" };
  const move = (node: string, step: number, edge?: CompiledEdge): NavResult => ({
    state: { node, step, history: [...s.history, { node: s.node, step: s.step }].slice(-HISTORY_LIMIT) },
    kind: "move",
    transition: g.transitionTo(node, edge),
  });

  switch (intent.type) {
    case "step": {
      if (s.step < g.stepsOf(s.node)) return { state: { ...s, step: s.step + 1 }, kind: "step" };
      const edge = g.outgoing(s.node).find((e) => e.default);
      return edge ? move(edge.to, 0, edge) : none;
    }
    case "prev":
      if (s.step > 0) return { state: { ...s, step: s.step - 1 }, kind: "step" };
      return navigate(g, s, { type: "back" });
    case "edge": {
      const edge = g.outgoing(s.node)[intent.index];
      return edge ? move(edge.to, 0, edge) : none;
    }
    case "back": {
      const prev = s.history.at(-1);
      if (!prev) return none;
      return { state: { ...prev, history: s.history.slice(0, -1) }, kind: "move", transition: g.transitionTo(prev.node) };
    }
    case "goto": {
      if (!g.has(intent.node)) return none;
      const step = Math.max(0, Math.min(intent.step ?? 0, g.stepsOf(intent.node)));
      if (intent.node === s.node) return step === s.step ? none : { state: { ...s, step }, kind: "step" };
      return move(intent.node, step);
    }
  }
}
