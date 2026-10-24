// Lean nodes: a declaration or ANCHOR region of a module in the talk's lean/ lake project, with
// highlighting, hovers and goal states from SubVerso. The build runs `lake build +Mod:highlighted`
// (SubVerso's facet, so the project requires SubVerso) and reads the JSON with ./subverso.ts.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import type { z } from "zod";
import { LeanFrontmatter } from "../../model/schema.ts";
import { renderMarkdown } from "../slide/build.ts";
import type { BuildPlugin } from "../types.ts";
import { tacticSteps } from "./steps.ts";
import { select, type CodeNode, type ModuleJson, type Tactic } from "./subverso.ts";

type Data = z.infer<typeof LeanFrontmatter>;

export interface LeanData {
  /** Markdown body above the code, as HTML. */
  caption?: string;
  code: CodeNode[];
  /** Hover texts: signature (plain) and docstring (HTML). */
  hovers: { sig?: string; doc?: string }[];
  tactics: Tactic[];
  /** The tactic each step shows (step k → steps[k - 1]); step 0 shows the start. */
  steps: number[];
  /** With `steps: [names]`: the PROOF_STATE name of each step. */
  stepNames?: string[];
  /** What steps walk through; only `tactics` lets the laser select a tactic (and move the step). */
  stepMode: "tactics" | "none" | "named";
  infoview: "right" | "below";
}

/** Lean's own errors, at their place in the project (paths relative to lean/). */
interface LeanError {
  file: string;
  line: number;
  col: number;
  message: string;
}
type Extracted = ModuleJson | { error: string; leanErrors?: LeanError[] };

/** Results per lean/ project and module, valid while the project's sources are unchanged. */
const cache = new Map<string, { key: string; modules: Map<string, Promise<Extracted>> }>();

/** Lake runs longer than this stream lake's own progress lines (a first build takes minutes). */
const STREAM_AFTER_MS = 3000;

/** Hash of everything lake's result depends on: Lean sources, lake config, toolchain. */
function projectKey(leanDir: string): string {
  const h = createHash("sha256");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".lake" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.lean$|^lakefile\.(lean|toml)$|^lake-manifest\.json$|^lean-toolchain$/.test(name)) h.update(path).update(readFileSync(path));
    }
  };
  walk(leanDir);
  return h.digest("hex");
}

function lakeCommand(): string {
  const elanLake = join(homedir(), ".elan", "bin", "lake");
  return existsSync(elanLake) ? elanLake : "lake";
}

/** Runs lake; after STREAM_AFTER_MS its output is echoed (prefixed), so long builds show progress. */
function run(cmd: string, args: string[], cwd: string): Promise<{ code: number | null; output: string; missing?: boolean }> {
  return new Promise((resolve) => {
    let output = "";
    let streaming = false;
    let partial = "";
    const echo = (text: string) => {
      const lines = (partial + text).split("\n");
      partial = lines.pop()!;
      for (const line of lines) if (line.trim()) console.error(`lean | ${line}`);
    };
    const timer = setTimeout(() => {
      streaming = true;
      echo(output);
    }, STREAM_AFTER_MS);
    const child = spawn(cmd, args, { cwd, env: process.env });
    const data = (d: Buffer) => {
      output += d;
      if (streaming) echo(String(d));
    };
    child.stdout.on("data", data);
    child.stderr.on("data", data);
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, output: e.message, missing: e.code === "ENOENT" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (streaming && partial.trim()) console.error(`lean | ${partial}`);
      resolve({ code, output });
    });
  });
}

function extract(leanDir: string, module: string, talkDir: string): Promise<Extracted> {
  const key = projectKey(leanDir);
  let entry = cache.get(leanDir);
  if (entry?.key !== key) cache.set(leanDir, (entry = { key, modules: new Map() }));
  let job = entry.modules.get(module);
  if (!job) {
    job = (async (): Promise<Extracted> => {
      const out = join(leanDir, ".lake", "build", "highlighted", ...module.split(".")) + ".json";
      const args = ["build", `+${module}:highlighted`];
      const first = existsSync(out) ? "" : " - a first build can take a few minutes";
      const where = relative(process.cwd(), leanDir);
      console.error(`lean: building ${module} (lake ${args.join(" ")} in ${where.startsWith("..") ? leanDir : where || "."})${first}`);
      const t0 = performance.now();
      const r = await run(lakeCommand(), args, leanDir);
      const took = `${((performance.now() - t0) / 1000).toFixed(1)} s`;
      if (r.missing) {
        console.error(`lean: ${module} failed: lake not found`);
        return { error: "Lean nodes need Lean: install elan (https://lean-lang.org/install), which provides lake" };
      }
      if (r.code !== 0) {
        console.error(`lean: ${module} failed after ${took}`);
        // Lean's own errors point into the project: kept, so every compile reports them there
        const leanErrors = [...r.output.matchAll(/^error: (?:\.\/)*(.+?\.lean):(\d+):(\d+): (.*)$/gm)].map((m) => ({
          file: m[1]!,
          line: Number(m[2]),
          col: Number(m[3]) + 1,
          message: m[4]!,
        }));
        const tail = r.output.trim().split("\n").slice(-8).join("\n");
        return { error: leanErrors.length ? `lake build of ${module} failed (errors above)` : `lake build of ${module} failed:\n${tail}`, leanErrors };
      }
      console.error(`lean: ${module} ready (${took})`);
      if (!existsSync(out)) return { error: `SubVerso wrote no ${relative(talkDir, out)}: does lean/lakefile require subverso?` };
      return JSON.parse(readFileSync(out, "utf8")) as ModuleJson;
    })();
    entry.modules.set(module, job);
  }
  return job;
}

export const lean: BuildPlugin<Data> = {
  type: "lean",
  schema: LeanFrontmatter,
  hasFile: true,
  async build(node, ctx) {
    const { source, anchor, decl } = node.data;
    const leanDir = join(ctx.talkDir, "lean");
    const empty = { data: { code: [], hovers: [], tactics: [], steps: [], stepMode: "none", infoview: "right" } satisfies LeanData, steps: 0 };
    if (!existsSync(join(leanDir, source))) {
      ctx.report("error", `Lean source lean/${source} not found`);
      return empty;
    }
    const mod = await extract(leanDir, source.replace(/\.lean$/, "").split("/").join("."), ctx.talkDir);
    if ("error" in mod) {
      for (const e of mod.leanErrors ?? []) ctx.reportIn(relative(ctx.talkDir, join(leanDir, e.file)), "error", e.message, e.line, e.col);
      ctx.report("error", mod.error);
      return empty;
    }
    const sel = select(mod, anchor !== undefined ? { anchor } : { decl: decl! });
    if ("error" in sel) {
      ctx.report("error", `${sel.error} in lean/${source}`);
      return empty;
    }

    let steps: number[] = [];
    let stepNames: string[] | undefined;
    if (Array.isArray(node.data.steps)) {
      stepNames = node.data.steps;
      for (const name of stepNames) {
        if (!(name in sel.states)) ctx.report("error", `no "-- ^ PROOF_STATE: ${name}" comment in the selected Lean code`);
      }
      steps = stepNames.map((name) => sel.states[name] ?? 0);
    } else if (node.data.steps !== "none") steps = tacticSteps(sel.tactics);

    const { html, notes, title, md } = await renderMarkdown({ ...node, notes: node.data.notes }, ctx);
    const data: LeanData = {
      ...(html ? { caption: html } : {}),
      code: sel.code,
      hovers: sel.hovers.map((h) => ({ ...(h.sig ? { sig: h.sig } : {}), ...(h.doc ? { doc: md.render(h.doc) } : {}) })),
      tactics: sel.tactics,
      steps,
      ...(stepNames ? { stepNames } : {}),
      stepMode: stepNames ? "named" : node.data.steps === "none" ? "none" : "tactics",
      infoview: node.data.infoview ?? "right",
    };
    return { data, steps: steps.length, notes, title: title ?? anchor ?? decl };
  },
};
