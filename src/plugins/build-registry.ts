import type { BuildPlugin } from "./types.ts";
import { slide } from "./slide/build.ts";
import { image } from "./image/build.ts";
import { frame } from "./frame/build.ts";
import { lean } from "./lean/build.ts";
import { tikz } from "./tikz/build.ts";
import { references } from "./references/build.ts";
import { poll } from "./poll/build.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const buildPlugins: Record<string, BuildPlugin<any>> = { slide, image, frame, lean, tikz, references, poll };
