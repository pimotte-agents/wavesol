// Node plugin contracts. Each plugin has a build half (Node, runs in `wavesol build`/`dev`) and a
// runtime half (browser), so build-only dependencies never end up in the bundle.
import type { z } from "zod";
import type { CompiledNode } from "../model/compiled.ts";
import type { TikzOptions, TikzResult } from "../build/tex.ts";
import type { CiteItem } from "../build/cite.ts";

export interface BuildCtx {
  talkDir: string;
  /** KaTeX macros from macros.tex. */
  macros: Record<string, string>;
  /** Register a file (absolute path) for the output; returns its URL relative to the page. */
  asset(absPath: string): string;
  /** Report a problem in the node's file; `line` is relative to the file. */
  report(severity: "error" | "warning", message: string, line?: number): void;
  /** Formats a citation from the talk's bibliography (and records the works as cited). */
  cite(items: CiteItem[]): { text: string; title: string } | { error: string };
  /** The works cited anywhere in the talk, as HTML (undefined: no bibliography); complete for plugins that build last. */
  references(): string | undefined;
  /** Renders a TikZ picture to inline SVG (cached), with the talk's macros and TikZ setup. */
  tikz(body: string, extra?: TikzOptions): Promise<TikzResult>;
  /** Report a problem in another file (path relative to the talk directory), e.g. a Lean source. */
  reportIn(file: string, severity: "error" | "warning", message: string, line?: number, col?: number): void;
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
  /** Build after all other nodes (e.g. references, which lists what the others cite). */
  buildLast?: boolean;
  build(node: BuildNode<D>, ctx: BuildCtx): Promise<BuildResult>;
}

export type Detail = "overview" | "near" | "active";

export interface NodeApi {
  /** Ask the presentation to go to a step of this node (e.g. clicking a fragment). */
  requestStep(step: number): void;
}

export interface NodeInstance {
  setStep(step: number, opts: { animate: boolean }): void;
  /**
   * The phone's laser rests on `target` (an element inside this node): the step to go to, and an
   * optional focus (a plugin-specific detail of that step, e.g. a Lean tactic). Undefined: ignore.
   */
  pointAt?(target: Element): { step: number; focus?: number } | undefined;
  /** Shows a focus within the current step (from pointAt), or the step itself again (undefined). */
  setFocus?(focus: number | undefined): void;
  /** Marks items by id (a references node: the works a clicked citation cites); [] clears. */
  mark?(ids: string[]): void;
  /** Live data from the projector, e.g. a poll's votes and join link; plugin-specific. */
  setLive?(live: unknown): void;
  setDetail?(level: Detail): void;
  unmount?(): void;
}

export interface RuntimePlugin {
  type: string;
  mount(el: HTMLElement, node: CompiledNode, api: NodeApi): NodeInstance;
}
