// Generates a test fabric: top-level slides and frames, nested 3 levels deep, flattened into world
// coordinates. Layout is a naive grid; the spike is about the camera, not layout.
import katex from "katex";

export const NODE_W = 1600;
export const NODE_H = 900;

export interface WorldNode {
  id: string;
  title: string;
  kind: "slide" | "frame";
  depth: number;
  x: number; // world position of the top-left corner
  y: number;
  scale: number; // world units per node unit
  parent?: string;
}

const CHILD_SCALE = 0.25; // children are drawn at 1/4 size inside their frame
const GAP = 200;

let counter = 0;
function makeLevel(
  out: WorldNode[],
  depth: number,
  count: number,
  frameAt: number[],
  originX: number,
  originY: number,
  scale: number,
  cols: number,
  parent?: string,
) {
  for (let i = 0; i < count; i++) {
    const kind = frameAt.includes(i) ? "frame" : "slide";
    const id = `${kind[0]}${++counter}`;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = originX + col * (NODE_W + GAP) * scale;
    const y = originY + row * (NODE_H + GAP) * scale;
    out.push({ id, title: `${kind === "frame" ? "Frame" : "Slide"} ${counter} (depth ${depth})`, kind, depth, x, y, scale, parent });
    if (kind === "frame" && depth < 3) {
      // children fill the frame's content box below its title bar
      const inner = scale * CHILD_SCALE;
      makeLevel(out, depth + 1, depth === 2 ? 4 : 6, depth === 2 ? [] : [2], x + 100 * scale, y + 160 * scale, inner, 3, id);
    }
  }
}

export function buildFabric(copies = 1): WorldNode[] {
  counter = 0;
  const out: WorldNode[] = [];
  // 12 top-level nodes, 4 of them frames; each frame has 6 children incl. one frame,
  // which has 6 children incl. one frame with 4 children: 12 + 4*(6 + 6 + 4) = 76 nodes per copy.
  for (let c = 0; c < copies; c++) makeLevel(out, 0, 12, [1, 4, 7, 10], c * 4 * (NODE_W + GAP), 0, 1, 4);
  return out;
}

const formulas = [
  String.raw`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt\pi}{2}`,
  String.raw`\sum_{n=1}^\infty \frac{1}{n^2} = \frac{\pi^2}{6}`,
  String.raw`\mathrm{Hom}(A \otimes B, C) \cong \mathrm{Hom}(A, [B, C])`,
  String.raw`\forall n,\ n \cdot (2 + 2) = n \cdot 4`,
];

function diagram(seed: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => [80 + i * 110, 60 + ((seed * 37 + i * 53) % 140)]);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const dots = pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9"/>`).join("");
  return `<svg viewBox="0 0 720 240" class="diagram"><path d="${path}"/>${dots}</svg>`;
}

export function renderContent(n: WorldNode, index: number): string {
  if (n.kind === "frame") return `<h1>${n.title}</h1>`;
  const f = katex.renderToString(formulas[index % formulas.length]!, { displayMode: true, throwOnError: false });
  return `
    <h1>${n.title}</h1>
    <div class="cols">
      <div>
        <p>Weefsel: every slide is a knot in the fabric. Small text should stay sharp at rest,
        including <code>inline code</code> and <em>emphasis</em>.</p>
        <ul><li>First point about the proof</li><li>Second point, slightly longer than the first</li>
        <li>Third point with $x^2$-free text</li></ul>
        ${f}
      </div>
      <div>${diagram(index)}<p class="small">Figure ${index}: tiny caption text at 20px.</p></div>
    </div>`;
}
