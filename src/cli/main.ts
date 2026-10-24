// wavesol CLI: new, dev, build, serve, check.
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer as createHttpServer } from "node:http";
import { networkInterfaces } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import react from "@vitejs/plugin-react";
import sirv from "sirv";
import { build, createServer, type InlineConfig } from "vite";
import { compileTalk } from "../build/compile.ts";
import { attachRelay, createRelay, lanOrigins } from "./relay.ts";
import { checkRender, writePdf } from "./render.ts";
import { printDiagnostics, wavesol } from "../build/vite-plugin.ts";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(PKG, "src/runtime");

const USAGE = `wavesol <command> [dir] [options]

Commands:
  new <dir>      create a talk from the template
  dev [dir]      live preview with reload (default port 5173)
  build [dir]    build a static site into <dir>/dist (or --out)
  serve [dir]    build, then serve the static site (default port 4173)
  check [dir]    validate the talk; exit code 1 on errors

Options:
  --port <n>     port for dev/serve
  --host         listen on all interfaces (dev/serve)
  --out <dir>    output directory for build/serve
  --pdf          build: also write talk.pdf (as pdf: in talk.yaml; needs Playwright)
  --render       check: render every node at every step and report what overflows or fails to load
  --shots <dir>  check: also save a screenshot of every node and step (implies --render)`;

function viteConfig(talkDir: string, extra: InlineConfig = {}): InlineConfig {
  return {
    configFile: false,
    root: RUNTIME,
    base: "./",
    logLevel: "warn",
    plugins: [react(), wavesol(talkDir, { onDiagnostics: (r) => printDiagnostics(r) })],
    server: { fs: { allow: [PKG, talkDir] } },
    ...extra,
  };
}

async function check(talkDir: string, render: boolean, shots?: string): Promise<boolean> {
  const r = await compileTalk(talkDir);
  if (render && r.talk && !r.diagnostics.some((d) => d.severity === "error")) {
    // build to a temporary folder and look at every node at every step in a browser
    const out = mkdtempSync(join(tmpdir(), "wavesol-check-"));
    try {
      await build(viteConfig(talkDir, { build: { outDir: out, emptyOutDir: true }, plugins: [react(), wavesol(talkDir)] }));
      r.diagnostics.push(...(await checkRender(out, r.files!, shots && resolve(shots))));
      if (shots) console.error(`screenshots in ${shots}`);
    } catch (e) {
      r.diagnostics.push({ severity: "error", file: "talk.yaml", message: (e as Error).message });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
  printDiagnostics(r);
  const errors = r.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = r.diagnostics.length - errors;
  console.error(errors || warnings ? `${errors} error(s), ${warnings} warning(s)` : `${basename(talkDir)}: no problems`);
  return errors === 0;
}

async function buildTalk(talkDir: string, out: string, forcePdf = false): Promise<boolean> {
  const r = await compileTalk(talkDir);
  if (r.diagnostics.some((d) => d.severity === "error")) {
    printDiagnostics(r);
    console.error("build aborted: fix the errors above");
    return false;
  }
  await build(viteConfig(talkDir, { build: { outDir: out, emptyOutDir: true }, plugins: [react(), wavesol(talkDir)] }));
  printDiagnostics(r);
  console.error(`built ${out}`);
  const pdf = r.talk!.pdf ?? (forcePdf ? { file: "talk.pdf", steps: "last" as const } : undefined);
  if (pdf) {
    try {
      const pages = await writePdf(out, pdf.file, pdf.steps);
      console.error(`wrote ${join(out, pdf.file)} (${pages} pages)`);
    } catch (e) {
      console.error(`PDF: ${(e as Error).message}`);
      return false;
    }
  }
  return true;
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

export async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "boolean" },
      out: { type: "string" },
      render: { type: "boolean" },
      shots: { type: "string" },
      pdf: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, dirArg] = positionals;
  if (!command || values.help) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }
  const talkDir = resolve(dirArg ?? ".");
  const port = values.port ? Number(values.port) : undefined;

  switch (command) {
    case "new": {
      if (!dirArg) return (console.error("usage: wavesol new <dir>"), 1);
      if (existsSync(talkDir)) return (console.error(`${dirArg} already exists`), 1);
      cpSync(join(PKG, "templates/talk"), talkDir, { recursive: true });
      renameSync(join(talkDir, "gitignore"), join(talkDir, ".gitignore")); // npm strips .gitignore from packages
      const talkYaml = join(talkDir, "talk.yaml");
      writeFileSync(talkYaml, readFileSync(talkYaml, "utf8").replace(/^title: .*$/m, `title: ${basename(talkDir)}`));
      console.log(`created ${dirArg}\n  cd ${dirArg} && npm install && npx wavesol dev`);
      return 0;
    }
    case "check":
      return (await check(talkDir, !!values.render || !!values.shots, values.shots)) ? 0 : 1;
    case "build":
      return (await buildTalk(talkDir, resolve(values.out ?? join(talkDir, "dist")), !!values.pdf)) ? 0 : 1;
    case "dev": {
      const server = await createServer(viteConfig(talkDir, { server: { port, host: values.host, fs: { allow: [PKG, talkDir] } } }));
      await server.listen();
      // printUrls() logs at info level, which logLevel "warn" suppresses
      const urls = server.resolvedUrls!;
      console.log(`dev server for ${talkDir} at ${urls.local[0]}`);
      for (const u of urls.network) console.log(`  on the network: ${u}`);
      return new Promise(() => {}); // run until interrupted
    }
    case "serve": {
      const out = resolve(values.out ?? join(talkDir, "dist"));
      if (!(await buildTalk(talkDir, out))) return 1;
      const listenPort = port ?? 4173;
      const host = values.host ? "0.0.0.0" : "127.0.0.1";
      // the local relay lets a phone on the same network control the talk without internet
      const relay = createRelay("/", () => ({ lan: values.host ? lanOrigins(listenPort) : [] }));
      const files = sirv(out, { dev: true });
      const server = createHttpServer((req, res) => relay.handleRequest(req, res) || files(req, res));
      attachRelay(server, relay);
      server.listen(listenPort, host);
      console.log(`serving ${out} at http://localhost:${listenPort}/`);
      if (values.host) for (const a of lanAddresses()) console.log(`  on the network: http://${a}:${listenPort}/`);
      else console.log("  phone control needs the network: add --host");
      return new Promise(() => {});
    }
    default:
      console.error(`unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}
