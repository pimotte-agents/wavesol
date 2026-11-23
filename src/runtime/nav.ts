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
  /** to the frame the current node is in */
  | { type: "up" }
  | { type: "goto"; node: string; step?: number };

export interface NavResult {
  state: NavState;
  /** "move" = the node changed (camera transition), "step" = same node, other step. */
  kind: "none" | "step" | "move";
  transition?: TransitionSpec;
}

const HISTORY_LIMIT = 200;
/** Moves between slides at most this many slide widths apart use `transitions.local`. */
export const LOCAL_DISTANCE = 2.5;

export class NavGraph {
  private steps = new Map<string, number>();
  private out = new Map<string, CompiledEdge[]>();
  private nodeTransition = new Map<string, TransitionSpec | undefined>();
  private parents = new Map<string, string>();
  private defaultTransition: TransitionSpec;
  private localTransition: TransitionSpec | undefined;
  /** Slides (not frames), for deciding whether a move is local. */
  private boxes = new Map<string, { cx: number; cy: number; w: number }>();

  constructor(talk: CompiledTalk) {
    for (const n of talk.nodes) {
      this.steps.set(n.id, n.steps);
      this.out.set(n.id, []);
      this.nodeTransition.set(n.id, n.transition);
      if (n.parent) this.parents.set(n.id, n.parent);
      if (n.type !== "frame") this.boxes.set(n.id, { cx: n.x + n.w / 2, cy: n.y + n.h / 2, w: n.w });
    }
    for (const e of talk.edges) this.out.get(e.from)!.push(e);
    // a frame also has an edge to every node inside it, after its own edges: from a frame you can
    // go into any part of it (buttons, 1–9 keys), not only along the edges the talk lists
    for (const n of talk.nodes) {
      const out = this.out.get(n.id)!;
      for (const child of n.children) {
        if (out.some((e) => e.to === child)) continue;
        const target = talk.nodes.find((c) => c.id === child);
        out.push({ from: n.id, to: child, transition: target?.transition ?? "zoom-through" });
      }
    }
    this.defaultTransition = talk.transitions.default;
    this.localTransition = talk.transitions.local;
  }

  has(id: string): boolean {
    return this.steps.has(id);
  }
  stepsOf(id: string): number {
    return this.steps.get(id) ?? 0;
  }
  /** The transition set on the node itself in talk.yaml, if any. */
  ownTransition(id: string): TransitionSpec | undefined {
    return this.nodeTransition.get(id);
  }
  /** The frame a node is in, if any. */
  parentOf(id: string): string | undefined {
    return this.parents.get(id);
  }
  outgoing(id: string): CompiledEdge[] {
    return this.out.get(id) ?? [];
  }
  /**
   * Edge transition > target node transition > talk `local` (between nearby slides) > talk default.
   * Two slides are nearby when neither is a frame and their centres are at most
   * LOCAL_DISTANCE times the wider one's width apart.
   */
  transitionTo(target: string, edge?: CompiledEdge, from?: string): TransitionSpec {
    const own = edge?.transition ?? this.nodeTransition.get(target);
    if (own !== undefined) return own;
    if (this.localTransition !== undefined && from !== undefined && this.isLocal(from, target)) return this.localTransition;
    return this.defaultTransition;
  }
  private isLocal(a: string, b: string): boolean {
    const p = this.boxes.get(a);
    const q = this.boxes.get(b);
    if (!p || !q) return false;
    return Math.hypot(p.cx - q.cx, p.cy - q.cy) <= LOCAL_DISTANCE * Math.max(p.w, q.w);
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
    transition: g.transitionTo(node, edge, s.node),
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
    case "up": {
      // the reverse of a frame's edges to its children: zoom-through unless the frame sets a transition
      const parent = g.parentOf(s.node);
      if (!parent) return none;
      return move(parent, 0, { from: s.node, to: parent, transition: g.ownTransition(parent) ?? "zoom-through" });
    }
    case "back": {
      const prev = s.history.at(-1);
      if (!prev) return none;
      return { state: { ...prev, history: s.history.slice(0, -1) }, kind: "move", transition: g.transitionTo(prev.node, undefined, s.node) };
    }
    case "goto": {
      if (!g.has(intent.node)) return none;
      const step = Math.max(0, Math.min(intent.step ?? 0, g.stepsOf(intent.node)));
      if (intent.node === s.node) return step === s.step ? none : { state: { ...s, step }, kind: "step" };
      return move(intent.node, step);
    }
  }
}
