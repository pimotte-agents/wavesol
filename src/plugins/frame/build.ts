// Frames: containers for a subgraph, defined in talk.yaml only. Their children are laid out and
// scaled into the frame's content box by src/layout.
import { FrameFrontmatter } from "../../model/schema.ts";
import type { BuildPlugin } from "../types.ts";
import type { z } from "zod";

export const frame: BuildPlugin<z.infer<typeof FrameFrontmatter>> = {
  type: "frame",
  schema: FrameFrontmatter,
  hasFile: false,
  async build() {
    return { data: {}, steps: 0 };
  },
};
