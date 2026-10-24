// Node plugin contracts. Each plugin has a build half (Node, runs in `wavesol build`/`dev`) and a
// runtime half (browser), so build-only dependencies never end up in the bundle.
import type { z } from "zod";
import type { CompiledNode } from "../model/compiled.ts";

export interface BuildCtx {
  talkDir: string;
  /** KaTeX macros from macros.tex. */
  macros: Record<string, string>;
  /** Register a file (absolute path) for the output; returns its URL relative to the page. */
  asset(absPath: string): string;
  /** Report a problem in the node's file; `line` is relative to the file. */
  report(severity: "error" | "warning", message: string, line?: number): void;
}

export interface BuildNode<D> {
  id: string;
  data: D;
  /** Markdown body after the frontmatter ("" for nodes without a file). */
  body: string;
  /** Absolute path of the node file, if any. */
  file?: string;
  /** 1-based line of the first body line in `file`. */
  bodyLine: number;
}

export interface BuildResult {
  data: unknown;
  steps: number;
  /** Speaker notes as HTML. */
  notes?: string;
  /** Title derived from content (e.g. first heading), used when none is given explicitly. */
  title?: string;
}

export interface BuildPlugin<D = unknown> {
  type: string;
  schema: z.ZodType<D>;
  /** Whether nodes of this type have a content file. */
  hasFile: boolean;
  build(node: BuildNode<D>, ctx: BuildCtx): Promise<BuildResult>;
}

export type Detail = "overview" | "near" | "active";

export interface NodeApi {
  /** Ask the presentation to go to a step of this node (e.g. clicking a fragment). */
  requestStep(step: number): void;
}

export interface NodeInstance {
  setStep(step: number, opts: { animate: boolean }): void;
  setDetail?(level: Detail): void;
  unmount?(): void;
}

export interface RuntimePlugin {
  type: string;
  mount(el: HTMLElement, node: CompiledNode, api: NodeApi): NodeInstance;
}
