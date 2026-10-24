// Vite plugin: compiles the talk into the `virtual:wavesol/talk` module, serves/emits its assets, and
// recompiles + reloads the page when a file in the talk directory changes.
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { lookup } from "mrmime";
import type { Plugin, ViteDevServer } from "vite";
import { compileTalk, type CompileResult } from "./compile.ts";
import { formatDiagnostic } from "../model/compiled.ts";

const ID = "virtual:wavesol/talk";
const RESOLVED = "\0" + ID;

export function wavesol(talkDir: string, opts: { onDiagnostics?: (r: CompileResult) => void } = {}): Plugin {
  let result: CompileResult | undefined;
  const compile = async () => {
    result = await compileTalk(talkDir);
    opts.onDiagnostics?.(result);
    return result;
  };

  return {
    name: "wavesol",
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) return;
      const r = await compile();
      return `export default ${JSON.stringify({ talk: r.talk, diagnostics: r.diagnostics })};`;
    },
    configureServer(server: ViteDevServer) {
      server.watcher.add(talkDir);
      let timer: ReturnType<typeof setTimeout> | undefined;
      server.watcher.on("all", (_event, file) => {
        const rel = relative(talkDir, file);
        if (rel.startsWith("..") || rel.split(sep).some((part) => part === "dist" || part === "node_modules" || part.startsWith("."))) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
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
