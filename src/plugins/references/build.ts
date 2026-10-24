// References nodes: the works cited anywhere in the talk ([@key] in slides), in author–year style.
// Defined in talk.yaml only; built after every other node, so all citations are known.
import type { z } from "zod";
import { ReferencesFrontmatter } from "../../model/schema.ts";
import type { BuildPlugin } from "../types.ts";

export interface ReferencesData {
  html: string;
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
    return { data: { html: html ?? "" } satisfies ReferencesData, steps: 0, title: node.data.title ?? "References" };
  },
};
