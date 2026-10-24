// Poll nodes: a question (the file's body) and options the audience votes on from their phones.
// With `results: reveal` (default) step 1 shows the results; with `live` they show from the start.
import type { z } from "zod";
import { PollFrontmatter } from "../../model/schema.ts";
import { renderMarkdown } from "../slide/build.ts";
import type { BuildPlugin } from "../types.ts";

export interface PollData {
  question: string;
  options: string[];
  results: "reveal" | "live";
}

export const poll: BuildPlugin<z.infer<typeof PollFrontmatter>> = {
  type: "poll",
  schema: PollFrontmatter,
  hasFile: true,
  async build(node, ctx) {
    const { html, notes, title, md } = await renderMarkdown({ ...node, notes: node.data.notes }, ctx);
    if (!html) ctx.report("error", "a poll needs a question: the file's body");
    const results = node.data.results ?? "reveal";
    return {
      data: { question: html, options: node.data.options.map((o) => md.renderInline(o)), results } satisfies PollData,
      steps: results === "reveal" ? 1 : 0,
      notes,
      title,
    };
  },
};
