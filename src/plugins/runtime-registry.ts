import type { RuntimePlugin } from "./types.ts";
import { slide } from "./slide/runtime.ts";
import { image } from "./image/runtime.ts";
import { frame } from "./frame/runtime.ts";
import { lean } from "./lean/runtime.ts";
import { tikz } from "./tikz/runtime.ts";
import { references } from "./references/runtime.ts";

export const runtimePlugins: Record<string, RuntimePlugin> = { slide, image, frame, lean, tikz, references };
