// The compiled talk: everything the browser runtime needs, produced at build time by src/build.
import type { z } from "zod";
import type { Transition } from "./schema.ts";

export type TransitionSpec = z.infer<typeof Transition>;

export interface CompiledNode {
  id: string;
  type: string;
  title: string;
  parent?: string;
  children: string[];
  depth: number;
  /** World-space box. `w`/`h` include `scale`. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** World units per node unit; the node's content is laid out at `size` and scaled by this. */
  scale: number;
  size: [number, number];
  steps: number;
  notes?: string;
  transition?: TransitionSpec;
  /** Plugin-specific payload from the plugin's build hook. */
  data: unknown;
}

export interface CompiledEdge {
  from: string;
  to: string;
  label?: string;
  default?: boolean;
  transition?: TransitionSpec;
}

export interface CompiledTalk {
  version: 1;
  meta: { title: string; subtitle?: string; authors?: string[]; date?: string; venue?: string };
  start: string;
  theme: { base: string; vars: Record<string, string> };
  transitions: { default: TransitionSpec };
  nodes: CompiledNode[];
  edges: CompiledEdge[];
}

export interface Diagnostic {
  severity: "error" | "warning";
  /** Path relative to the talk directory. */
  file: string;
  line?: number;
  col?: number;
  message: string;
}

export function formatDiagnostic(d: Diagnostic): string {
  const pos = d.line ? `:${d.line}${d.col ? `:${d.col}` : ""}` : "";
  return `${d.file}${pos}: ${d.severity}: ${d.message}`;
}
