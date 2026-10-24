// The whole fabric as boxes and edges: current node highlighted, visited nodes tinted, click to go.
import type { CompiledTalk } from "../../model/compiled.ts";

interface Props {
  talk: CompiledTalk;
  current: string;
  visited: Set<string>;
  onGo(node: string): void;
}

export function MiniMap({ talk, current, visited, onGo }: Props) {
  const top = talk.nodes.filter((n) => n.depth === 0);
  const x0 = Math.min(...top.map((n) => n.x));
  const y0 = Math.min(...top.map((n) => n.y));
  const w = Math.max(...top.map((n) => n.x + n.w)) - x0;
  const h = Math.max(...top.map((n) => n.y + n.h)) - y0;
  const pad = 0.03 * Math.max(w, h);
  const byId = new Map(talk.nodes.map((n) => [n.id, n]));
  const center = (id: string) => {
    const n = byId.get(id)!;
    return [n.x + n.w / 2, n.y + n.h / 2] as const;
  };

  return (
    <svg className="ws-minimap" viewBox={`${x0 - pad} ${y0 - pad} ${w + 2 * pad} ${h + 2 * pad}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mini-map">
      {talk.edges.map((e, i) => {
        const [ax, ay] = center(e.from);
        const [bx, by] = center(e.to);
        return <line key={i} className="ws-minimap-edge" x1={ax} y1={ay} x2={bx} y2={by} vectorEffect="non-scaling-stroke" />;
      })}
      {[...talk.nodes]
        .sort((a, b) => a.depth - b.depth)
        .map((n) => (
          <rect
            key={n.id}
            data-id={n.id}
            className={`ws-minimap-node ws-type-${n.type}${n.id === current ? " ws-current" : ""}${visited.has(n.id) ? " ws-visited" : ""}`}
            x={n.x}
            y={n.y}
            width={n.w}
            height={n.h}
            rx={Math.min(n.w, n.h) * 0.04}
            vectorEffect="non-scaling-stroke"
            onClick={() => onGo(n.id)}
          >
            <title>{n.title}</title>
          </rect>
        ))}
    </svg>
  );
}
