// Reader for SubVerso's highlighted-module JSON (what `lake build +Mod:highlighted` writes). This is the
// only code that knows that format; SubVerso does not promise it is stable, so this reader is tested
// against fixtures from the pinned version (tests/fixtures/lean) and updated with it.
//
// It resolves the deduplicated tables, selects a declaration or an ANCHOR region, drops marker
// comments (ANCHOR, ANCHOR_END, PROOF_STATE) and the common indentation, and gives each tactic its
// goals before and after. SubVerso records only the state *after* each tactic (for `by`: the initial
// state; for a case arm `| c =>`: the state at the start of that case); the state before a tactic is
// the after-state of the previous tactic at the same level, or the parent's before-state for the
// first nested one (e.g. the first rule of an `rw`).

// ---- SubVerso's JSON (the parts we read) ----

type CodeJson =
  | { seq: { highlights: number[] } }
  | { token: { tok: number } }
  | { text: { str: string } }
  | { tactics: { info: number[]; startPos: number; endPos: number; content: number } }
  | { span: { info: unknown; content: number } }
  | { point: unknown };

interface TokenJson {
  kind: string | Record<string, Record<string, unknown> | null>;
  content: string;
}

interface GoalJson {
  name: string | null;
  goalPrefix: string;
  hypotheses: { names: number[]; typeAndVal: number }[];
  conclusion: number;
}

export interface ModuleJson {
  items: { kind: string; defines: string[]; code: number }[];
  data: { code: Record<string, CodeJson>; tokens: Record<string, TokenJson>; goals: Record<string, GoalJson> };
}

// ---- What the reader produces (also the compiled node data) ----

/** Highlighted code: plain text, a token (CSS kind, text, hover id), or a tactic span around code. */
export type CodeNode = string | { k: string; t: string; h?: number } | { tac: number; c: CodeNode[] };

export interface Hover {
  /** Signature or type, e.g. `List.reverse.{u} {α : Type u} (as : List α) : List α`. */
  sig?: string;
  /** Docstring (Markdown). */
  doc?: string;
}

export interface Goal {
  name?: string;
  hyps: { names: string[]; type: CodeNode[] }[];
  prefix: string;
  concl: CodeNode[];
}

export interface Tactic {
  /** First line of the tactic's source, for labels. */
  text: string;
  /** `by` blocks, case arms and bullets structure a proof; plain tactics change it. */
  kind: "by" | "case" | "tactic";
  /** Goals before the tactic; absent for `by` and case arms, which only open a state. */
  before?: Goal[];
  after: Goal[];
  /** The enclosing tactic, e.g. the `rw` around one of its rules. */
  parent?: number;
}

export interface LeanSelection {
  code: CodeNode[];
  hovers: Hover[];
  tactics: Tactic[];
  /** PROOF_STATE name → index of the tactic whose after-state it names. */
  states: Record<string, number>;
}

export type Selector = { decl: string } | { anchor: string };

// ---- Flattening ----

type Piece =
  | { p: "text"; s: string }
  | { p: "tok"; s: string; tok: number }
  | { p: "open"; tac: number }
  | { p: "close"; tac: number };

interface RawTactic {
  text: string;
  kind: Tactic["kind"];
  before?: number[];
  after: number[];
  parent?: number;
}

interface Flat {
  pieces: Piece[];
  /** String offset of each piece's start. */
  offsets: number[];
  text: string;
  tactics: RawTactic[];
  /** Offset range of each item, with its defined names. */
  items: { start: number; end: number; defines: string[] }[];
}

function flatten(mod: ModuleJson): Flat {
  const { code, tokens } = mod.data;
  const pieces: Piece[] = [];
  const offsets: number[] = [];
  const tactics: RawTactic[] = [];
  let text = "";
  const push = (piece: Piece) => {
    pieces.push(piece);
    offsets.push(text.length);
    if (piece.p === "text" || piece.p === "tok") text += piece.s;
  };
  const plain = (id: number): string => {
    const c = code[id]!;
    if ("seq" in c) return c.seq.highlights.map(plain).join("");
    if ("token" in c) return tokens[c.token.tok]!.content;
    if ("text" in c) return c.text.str;
    if ("tactics" in c) return plain(c.tactics.content);
    if ("span" in c) return plain(c.span.content);
    return "";
  };

  // levels[d]: after-state of the previous tactic at depth d, and the before-state of the enclosing one
  type Level = { last?: number[]; parentBefore?: number[]; parent?: number };
  const walk = (id: number, levels: Level[]) => {
    const c = code[id];
    if (!c) return;
    if ("seq" in c) for (const h of c.seq.highlights) walk(h, levels);
    else if ("token" in c) push({ p: "tok", s: tokens[c.token.tok]!.content, tok: c.token.tok });
    else if ("text" in c) push({ p: "text", s: c.text.str });
    else if ("span" in c) walk(c.span.content, levels);
    else if ("tactics" in c) {
      const level = levels.at(-1)!;
      const src = plain(c.tactics.content).trim();
      const before = level.last ?? level.parentBefore;
      // case arms, bullets and `case`/`next` focus a goal rather than change it
      const kind: Tactic["kind"] = src === "by" ? "by" : /^(\||·|\.(\s|$)|case\s|next\s)/.test(src) ? "case" : "tactic";
      const index =
        tactics.push({
          text: src.split("\n")[0]!,
          kind,
          // a case arm's recorded state is where the case starts; what came before is another case
          before: kind === "tactic" ? before : undefined,
          after: c.tactics.info,
          parent: level.parent,
        }) - 1;
      level.last = c.tactics.info;
      push({ p: "open", tac: index });
      walk(c.tactics.content, [...levels, { parentBefore: before, parent: index }]);
      push({ p: "close", tac: index });
    }
  };

  const items: Flat["items"] = [];
  for (const item of mod.items) {
    const start = text.length;
    walk(item.code, [{}]); // states don't carry across declarations
    items.push({ start, end: text.length, defines: item.defines });
  }
  return { pieces, offsets, text, tactics, items };
}

// ---- Selection ----

const MARKER = /^[ \t]*--[ \t]*(\^[ \t]*)?(ANCHOR|ANCHOR_END|PROOF_STATE):[ \t]*(\S+)?[ \t]*$/;

function range(flat: Flat, sel: Selector): { start: number; end: number } | { error: string } {
  const { text } = flat;
  if ("anchor" in sel) {
    const name = sel.anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const open = new RegExp(`^[ \\t]*--[ \\t]*ANCHOR:[ \\t]*${name}[ \\t]*$`, "m").exec(text);
    if (!open) return { error: `anchor "${sel.anchor}" not found (expected a line "-- ANCHOR: ${sel.anchor}")` };
    const close = new RegExp(`^[ \\t]*--[ \\t]*ANCHOR_END:[ \\t]*${name}[ \\t]*$`, "m").exec(text.slice(open.index));
    if (!close) return { error: `anchor "${sel.anchor}" has no "-- ANCHOR_END: ${sel.anchor}" line` };
    const start = text.indexOf("\n", open.index) + 1;
    return { start, end: open.index + close.index };
  }
  const want = sel.decl;
  const item = flat.items.find((i) => i.defines.some((d) => d === want || d.endsWith(`.${want}`)));
  if (!item) return { error: `declaration "${want}" not found` };
  // skip leading trivia (blank lines, line comments such as anchors), keep doc comments
  let start = item.start;
  for (;;) {
    const eol = text.indexOf("\n", start);
    const line = text.slice(start, eol < 0 ? item.end : eol);
    if (eol < 0 || eol >= item.end || !/^\s*(--.*)?$/.test(line)) break;
    start = eol + 1;
  }
  return { start, end: item.end };
}

/** Selects a declaration or anchor region from a module. */
export function select(mod: ModuleJson, sel: Selector): LeanSelection | { error: string } {
  const flat = flatten(mod);
  const r = range(flat, sel);
  if ("error" in r) return r;

  // the pieces inside the range, cut into lines (text pieces may span lines; tokens never cross the edges)
  type Line = { pieces: Piece[]; text: string; at: number };
  const lines: Line[] = [{ pieces: [], text: "", at: r.start }];
  // tactics that start before the range (e.g. the `by` around an anchor) get no span
  const skip = new Set<number>();
  flat.pieces.forEach((piece, i) => {
    const at = flat.offsets[i]!;
    if (piece.p === "open" || piece.p === "close") {
      if (piece.p === "open" && at < r.start) skip.add(piece.tac);
      const inside = piece.p === "open" ? at >= r.start && at < r.end : at > r.start && at <= r.end;
      if (inside && !skip.has(piece.tac)) lines.at(-1)!.pieces.push(piece);
      return;
    }
    const len = piece.s.length;
    if (at + len <= r.start || at >= r.end) return;
    const from = Math.max(0, r.start - at);
    const s = piece.s.slice(from, Math.min(len, r.end - at));
    if (piece.p === "tok") {
      lines.at(-1)!.pieces.push({ ...piece, s });
      lines.at(-1)!.text += s;
      return;
    }
    let pos = at + from;
    s.split("\n").forEach((part, j) => {
      if (j > 0) lines.push({ pieces: [], text: "", at: pos });
      if (part) {
        lines.at(-1)!.pieces.push({ p: "text", s: part });
        lines.at(-1)!.text += part;
      }
      pos += part.length + 1;
    });
  });

  // marker lines go (their tactic open/close markers stay); PROOF_STATE records where it was
  const named: { name: string; at: number }[] = [];
  const kept: Line[] = [];
  for (const line of lines) {
    const m = MARKER.exec(line.text);
    if (!m) {
      kept.push(line);
      continue;
    }
    if (m[2] === "PROOF_STATE" && m[3]) named.push({ name: m[3], at: line.at });
    const markers = line.pieces.filter((p) => p.p === "open" || p.p === "close");
    if (markers.length) kept.push({ pieces: markers, text: "", at: line.at });
  }
  while (kept.length && !kept[0]!.text.trim() && !kept[0]!.pieces.some((p) => p.p === "open")) kept.shift();
  while (kept.length && !kept.at(-1)!.text.trim() && !kept.at(-1)!.pieces.some((p) => p.p === "close")) kept.pop();

  // common indentation
  const indent = Math.min(...kept.filter((l) => l.text.trim()).map((l) => /^[ \t]*/.exec(l.text)![0].length), Infinity);
  const cut = Number.isFinite(indent) ? indent : 0;

  // rebuild the tree; tactics that are fully inside the range get local numbers
  const local = new Map<number, number>();
  const tactics: Tactic[] = [];
  const hoverIds = new Map<string, number>();
  const hovers: Hover[] = [];
  const goalsCache = new Map<number, Goal>();
  const { tokens, goals } = mod.data;

  const hoverOf = (tok: number): number | undefined => {
    const h = hoverFor(tokens[tok]!);
    if (!h) return undefined;
    const key = JSON.stringify(h);
    let id = hoverIds.get(key);
    if (id === undefined) hoverIds.set(key, (id = hovers.push(h) - 1));
    return id;
  };
  const tokenNode = (tok: number, s: string): CodeNode => {
    const t = tokens[tok]!;
    const h = hoverOf(tok);
    return h === undefined ? { k: kindName(t), t: s } : { k: kindName(t), t: s, h };
  };
  const codeTree = (id: number): CodeNode[] => {
    // goals' code: no tactics inside, no selection
    const c = mod.data.code[id];
    if (!c) return [];
    if ("seq" in c) return c.seq.highlights.flatMap(codeTree);
    if ("token" in c) return [tokenNode(c.token.tok, tokens[c.token.tok]!.content)];
    if ("text" in c) return [c.text.str];
    if ("tactics" in c) return codeTree(c.tactics.content);
    if ("span" in c) return codeTree(c.span.content);
    return [];
  };
  const goal = (id: number): Goal => {
    let g = goalsCache.get(id);
    if (g) return g;
    const raw = goals[id]!;
    g = {
      ...(raw.name ? { name: raw.name } : {}),
      hyps: raw.hypotheses.map((h) => ({ names: h.names.map((n) => tokens[n]!.content), type: codeTree(h.typeAndVal) })),
      prefix: raw.goalPrefix,
      concl: codeTree(raw.conclusion),
    };
    goalsCache.set(id, g);
    return g;
  };

  const root: CodeNode[] = [];
  const open: { tac?: number; c: CodeNode[] }[] = [{ c: root }];
  const ends: { tac: number; at: number }[] = [];
  kept.forEach((line, li) => {
    if (li > 0) open.at(-1)!.c.push("\n");
    let drop = cut;
    for (const piece of line.pieces) {
      if (piece.p === "open") {
        const raw = flat.tactics[piece.tac]!;
        const parent = raw.parent === undefined ? undefined : local.get(raw.parent);
        const n =
          tactics.push({
            text: raw.text,
            kind: raw.kind,
            ...(raw.before ? { before: raw.before.map(goal) } : {}),
            after: raw.after.map(goal),
            ...(parent === undefined ? {} : { parent }),
          }) - 1;
        local.set(piece.tac, n);
        const node = { tac: n, c: [] as CodeNode[] };
        open.at(-1)!.c.push(node);
        open.push(node);
        continue;
      }
      if (piece.p === "close") {
        const n = local.get(piece.tac);
        if (n === undefined || open.at(-1)!.tac !== n) continue;
        open.pop();
        ends.push({ tac: n, at: line.at });
        continue;
      }
      let s = piece.s;
      if (drop > 0) {
        const lead = /^[ \t]*/.exec(s)![0].length;
        const n = Math.min(drop, lead);
        s = s.slice(n);
        drop = lead < piece.s.length ? 0 : drop - n;
      }
      if (!s) continue;
      open.at(-1)!.c.push(piece.p === "tok" ? tokenNode(piece.tok, s) : s);
    }
  });

  // a PROOF_STATE names the state after the last tactic that ended before it
  const states: Record<string, number> = {};
  for (const { name, at } of named) {
    const done = ends.filter((e) => e.at <= at).map((e) => e.tac);
    if (done.length) states[name] = Math.max(...done);
  }
  return { code: merge(root), hovers, tactics, states };
}

/** Joins adjacent plain strings (marker removal and dedenting leave them split). */
function merge(nodes: CodeNode[]): CodeNode[] {
  const out: CodeNode[] = [];
  for (const n of nodes) {
    const node = typeof n === "object" && "tac" in n ? { tac: n.tac, c: merge(n.c) } : n;
    if (typeof node === "string" && typeof out.at(-1) === "string") out[out.length - 1] = (out.at(-1) as string) + node;
    else out.push(node);
  }
  return out;
}

function kindName(t: TokenJson): string {
  return typeof t.kind === "string" ? t.kind : (Object.keys(t.kind)[0] ?? "unknown");
}

function hoverFor(t: TokenJson): Hover | undefined {
  if (typeof t.kind === "string") return undefined;
  const [kind, info] = Object.entries(t.kind)[0] ?? [];
  if (!info) return undefined;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  let h: Hover;
  // brackets, `=>`, commas: their docs ("Explicit binder, …") are noise next to the code
  if (kind === "bracket" || kind === "delim" || kind === "separator") return undefined;
  if (kind === "const") h = { sig: str(info.signature), doc: str(info.docs) };
  else if (kind === "var") h = { sig: str(info.type) && `${t.content} : ${str(info.type)}` };
  else if (kind === "sort") h = { doc: str(info["doc?"]) };
  else h = { doc: str(info.docs) };
  if (!h.sig) delete h.sig;
  if (!h.doc) delete h.doc;
  return h.sig || h.doc ? h : undefined;
}
