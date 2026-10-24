// TikZ nodes: a picture (the node file's body is TikZ/LaTeX) rendered to SVG at build time, with an
// optional Markdown caption. ```tikz fences in slides use the same renderer (see ../../build/tex.ts).
import MarkdownIt from "markdown-it";
import type { z } from "zod";
import { TikzFrontmatter } from "../../model/schema.ts";
import type { BuildPlugin } from "../types.ts";

export interface TikzData {
  svg: string;
  caption?: string;
}

export const tikz: BuildPlugin<z.infer<typeof TikzFrontmatter>> = {
  type: "tikz",
  schema: TikzFrontmatter,
  hasFile: true,
  async build(node, ctx) {
    const { packages, libraries, preamble, caption } = node.data;
    // a bare tikz-cd diagram or picture commands get their environment
    const body = /\\begin\{(tikzpicture|tikzcd)\}/.test(node.body) ? node.body : `\\begin{tikzpicture}\n${node.body}\\end{tikzpicture}`;
    const wrapped = body !== node.body;
    const r = await ctx.tikz(body, { packages, libraries, preamble });
    const md = new MarkdownIt({ typographer: true });
    const captionHtml = caption ? md.renderInline(caption) : undefined;
    if ("error" in r) {
      ctx.report("error", `tikz: ${r.error}`, r.line === undefined ? undefined : node.bodyLine + r.line - 1 - (wrapped ? 1 : 0));
      return { data: { svg: "", caption: captionHtml } satisfies TikzData, steps: 0 };
    }
    return {
      data: { svg: r.svg, ...(captionHtml ? { caption: captionHtml } : {}) } satisfies TikzData,
      steps: 0,
      notes: node.data.notes ? md.render(node.data.notes) : undefined,
    };
  },
};
