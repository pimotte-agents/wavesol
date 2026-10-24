import type { BuildPlugin } from "./types.ts";
import { slide } from "./slide/build.ts";
import { image } from "./image/build.ts";
import { frame } from "./frame/build.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const buildPlugins: Record<string, BuildPlugin<any>> = { slide, image, frame };
