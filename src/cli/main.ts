// wavesol CLI: new, dev, build, serve, check.
import { cpSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { networkInterfaces } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import react from "@vitejs/plugin-react";
import sirv from "sirv";
import { build, createServer, type InlineConfig } from "vite";
import { compileTalk } from "../build/compile.ts";
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
  --out <dir>    output directory for build/serve`;

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

async function check(talkDir: string): Promise<boolean> {
  const r = await compileTalk(talkDir);
  printDiagnostics(r);
  const errors = r.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = r.diagnostics.length - errors;
  console.error(errors || warnings ? `${errors} error(s), ${warnings} warning(s)` : `${basename(talkDir)}: no problems`);
  return errors === 0;
}

async function buildTalk(talkDir: string, out: string): Promise<boolean> {
  const r = await compileTalk(talkDir);
  if (r.diagnostics.some((d) => d.severity === "error")) {
    printDiagnostics(r);
    console.error("build aborted: fix the errors above");
    return false;
  }
  await build(viteConfig(talkDir, { build: { outDir: out, emptyOutDir: true }, plugins: [react(), wavesol(talkDir)] }));
  printDiagnostics(r);
  console.error(`built ${out}`);
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
    options: { port: { type: "string" }, host: { type: "boolean" }, out: { type: "string" }, help: { type: "boolean", short: "h" } },
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
      return (await check(talkDir)) ? 0 : 1;
    case "build":
      return (await buildTalk(talkDir, resolve(values.out ?? join(talkDir, "dist")))) ? 0 : 1;
    case "dev": {
      const server = await createServer(viteConfig(talkDir, { server: { port, host: values.host, fs: { allow: [PKG, talkDir] } } }));
      await server.listen();
      server.printUrls();
      return new Promise(() => {}); // run until interrupted
    }
    case "serve": {
      const out = resolve(values.out ?? join(talkDir, "dist"));
      if (!(await buildTalk(talkDir, out))) return 1;
      const listenPort = port ?? 4173;
      const host = values.host ? "0.0.0.0" : "127.0.0.1";
      createHttpServer(sirv(out, { dev: true })).listen(listenPort, host);
      console.log(`serving ${out} at http://localhost:${listenPort}/`);
      if (values.host) for (const a of lanAddresses()) console.log(`  on the network: http://${a}:${listenPort}/`);
      return new Promise(() => {});
    }
    default:
      console.error(`unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}
