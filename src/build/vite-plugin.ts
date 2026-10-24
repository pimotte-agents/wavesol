// Vite plugin: compiles the talk into the `virtual:wavesol/talk` module, serves/emits its assets, and
// recompiles + reloads the page when a file in the talk directory changes.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pinFor, writePin } from "./pins.ts";
import { lookup } from "mrmime";
import type { Plugin, ViteDevServer } from "vite";
import { compileTalk, type CompileResult } from "./compile.ts";
import { createRelay, lanOrigins } from "../cli/relay.ts";
import { formatDiagnostic } from "../model/compiled.ts";

const ID = "virtual:wavesol/talk";
const RESOLVED = "\0" + ID;

export function wavesol(talkDir: string, opts: { onDiagnostics?: (r: CompileResult) => void } = {}): Plugin {
  let result: CompileResult | undefined;
  // one compile per state of the talk: started eagerly by the dev server, shared with the page's request
  let current: Promise<CompileResult> | undefined;
  const compile = () =>
    (current ??= compileTalk(talkDir).then((r) => {
      result = r;
      opts.onDiagnostics?.(r);
      return r;
    }));

  return {
    name: "wavesol",
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) return;
      const r = await compile();
      return `export default ${JSON.stringify({ talk: r.talk, diagnostics: r.diagnostics })};`;
    },
    configureServer(server: ViteDevServer) {
      // local relay for phones, as in `wavesol serve`; other upgrades (Vite's HMR) are left alone
      const port = () => (server.httpServer?.address() as { port?: number } | null)?.port ?? 0;
      const relay = createRelay("/", () => ({ lan: server.config.server.host ? lanOrigins(port()) : [] }));
      server.httpServer?.on("upgrade", (req, socket, head) => relay.handleUpgrade(req, socket, head));
      server.httpServer?.on("close", () => relay.close());
      server.middlewares.use((req, res, next) => relay.handleRequest(req, res) || next());
      // drag mode: POST { node, at: [x, y] } (world position) → pin in talk.yaml; the watcher reloads
      server.middlewares.use((req, res, next) => {
        if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== "/__wavesol/pin") return next();
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          const fail = (status: number, message: string) => {
            res.statusCode = status;
            res.end(message);
          };
          try {
            const { node, at } = JSON.parse(body) as { node: string; at: [number, number] };
            if (!result?.talk || !result.frames) return fail(409, "the talk has errors");
            if (typeof node !== "string" || !Array.isArray(at) || !at.every(Number.isFinite)) return fail(400, "expected { node, at: [x, y] }");
            const pin = pinFor(result.talk, result.frames, node, at);
            const file = join(talkDir, "talk.yaml");
            const updated = pin && writePin(readFileSync(file, "utf8"), node, pin);
            if (!updated) return fail(404, `no node "${node}" in talk.yaml`);
            writeFileSync(file, updated);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ pin }));
          } catch (e) {
            fail(400, e instanceof Error ? e.message : String(e));
          }
        });
      });
      server.watcher.add(talkDir);
      // compile right away (incl. Lean builds, which log their progress), not on the first page load
      void compile();
      let timer: ReturnType<typeof setTimeout> | undefined;
      server.watcher.on("all", (_event, file) => {
        const rel = relative(talkDir, file);
        if (rel.startsWith("..") || rel.split(sep).some((part) => part === "dist" || part === "node_modules" || part.startsWith("."))) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          current = undefined;
          void compile();
          const mod = server.moduleGraph.getModuleById(RESOLVED);
          if (mod) server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: "full-reload" });
        }, 80);
      });
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? "").split("?")[0]!).replace(/^\//, "");
        const abs = result?.assets.get(path);
        if (!abs) return next();
        res.setHeader("Cache-Control", "no-cache");
        // browsers refuse to render an SVG image without its type
        res.setHeader("Content-Type", lookup(abs) ?? "application/octet-stream");
        res.end(readFileSync(abs));
      });
    },
    generateBundle() {
      if (!result) return;
      for (const [fileName, abs] of result.assets) this.emitFile({ type: "asset", fileName, source: readFileSync(abs) });
    },
  };
}

export function printDiagnostics(r: CompileResult, log: (s: string) => void = console.error) {
  for (const d of r.diagnostics) log(formatDiagnostic(d));
}
