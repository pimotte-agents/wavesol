// References nodes: the works cited anywhere in the talk ([@key] in slides), in author–year style.
// Defined in talk.yaml only; built after every other node, so all citations are known.
//
// A list too long for one slide is split into pages, one per step (the PDF prints every page). The
// build estimates how many pages are needed, from the length of the entries, so the step count is
// known everywhere (navigation, presenter view, phone, PDF); the runtime then measures the entries
// and spreads them evenly over those pages, shrinking the text a little if they still don't fit.
import type { z } from "zod";
import { ReferencesFrontmatter } from "../../model/schema.ts";
import type { BuildPlugin } from "../types.ts";

export interface ReferencesData {
  html: string;
  /** Number of pages (steps + 1). */
  pages: number;
}

/** Slide padding (64px 88px) and the h1 block, as in the theme. */
const PAD_X = 176;
const PAD_Y = 128;
/** Average glyph width in em, measured on the built-in themes (about 105 characters a line at 1600 wide). */
const GLYPH_EM = 0.43;

/**
 * Estimated number of pages for the references, laid out at `size` with the slide font size
 * `fontSize` (px). Mirrors the theme: entries at 0.85em, line height 1.45, 1.5em hanging indent,
 * 0.5em apart; the heading is 1.9em with its rule and margin.
 */
export function estimatePages(entries: string[], size: [number, number], fontSize: number): number {
  if (!entries.length) return 1;
  const em = 0.85 * fontSize;
  const heading = 1.9 * fontSize * (1.15 + 0.25 + 0.6) + 3;
  const avail = size[1] - PAD_Y - heading;
  const charsPerLine = Math.max(10, (size[0] - PAD_X - 1.5 * em) / (GLYPH_EM * em));
  // fractional lines (half a line for the ragged last one), so rounding errors even out over a page
  const heights = entries.map((text) => (text.length / charsPerLine + 0.5) * 1.45 * em + 0.5 * em);
  let pages = 1;
  let used = 0;
  for (const h of heights) {
    if (used > 0 && used + h > avail) {
      pages++;
      used = 0;
    }
    used += h;
  }
  return pages;
}

/** The plain text of each entry in citation-js's bibliography HTML. */
export function entryTexts(html: string): string[] {
  return [...html.matchAll(/<div [^>]*class="csl-entry"[^>]*>([\s\S]*?)<\/div>/g)].map((m) =>
    m[1]!
      .replace(/<[^>]*>/g, "")
      .replace(/&[a-z#0-9]+;/gi, "x")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

export const references: BuildPlugin<z.infer<typeof ReferencesFrontmatter>> = {
  type: "references",
  schema: ReferencesFrontmatter,
  hasFile: false,
  buildLast: true,
  async build(node, ctx) {
    const html = ctx.references();
    if (html === undefined) ctx.report("error", "a references node needs a bibliography: add refs.bib, or bibliography: in talk.yaml");
    else if (!html) ctx.report("warning", "no citations: this references node is empty");
    const pages = estimatePages(entryTexts(html ?? ""), node.size, ctx.fontSize);
    return { data: { html: html ?? "", pages } satisfies ReferencesData, steps: pages - 1, paged: true, title: node.data.title ?? "References" };
  },
};
