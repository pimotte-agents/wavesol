// Compiles a talk directory into a CompiledTalk: load + validate, run plugin build hooks, lay out.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { CompiledNode, CompiledTalk, Diagnostic } from "../model/compiled.ts";
import { buildPlugins } from "../plugins/build-registry.ts";
import type { BuildCtx } from "../plugins/types.ts";
import { layout, type FrameSpace } from "../layout/layout.ts";
import { loadTalk } from "./load.ts";
import { parseMacros } from "./macros.ts";
import { renderTikz, type TikzOptions } from "./tex.ts";
import { loadBibliography, type Bibliography } from "./cite.ts";

export const NODE_SIZE: [number, number] = [1600, 900];

export interface CompileResult {
  talk?: CompiledTalk;
  diagnostics: Diagnostic[];
  /** Output URL (relative to the page) → absolute source path. */
  assets: Map<string, string>;
  /** Files the result depends on, for watching. */
  inputs: string[];
  /** Each frame's child space, to turn a dragged node's world position into a pin (wavesol dev). */
  frames?: Map<string, FrameSpace>;
  /** Each node's source file, relative to the talk (talk.yaml for nodes without a file). */
  files?: Map<string, string>;
}

export async function compileTalk(dir: string): Promise<CompileResult> {
  const result = await compile(dir);
  result.diagnostics.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return result;
}

async function compile(dir: string): Promise<CompileResult> {
  const assets = new Map<string, string>();
  const { talk: loaded, diagnostics } = loadTalk(dir);
  const inputs = [join(dir, "talk.yaml")];
  if (!loaded || diagnostics.some((d) => d.severity === "error")) return { diagnostics, assets, inputs };
  const { talk } = loaded;

  const macrosFile = talk.math?.macros ?? (existsSync(join(dir, "macros.tex")) ? "macros.tex" : undefined);
  let macros: Record<string, string> = {};
  if (macrosFile) {
    const path = join(dir, macrosFile);
    inputs.push(path);
    if (!existsSync(path)) diagnostics.push({ severity: "error", file: "talk.yaml", message: `macros file ${macrosFile} not found` });
    else {
      const parsed = parseMacros(readFileSync(path, "utf8"));
      macros = parsed.macros;
      for (const e of parsed.errors) diagnostics.push({ severity: "error", file: macrosFile, line: e.line, message: e.message });
    }
  }

  const asset = (abs: string) => {
    inputs.push(abs);
    const hash = createHash("sha1").update(readFileSync(abs)).digest("hex").slice(0, 8);
    const ext = extname(abs);
    const url = `assets/${basename(abs, ext).replace(/[^\w-]/g, "_")}-${hash}${ext}`;
    assets.set(url, abs);
    return url;
  };

  // the bibliography: talk.yaml's `bibliography`, else refs.bib if it exists
  const bibFile = talk.bibliography ?? (existsSync(join(dir, "refs.bib")) ? "refs.bib" : undefined);
  let bib: Bibliography | undefined;
  if (bibFile) {
    const path = join(dir, bibFile);
    inputs.push(path);
    if (!existsSync(path)) diagnostics.push({ severity: "error", file: "talk.yaml", message: `bibliography ${bibFile} not found` });
    else {
      const loadedBib = loadBibliography(readFileSync(path, "utf8"));
      if ("error" in loadedBib) diagnostics.push({ severity: "error", file: bibFile, message: loadedBib.error });
      else bib = loadedBib;
    }
  }

  const built = new Map<string, Awaited<ReturnType<(typeof buildPlugins)[string]["build"]>>>();
  // nodes that list what others produce (references) come last
  const order = [...loaded.nodes.values()].sort((a, b) => Number(!!buildPlugins[a.type]!.buildLast) - Number(!!buildPlugins[b.type]!.buildLast));
  for (const node of order) {
    if (node.file) inputs.push(node.file);
    const file = node.file ? relative(dir, node.file) : "talk.yaml";
    const ctx: BuildCtx = {
      talkDir: dir,
      macros,
      asset,
      report: (severity, message, line) => diagnostics.push({ severity, file, line, message }),
      reportIn: (f, severity, message, line, col) => diagnostics.push({ severity, file: f, line, col, message }),
      cite: (items) => (bib ? bib.cite(items) : { error: "citations need a bibliography: add refs.bib, or bibliography: in talk.yaml" }),
      references: () => bib?.references(bib.cited()),
      tikz: (body, extra?: TikzOptions) => {
        const base = talk.tikz ?? {};
        const opts: TikzOptions = {
          packages: [...(base.packages ?? []), ...(extra?.packages ?? [])],
          libraries: [...(base.libraries ?? []), ...(extra?.libraries ?? [])],
          preamble: [base.preamble, extra?.preamble].filter(Boolean).join("\n"),
          macros,
        };
        return renderTikz(body, opts, join(dir, ".wavesol", "cache", "tikz"));
      },
    };
    try {
      built.set(node.id, await buildPlugins[node.type]!.build({ id: node.id, data: node.data, body: node.body, file: node.file, bodyLine: node.bodyLine }, ctx));
    } catch (e) {
      diagnostics.push({ severity: "error", file, message: `${node.type} build failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  if (bib?.cited().length && ![...loaded.nodes.values()].some((n) => n.type === "references")) {
    diagnostics.push({ severity: "warning", file: "talk.yaml", message: 'the talk cites works but has no references node (add one: { type: references })' });
  }
  if (diagnostics.some((d) => d.severity === "error")) return { diagnostics, assets, inputs };

  const ids = [...loaded.nodes.keys()];
  // frames default to somewhat larger than a slide, growing with their children (4 children: 1.5x, 7+: 2x)
  const childCount = (id: string) => [...loaded.parents.values()].filter((p) => p === id).length;
  const sizeOf = (id: string): [number, number] => {
    const { entry, type } = loaded.nodes.get(id)!;
    if (entry.size) return entry.size as [number, number];
    if (type !== "frame") return NODE_SIZE;
    const k = Math.min(2, Math.max(1, 0.75 * Math.sqrt(childCount(id))));
    return [NODE_SIZE[0] * k, NODE_SIZE[1] * k];
  };
  const frames = new Map<string, FrameSpace>();
  const placements = await layout(
    ids.map((id) => {
      const { entry, type } = loaded.nodes.get(id)!;
      return { id, parent: loaded.parents.get(id), size: sizeOf(id), scale: entry.scale ?? 1, isFrame: type === "frame", layout: entry.layout, pin: entry.pin, near: entry.near };
    }),
    loaded.edges,
    talk.layout,
    frames,
  );

  const depth = (id: string): number => (loaded.parents.has(id) ? 1 + depth(loaded.parents.get(id)!) : 0);
  const nodes: CompiledNode[] = ids.map((id) => {
    const n = loaded.nodes.get(id)!;
    const b = built.get(id)!;
    const p = placements.get(id)!;
    const size = sizeOf(id);
    return {
      id,
      type: n.type,
      title: (n.data.title as string | undefined) ?? b.title ?? id,
      parent: loaded.parents.get(id),
      children: (n.entry.children ?? []).filter((c) => loaded.parents.get(c) === id),
      depth: depth(id),
      x: p.x,
      y: p.y,
      w: size[0] * p.scale,
      h: size[1] * p.scale,
      scale: p.scale,
      size,
      steps: b.steps,
      notes: b.notes,
      transition: n.entry.transition,
      data: b.data,
    };
  });

  const vars: Record<string, string> = {};
  if (talk.theme?.accent) vars["--ws-accent"] = talk.theme.accent;
  for (const [k, v] of Object.entries(talk.theme?.vars ?? {})) vars[`--ws-${k}`] = String(v);

  const compiled: CompiledTalk = {
    version: 1,
    meta: {
      title: talk.title,
      subtitle: talk.subtitle,
      authors: talk.authors,
      date: talk.date instanceof Date ? talk.date.toISOString().slice(0, 10) : talk.date,
      venue: talk.venue,
    },
    start: loaded.start,
    theme: { base: talk.theme?.base ?? "academic-light", vars },
    transitions: { default: talk.transitions?.default ?? "fly" },
    nodes,
    edges: loaded.edges,
    sync: { phone: talk.sync?.phone ?? true, relays: talk.sync?.relays, ice: talk.sync?.ice ?? [] },
    ...(talk.pdf ? { pdf: { file: (talk.pdf !== true && talk.pdf.file) || "talk.pdf", steps: (talk.pdf !== true && talk.pdf.steps) || "last" } } : {}),
  };
  const files = new Map([...loaded.nodes.values()].map((n) => [n.id, n.file ? relative(dir, n.file) : "talk.yaml"]));
  return { talk: compiled, diagnostics, assets, inputs, frames, files };
}
