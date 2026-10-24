// Spike: decode `subverso-extract-mod` output (deduplicated tables) and print, per declaration,
// the source text plus every tactic with its goal state. Proves the data is enough for an
// infoview; the real build should not depend on this unstable format (see FINDINGS.md).
// Usage: npx tsx spikes/lean/decode.ts <module.json>
import { readFileSync } from "node:fs";

type Code =
  | { seq: { highlights: number[] } }
  | { token: { tok: number } }
  | { text: { str: string } }
  | { tactics: { info: number[]; startPos: number; endPos: number; content: number } }
  | { span: { info: unknown; content: number } }
  | { point: unknown };
interface Token { kind: unknown; content: string }
interface Goal {
  name: string | null;
  goalPrefix: string;
  hypotheses: { names: number[]; typeAndVal: number }[];
  conclusion: number;
}
interface Module {
  data: { code: Record<string, Code>; tokens: Record<string, Token>; goals: Record<string, Goal> };
  items: { kind: string; defines: string[]; code: number }[];
}

const mod: Module = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const { code, tokens, goals } = mod.data;

function text(id: number): string {
  const c = code[id]!;
  if ("seq" in c) return c.seq.highlights.map(text).join("");
  if ("token" in c) return tokens[c.token.tok]!.content;
  if ("text" in c) return c.text.str;
  if ("tactics" in c) return text(c.tactics.content);
  if ("span" in c) return text(c.span.content);
  return "";
}

function goalText(g: Goal): string {
  const hyps = g.hypotheses.map((h) => `${h.names.map((n) => tokens[n]!.content).join(" ")} ${text(h.typeAndVal)}`);
  return [g.name ? `case ${g.name}` : null, ...hyps, `${g.goalPrefix}${text(g.conclusion)}`]
    .filter(Boolean)
    .join("\n    ");
}

function tactics(id: number, out: { src: string; goals: string[] }[]) {
  const c = code[id]!;
  if ("seq" in c) c.seq.highlights.forEach((h) => tactics(h, out));
  else if ("tactics" in c) {
    out.push({ src: text(c.tactics.content), goals: c.tactics.info.map((g) => goalText(goals[g]!)) });
    tactics(c.tactics.content, out);
  } else if ("span" in c) tactics(c.span.content, out);
}

let hovers = 0;
for (const t of Object.values(tokens)) if (t.kind && typeof t.kind === "object" && "const" in t.kind) hovers++;
console.log(`tokens with const hover info: ${hovers}/${Object.keys(tokens).length}\n`);

for (const item of mod.items.filter((i) => i.defines.length)) {
  console.log(`== ${item.defines.join(", ")}\n${text(item.code).trim()}\n`);
  const out: { src: string; goals: string[] }[] = [];
  tactics(item.code, out);
  for (const t of out) {
    console.log(`  tactic: ${JSON.stringify(t.src.trim().split("\n")[0])}`);
    console.log(t.goals.length ? t.goals.map((g) => `    ${g}`).join("\n    --\n") : "    (no goals)");
  }
  console.log();
}
