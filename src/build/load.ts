// Loads a talk directory: parses talk.yaml and node files, validates them against the schemas and
// checks the graph. Everything that `wavesol check` reports without running plugin builds.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { z } from "zod";
import { NodeEntry, Talk, expandEdgeItem, type Edge } from "../model/schema.ts";

type Entry = z.infer<typeof NodeEntry>;
import type { Diagnostic } from "../model/compiled.ts";
import { at, describeIssue, parseYaml, zodDiagnostics, type YamlSource } from "./yaml.ts";
import { buildPlugins } from "../plugins/build-registry.ts";

export interface LoadedNode {
  id: string;
  type: string;
  entry: Entry;
  /** Plugin data: frontmatter merged with plugin fields from talk.yaml, validated by the plugin. */
  data: Record<string, unknown>;
  body: string;
  file?: string;
  bodyLine: number;
}

export interface LoadedTalk {
  dir: string;
  talk: Talk;
  nodes: Map<string, LoadedNode>;
  edges: Edge[];
  start: string;
  /** Child id → parent frame id. */
  parents: Map<string, string>;
  talkSrc: YamlSource;
}

const GRAPH_FIELDS = new Set(Object.keys(NodeEntry.shape));
const SHARED_FIELDS = ["type", "title"]; // allowed in both places, but not both at once

export function splitFrontmatter(text: string): { fm: string; body: string; fmLine: number; bodyLine: number } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: "", body: text, fmLine: 1, bodyLine: 1 };
  const fmLines = m[0].split("\n").length - 1;
  return { fm: m[1]!, body: text.slice(m[0].length), fmLine: 2, bodyLine: fmLines + 1 };
}

export function loadTalk(dir: string): { talk?: LoadedTalk; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const talkPath = join(dir, "talk.yaml");
  if (!existsSync(talkPath)) return { diagnostics: [{ severity: "error", file: "talk.yaml", message: "talk.yaml not found" }] };

  const parsed = parseYaml("talk.yaml", readFileSync(talkPath, "utf8"));
  if (parsed.diagnostics.length) return { diagnostics: parsed.diagnostics };
  const src = parsed.src;
  const result = Talk.safeParse(parsed.value);
  if (!result.success) return { diagnostics: zodDiagnostics(src, result.error) };
  const talk = result.data;

  const nodes = new Map<string, LoadedNode>();
  for (const [id, rawEntry] of Object.entries(talk.nodes)) {
    const entry: Entry = rawEntry ?? {};
    const node = loadNode(dir, src, id, entry, diagnostics);
    if (node) nodes.set(id, node);
  }

  // Frames
  const parents = new Map<string, string>();
  for (const [id, rawEntry] of Object.entries(talk.nodes)) {
    const entry = rawEntry ?? {};
    const isFrame = nodes.get(id)?.type === "frame";
    if (entry.children && !isFrame) diagnostics.push(at(src, ["nodes", id, "children"], `only frames have children (${id} is a ${nodes.get(id)?.type})`));
    if (!isFrame) {
      if (entry.layout) diagnostics.push(at(src, ["nodes", id, "layout"], "only frames have a layout"));
      continue;
    }
    (entry.children ?? []).forEach((child, i) => {
      if (!(child in talk.nodes)) diagnostics.push(at(src, ["nodes", id, "children", i], `unknown node "${child}"`));
      else if (parents.has(child)) diagnostics.push(at(src, ["nodes", id, "children", i], `"${child}" is already a child of frame "${parents.get(child)}"`));
      else parents.set(child, id);
    });
  }
  for (const id of parents.keys()) {
    const seen = new Set<string>([id]);
    for (let p = parents.get(id); p; p = parents.get(p)) {
      if (seen.has(p)) {
        diagnostics.push(at(src, ["nodes", p, "children"], `frame cycle involving "${p}"`));
        parents.delete(id);
        break;
      }
      seen.add(p);
    }
  }

  // Edges
  const edges: Edge[] = [];
  const defaults = new Map<string, number>();
  talk.edges.forEach((item, i) => {
    for (const edge of expandEdgeItem(item)) {
      const bad = [edge.from, edge.to].filter((n) => !(n in talk.nodes));
      if (bad.length) {
        diagnostics.push(at(src, ["edges", i], `edge ${edge.from} -> ${edge.to}: unknown node "${bad[0]}"`));
        continue;
      }
      if (edge.default) {
        if (defaults.has(edge.from)) diagnostics.push(at(src, ["edges", i], `"${edge.from}" already has a default edge (edges item ${defaults.get(edge.from)! + 1})`));
        else defaults.set(edge.from, i);
      }
      edges.push(edge);
    }
  });

  const start = talk.start ?? Object.keys(talk.nodes)[0]!;
  if (!(start in talk.nodes)) diagnostics.push(at(src, ["start"], `unknown node "${start}"`));

  // Warnings: unused node files, unreachable nodes
  const used = new Set(
    Object.entries(talk.nodes).map(([id, e]) => join(dir, e?.file ?? `nodes/${id}.md`)),
  );
  for (const f of listFiles(join(dir, "nodes"))) {
    if (extname(f) === ".md" && !used.has(f)) diagnostics.push({ severity: "warning", file: relative(dir, f), message: "not used by any node" });
  }
  const reachable = new Set([start]);
  if (!(start in talk.nodes)) for (const id of nodes.keys()) reachable.add(id); // already reported
  // a frame has an edge to each node inside it (see NavGraph)
  const childEdges = [...parents].map(([child, frame]) => ({ from: frame, to: child }));
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of [...edges, ...childEdges]) {
      if (reachable.has(e.from) && !reachable.has(e.to)) {
        reachable.add(e.to);
        grew = true;
      }
    }
  }
  for (const id of nodes.keys()) {
    if (!reachable.has(id)) diagnostics.push(at(src, ["nodes", id], `"${id}" cannot be reached from "${start}" along edges (only via the overview)`, "warning"));
  }

  return { talk: { dir, talk, nodes, edges, start, parents, talkSrc: src }, diagnostics };
}

function loadNode(dir: string, src: YamlSource, id: string, entry: Entry, diagnostics: Diagnostic[]): LoadedNode | undefined {
  const pluginFields = Object.fromEntries(Object.entries(entry).filter(([k]) => !GRAPH_FIELDS.has(k)));
  const file = entry.file ?? (entry.type === "frame" ? undefined : `nodes/${id}.md`);

  let fm: Record<string, unknown> = {};
  let fmSrc: YamlSource | undefined;
  let body = "";
  let bodyLine = 1;
  if (file) {
    const abs = join(dir, file);
    if (!existsSync(abs)) {
      diagnostics.push(at(src, ["nodes", id], `node file ${file} not found`));
      return;
    }
    const split = splitFrontmatter(readFileSync(abs, "utf8"));
    body = split.body;
    bodyLine = split.bodyLine;
    if (split.fm) {
      const parsed = parseYaml(file, split.fm, split.fmLine - 1);
      diagnostics.push(...parsed.diagnostics);
      if (parsed.diagnostics.length) return;
      fmSrc = parsed.src;
      if (parsed.value !== null && typeof parsed.value !== "object") {
        diagnostics.push({ severity: "error", file, line: split.fmLine, message: "frontmatter must be a YAML mapping" });
        return;
      }
      fm = (parsed.value ?? {}) as Record<string, unknown>;
    }
  }

  const type = entry.type ?? (fm.type as string | undefined) ?? (file && extname(file) === ".md" ? "slide" : undefined);
  const plugin = type ? buildPlugins[type] : undefined;
  if (!plugin) {
    diagnostics.push(at(src, ["nodes", id], type ? `unknown node type "${type}"` : `cannot infer the type of "${id}"; set type`));
    return;
  }
  if (file && !plugin.hasFile) {
    diagnostics.push(at(src, ["nodes", id, "file"], `${type} nodes have no file`));
    return;
  }

  let conflict = false;
  for (const k of [...Object.keys(pluginFields), ...SHARED_FIELDS.filter((k) => k in entry)]) {
    if (k in fm && fmSrc) {
      diagnostics.push(at(fmSrc, [k], `"${k}" is also set for "${id}" in talk.yaml; set it in one place`));
      conflict = true;
    }
  }
  if (conflict) return;

  const merged = { ...pluginFields, ...fm, ...(entry.title !== undefined && { title: entry.title }), type };
  const parsed = plugin.schema.safeParse(merged);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const { path, message } = describeIssue(issue);
      const key = path[0];
      // point at talk.yaml only for fields set there; everything else belongs to the node file
      if (key !== undefined && String(key) in pluginFields) diagnostics.push(at(src, ["nodes", id, ...path], message));
      else if (fmSrc) diagnostics.push(at(fmSrc, path, message));
      else diagnostics.push(file ? { severity: "error", file, line: 1, message } : at(src, ["nodes", id], message));
    }
    return;
  }
  return { id, type: plugin.type, entry, data: parsed.data as Record<string, unknown>, body, file: file ? join(dir, file) : undefined, bodyLine };
}

function listFiles(d: string): string[] {
  if (!existsSync(d)) return [];
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}
