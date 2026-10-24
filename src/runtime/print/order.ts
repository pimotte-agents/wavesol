// The order of a talk on paper (PDF, the visual check): the main path along the default edges from
// the start, then everything else in graph order (breadth first along all edges, frames to their
// children included), then what no edge reaches.
import type { CompiledTalk } from "../../model/compiled.ts";
import { NavGraph } from "../nav.ts";

export interface Page {
  node: string;
  step: number;
}

export function printOrder(talk: CompiledTalk, steps: "last" | "all"): Page[] {
  const graph = new NavGraph(talk);
  const order: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return false;
    seen.add(id);
    order.push(id);
    return true;
  };
  for (let id: string | undefined = talk.start; id && add(id); id = graph.outgoing(id).find((e) => e.default)?.to);
  for (let i = 0; i < order.length; i++) for (const e of graph.outgoing(order[i]!)) add(e.to);
  for (const n of talk.nodes) add(n.id);
  return order.flatMap((id) => {
    const n = graph.stepsOf(id);
    return steps === "all" ? Array.from({ length: n + 1 }, (_, step) => ({ node: id, step })) : [{ node: id, step: n }];
  });
}
