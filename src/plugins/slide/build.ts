// Slide nodes: Markdown → HTML at build time, with KaTeX math, Shiki code highlighting, reveal-style
// fragments ({.fragment step=n} or ::: fragment blocks), ::: notes and :::: columns blocks.
import MarkdownIt, { type Env as MdEnv, type Token } from "markdown-it";
import { attrs } from "@mdit/plugin-attrs";
import { container } from "@mdit/plugin-container";
import { tex } from "@mdit/plugin-tex";
import katex from "katex";
import { createHighlighter, bundledLanguages, type Highlighter } from "shiki";
import { dirname, resolve } from "node:path";
import { SlideFrontmatter } from "../../model/schema.ts";
import type { BuildCtx, BuildPlugin } from "../types.ts";
import { parseCitation, type CiteItem } from "../../build/cite.ts";
import type { z } from "zod";

export interface SlideData {
  html: string;
}

let highlighter: Promise<Highlighter> | undefined;
// both themes' colours, as CSS variables (--shiki-light / --shiki-dark); the page's theme picks one
const SHIKI_THEMES = { light: "github-light", dark: "github-dark" } as const;

async function getHighlighter(langs: string[]): Promise<Highlighter> {
  highlighter ??= createHighlighter({ themes: Object.values(SHIKI_THEMES), langs: [] });
  const h = await highlighter;
  const missing = langs.filter((l) => l in bundledLanguages && !h.getLoadedLanguages().includes(l));
  if (missing.length) await h.loadLanguage(...(missing as (keyof typeof bundledLanguages)[]));
  return h;
}

interface Env extends MdEnv {
  ctx: BuildCtx;
  /** Rendered ```tikz / ```tikzcd fences, by token (rendered before the synchronous Markdown pass). */
  tikz?: Map<Token, string>;
  file?: string;
  body: string;
  bodyLine: number;
}

function renderMath(content: string, displayMode: boolean, env: Env): string {
  try {
    const html = katex.renderToString(content, { displayMode, macros: { ...env.ctx.macros }, throwOnError: true, strict: "ignore" });
    return displayMode ? `<div class="math-display">${html}</div>` : html;
  } catch (e) {
    const at = env.body.indexOf(content);
    const line = at < 0 ? undefined : env.bodyLine + env.body.slice(0, at).split("\n").length - 1;
    env.ctx.report("error", `math: ${e instanceof Error ? e.message : String(e)}`, line);
    const escaped = content.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<span class="math-error">${escaped}</span>`;
  }
}

function createMarkdown(h: Highlighter): ReturnType<typeof MarkdownIt> {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight: (code, lang) => {
      const l = lang && h.getLoadedLanguages().includes(lang) ? lang : "text";
      return h.codeToHtml(code, { lang: l, themes: SHIKI_THEMES, defaultColor: false });
    },
  });
  md.use(tex, { render: (content: string, displayMode: boolean, env) => renderMath(content, displayMode, env as Env) });
  md.use(attrs);
  for (const name of ["notes", "columns", "column"]) md.use(container, { name });
  md.use(container, {
    name: "fragment",
    openRenderer: (tokens, idx, _options, _env, self) => `<div${self.renderAttrs(tokens[idx]!)}>\n`,
  });

  // citations: [@key], [@key, p. 3], [@a; @b] (before links, which also start with "[")
  md.inline.ruler.before("link", "cite", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */ || state.src.charCodeAt(state.pos + 1) !== 0x40 /* @ */) return false;
    const end = state.src.indexOf("]", state.pos);
    if (end < 0) return false;
    const inner = state.src.slice(state.pos + 1, end);
    const items = parseCitation(inner);
    if (!items) return false;
    if (!silent) {
      const token = state.push("cite", "", 0);
      token.meta = { items, source: `[${inner}]` };
    }
    state.pos = end + 1;
    return true;
  });
  md.renderer.rules.cite = (tokens, idx, _options, mdEnv) => {
    const env = mdEnv as Env;
    const { items, source } = tokens[idx]!.meta as { items: CiteItem[]; source: string };
    const r = env.ctx.cite(items);
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    if ("error" in r) {
      const at = env.body.indexOf(source);
      env.ctx.report("error", r.error, at < 0 ? undefined : env.bodyLine + env.body.slice(0, at).split("\n").length - 1);
      return `<span class="ws-cite ws-cite-error">${esc(source)}</span>`;
    }
    // data-keys: a click takes the projector to the references slide, with these works marked
    return `<span class="ws-cite" data-keys="${esc(items.map((i) => i.id).join(" "))}" title="${esc(r.title)}">${esc(r.text)}</span>`;
  };

  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, mdEnv, self) => {
    const figure = (mdEnv as Env).tikz?.get(tokens[idx]!);
    return figure ?? defaultFence(tokens, idx, options, mdEnv, self);
  };

  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, mdEnv, self) => {
    const env = mdEnv as Env;
    const token = tokens[idx]!;
    const src = String(token.attrGet("src") ?? "");
    if (src && env.file && !/^([a-z]+:|\/|#)/i.test(src)) token.attrSet("src", env.ctx.asset(resolve(dirname(env.file), src)));
    return defaultImage(tokens, idx, options, env, self);
  };
  return md;
}

const TIKZ_FENCES = { tikz: "tikzpicture", tikzcd: "tikzcd" } as const;

/** Renders ```tikz (picture commands) and ```tikzcd (a diagram) fences to inline SVG figures. */
async function renderTikzFences(tokens: Token[], env: Env) {
  env.tikz = new Map();
  for (const t of tokens) {
    const lang = t.type === "fence" ? (t.info.trim().split(/\s/)[0] as keyof typeof TIKZ_FENCES) : undefined;
    if (!lang || !(lang in TIKZ_FENCES)) continue;
    const envName = TIKZ_FENCES[lang];
    const body = t.content.includes(`\\begin{${envName}}`) ? t.content : `\\begin{${envName}}\n${t.content}\\end{${envName}}`;
    const wrapped = body !== t.content;
    const r = await env.ctx.tikz(body);
    if ("error" in r) {
      // fence content starts on the line after the opening fence; wrapping added one line before it
      const line = t.map && r.line !== undefined ? env.bodyLine + t.map[0] + r.line - (wrapped ? 1 : 0) : undefined;
      env.ctx.report("error", `tikz: ${r.error}`, line);
      env.tikz.set(t, `<pre class="math-error">${t.content.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`);
    } else env.tikz.set(t, `<figure class="ws-tikz-figure">${r.svg}</figure>\n`);
  }
}

/** Assigns data-step to fragment tokens and returns the number of distinct steps. */
export function assignFragments(tokens: Token[], lists: boolean): number {
  if (lists) {
    let listDepth = 0;
    for (const t of tokens) {
      if (t.type === "bullet_list_open" || t.type === "ordered_list_open") listDepth++;
      else if (t.type === "bullet_list_close" || t.type === "ordered_list_close") listDepth--;
      else if (t.type === "list_item_open" && listDepth === 1) t.attrJoin("class", "fragment");
    }
  }
  for (const t of tokens) {
    // ::: fragment [step=n] [effect classes]
    if (t.type !== "container_fragment_open") continue;
    t.attrJoin("class", "fragment");
    for (const word of t.info.trim().split(/\s+/).slice(1)) {
      const step = word.match(/^step=(\d+)$/);
      if (step) t.attrSet("step", step[1]!);
      else if (word) t.attrJoin("class", word.replace(/^\./, ""));
    }
  }
  // A fragment without `step` comes one step after the previous fragment; `step=n` sets it explicitly.
  const fragments: { token: Token; step: number }[] = [];
  let previous = 0;
  const visit = (ts: Token[]) => {
    for (const t of ts) {
      if (t.nesting !== -1 && String(t.attrGet("class") ?? "").split(/\s+/).includes("fragment")) {
        const explicit = Number(t.attrGet("step"));
        previous = Number.isInteger(explicit) && explicit > 0 ? explicit : previous + 1;
        fragments.push({ token: t, step: previous });
      }
      if (t.children) visit(t.children);
    }
  };
  visit(tokens);
  const ranks = [...new Set(fragments.map((f) => f.step))].sort((a, b) => a - b);
  for (const f of fragments) {
    f.token.attrs = (f.token.attrs ?? []).filter(([k]) => k !== "step");
    f.token.attrSet("data-step", String(ranks.indexOf(f.step) + 1));
  }
  return ranks.length;
}

function extractNotes(tokens: Token[]): { slide: Token[]; notes: Token[] } {
  const slide: Token[] = [];
  const notes: Token[] = [];
  let depth = 0;
  for (const t of tokens) {
    if (t.type === "container_notes_open") depth++;
    else if (t.type === "container_notes_close") depth--;
    else (depth ? notes : slide).push(t);
  }
  return { slide, notes };
}

function firstHeading(tokens: Token[]): string | undefined {
  const i = tokens.findIndex((t) => t.type === "heading_open" && t.tag === "h1");
  return i >= 0 ? tokens[i + 1]?.children?.filter((c) => c.type === "text" || c.type === "code_inline").map((c) => c.content).join("").trim() : undefined;
}

type Data = z.infer<typeof SlideFrontmatter>;

/** Renders a Markdown body (and frontmatter notes) as a slide does, for plugins with a caption. */
export async function renderMarkdown(node: { body: string; file?: string; bodyLine: number; notes?: string }, ctx: BuildCtx) {
  const langs = [...node.body.matchAll(/^\s*(?:```|~~~)\s*([\w+-]+)/gm)].map((m) => m[1]!);
  const md = createMarkdown(await getHighlighter(langs));
  const env: Env = { ctx, file: node.file, body: node.body, bodyLine: node.bodyLine };
  const parsed = md.parse(node.body, env);
  await renderTikzFences(parsed, env);
  const { slide: tokens, notes } = extractNotes(parsed);
  const notesHtml = [node.notes ? md.render(node.notes, env) : "", md.renderer.render(notes, md.options, env)].join("").trim();
  return { html: md.renderer.render(tokens, md.options, env).trim(), notes: notesHtml || undefined, title: firstHeading(tokens), md };
}

export const slide: BuildPlugin<Data> = {
  type: "slide",
  schema: SlideFrontmatter,
  hasFile: true,
  async build(node, ctx) {
    const langs = [...node.body.matchAll(/^\s*(?:```|~~~)\s*([\w+-]+)/gm)].map((m) => m[1]!);
    const md = createMarkdown(await getHighlighter(langs));
    const env: Env = { ctx, file: node.file, body: node.body, bodyLine: node.bodyLine };
    const tokens = md.parse(node.body, env);
    await renderTikzFences(tokens, env);
    const { slide: slideTokens, notes: noteTokens } = extractNotes(tokens);
    const steps = assignFragments(slideTokens, node.data.fragments === "lists");

    for (const t of tokens) {
      const lang = t.info.split(/\s/)[0]!;
      if (t.map && t.type === "fence" && t.info && !(lang in bundledLanguages) && !(lang in TIKZ_FENCES)) {
        ctx.report("warning", `unknown code language "${t.info}", rendered as plain text`, node.bodyLine + t.map[0]);
      }
    }
    const html = md.renderer.render(slideTokens, md.options, env);

    const notesHtml = [node.data.notes ? md.render(node.data.notes, env) : "", md.renderer.render(noteTokens, md.options, env)].join("").trim();
    const data: SlideData = { html };
    return { data, steps, notes: notesHtml || undefined, title: firstHeading(slideTokens) };
  },
};
