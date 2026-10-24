// Image nodes: a single figure (any browser-supported image format) with an optional caption.
import MarkdownIt from "markdown-it";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { z } from "zod";
import { ImageFrontmatter } from "../../model/schema.ts";
import type { BuildPlugin } from "../types.ts";

export interface ImageData {
  src: string;
  caption?: string;
  fit: "contain" | "cover";
}

export const image: BuildPlugin<z.infer<typeof ImageFrontmatter>> = {
  type: "image",
  schema: ImageFrontmatter,
  hasFile: true,
  async build(node, ctx) {
    let src = node.data.src;
    if (!/^[a-z]+:/i.test(src)) {
      const abs = resolve(dirname(node.file!), src);
      if (!existsSync(abs)) ctx.report("error", `image ${src} not found`);
      else src = ctx.asset(abs);
    }
    const md = new MarkdownIt({ typographer: true });
    const data: ImageData = {
      src,
      caption: node.data.caption ? md.renderInline(node.data.caption) : undefined,
      fit: node.data.fit ?? "contain",
    };
    return { data, steps: 0, notes: node.data.notes ? md.render(node.data.notes) : undefined };
  },
};
