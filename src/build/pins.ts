// Drag mode in `wavesol dev`: a dragged node's new world position becomes `pin: [x, y]` in talk.yaml.
// Pins are in the layout space of the node's level: world units at the top level, the frame's own
// layout space inside a frame (which the frame then scales to fit; see src/layout/layout.ts).
import { isMap, isNode, isScalar, parseDocument } from "yaml";
import type { CompiledTalk } from "../model/compiled.ts";
import type { FrameSpace } from "../layout/layout.ts";

/** The pin that puts node `id`'s top-left corner at world position `at`. */
export function pinFor(talk: CompiledTalk, frames: Map<string, FrameSpace>, id: string, at: [number, number]): [number, number] | undefined {
  const node = talk.nodes.find((n) => n.id === id);
  if (!node) return undefined;
  if (!node.parent) return [Math.round(at[0]), Math.round(at[1])];
  const parent = talk.nodes.find((n) => n.id === node.parent)!;
  const f = frames.get(parent.id);
  if (!f) return undefined;
  // world = parent + (d + local · s) · parent.scale, solved for local
  return [Math.round(((at[0] - parent.x) / parent.scale - f.dx) / f.s), Math.round(((at[1] - parent.y) / parent.scale - f.dy) / f.s)];
}

/**
 * Sets `pin` for node `id` in talk.yaml's text. Only that entry's text changes (the rest of the file,
 * comments and alignment included, is left exactly as is). A `near` hint goes: it would override the
 * pin. Undefined if the node is not in `nodes`.
 */
export function writePin(yamlText: string, id: string, pin: [number, number]): string | undefined {
  const doc = parseDocument(yamlText);
  const nodes = doc.get("nodes", true);
  if (!isMap(nodes)) return undefined;
  const pair = nodes.items.find((p) => isScalar(p.key) && String(p.key.value) === id);
  if (!pair || !isScalar(pair.key) || !pair.key.range) return undefined;
  const value = `[${pin[0]}, ${pin[1]}]`;
  const edits: { from: number; to: number; text: string }[] = [];
  const entry = pair.value;

  if (!isMap(entry) || !entry.range) {
    // `id:` or `id: null`: the entry becomes a flow map
    const colon = yamlText.indexOf(":", pair.key.range[1]);
    const end = isScalar(entry) && entry.range ? entry.range[1] : colon + 1;
    edits.push({ from: colon + 1, to: end, text: ` { pin: ${value} }` });
  } else {
    const range = (n: unknown) => (n as { range: [number, number, number] }).range;
    const keyIs = (p: (typeof entry.items)[number], k: string) => isScalar(p.key) && p.key.value === k;
    const source = (p: (typeof entry.items)[number]) => yamlText.slice(range(p.key)[0], range(p.value ?? p.key)[1]);
    if (entry.flow) {
      // rebuilt from its items' own text, without near and the old pin
      const parts = entry.items.filter((p) => !keyIs(p, "near") && !keyIs(p, "pin")).map(source);
      const [start, end] = range(entry);
      edits.push({ from: start, to: end, text: `{ ${[...parts, `pin: ${value}`].join(", ")} }` });
    } else {
      const existing = entry.items.find((p) => keyIs(p, "pin"));
      if (existing && isNode(existing.value)) edits.push({ from: range(existing.value)[0], to: range(existing.value)[1], text: value });
      else {
        // a new line after the last key, at the keys' indentation
        const first = range(entry.items[0]!.key)[0];
        const indent = first - (yamlText.lastIndexOf("\n", first - 1) + 1);
        const last = entry.items.at(-1)!;
        const end = range(last.value ?? last.key)[1];
        edits.push({ from: end, to: end, text: `\n${" ".repeat(indent)}pin: ${value}` });
      }
      const near = entry.items.find((p) => keyIs(p, "near"));
      if (near) {
        // its whole line(s)
        const from = yamlText.lastIndexOf("\n", range(near.key)[0] - 1);
        edits.push({ from, to: range(near.value ?? near.key)[1], text: "" });
      }
    }
  }
  let out = yamlText;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}
