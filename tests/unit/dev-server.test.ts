// The `wavesol dev` server: talk assets are served with the right content type. Browsers refuse to
// render an SVG <img> without image/svg+xml, so SVG figures were broken in dev only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { wavesol } from "../../src/build/vite-plugin.ts";

// a talk with just an SVG figure: no Lean, so this test never waits for lake
const TALK = resolve(import.meta.dirname, "../fixtures/svg-talk");
let server: ViteDevServer;
let base: string;

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: resolve(import.meta.dirname, "../../src/runtime"),
    logLevel: "silent",
    plugins: [wavesol(TALK)],
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  const { port } = server.httpServer!.address() as { port: number };
  base = `http://127.0.0.1:${port}/`;
});
afterAll(() => server?.close());

describe("dev server assets", () => {
  it("serves an SVG figure as image/svg+xml", async () => {
    // loading the talk module compiles the talk and registers its assets
    const mod = await (await fetch(new URL("@id/__x00__virtual:wavesol/talk", base))).text();
    const svg = mod.match(/assets\/[\w-]+\.svg/)?.[0];
    expect(svg).toBeDefined();
    const res = await fetch(new URL(svg!, base));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\/svg\+xml/);
  });
});
