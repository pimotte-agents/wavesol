import type { RuntimePlugin } from "./types.ts";
import { slide } from "./slide/runtime.ts";
import { image } from "./image/runtime.ts";
import { frame } from "./frame/runtime.ts";
import { lean } from "./lean/runtime.ts";

export const runtimePlugins: Record<string, RuntimePlugin> = { slide, image, frame, lean };
