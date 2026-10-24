// Camera spike measurements. Sharpness: a node flown to with margin 0 must render like the same node
// drawn at native size without transforms. Performance: frame-time stats of a deep fly per mode/LOD.
// Results go to test-results/camera-spike.json. Headless numbers are pessimistic (software GPU).
import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";

const MODES = ["world-toggle", "world-always", "world-never", "per-node"] as const;
interface SpikeNode { id: string; kind: string; depth: number }
interface Spike {
  nodes: SpikeNode[];
  goTo(id: string, o?: { duration?: number }): Promise<void>;
  overview(o?: { duration?: number }): Promise<void>;
  stats(): { frames: number; p50: number; p95: number; max: number; over33: number };
}

async function open(page: Page, query: string) {
  await page.goto(`http://localhost:5179/?${query}`);
  await page.waitForFunction(() => (window as unknown as { spike?: { ready: boolean } }).spike?.ready);
  await page.addStyleTag({ content: "#hud { display: none !important }" });
  await page.evaluate(() => document.fonts.ready);
}

function diff(a: Buffer, b: Buffer) {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  let sum = 0;
  let bad = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    const d = Math.max(...[0, 1, 2].map((c) => Math.abs(pa.data[i + c]! - pb.data[i + c]!)));
    sum += d;
    if (d > 48) bad++;
  }
  const px = pa.data.length / 4;
  return { meanDiff: +(sum / px).toFixed(3), badPct: +((100 * bad) / px).toFixed(3) };
}

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/camera-spike.json", JSON.stringify(results, null, 2));
});

test("sharpness at rest vs native rendering", async ({ page }) => {
  await open(page, "margin=0");
  const nodes = await page.evaluate(() => (window as unknown as { spike: Spike }).spike.nodes);
  const targets = [0, 1, 2, 3].map((d) => nodes.find((n) => n.kind === "slide" && n.depth === d)!.id);
  const refs = new Map<string, Buffer>();
  for (const id of targets) {
    await open(page, `ref=${id}`);
    refs.set(id, await page.screenshot());
  }
  const sharp: Record<string, unknown> = {};
  for (const mode of MODES) {
    await open(page, `margin=0&mode=${mode}`);
    for (const id of targets) {
      await page.evaluate((id) => (window as unknown as { spike: Spike }).spike.goTo(id, { duration: 600 }), id);
      await page.waitForTimeout(300);
      const depth = nodes.find((n) => n.id === id)!.depth;
      sharp[`${mode}/depth${depth}`] = diff(await page.screenshot(), refs.get(id)!);
      if (depth === 3) await page.screenshot({ path: `test-results/camera-${mode}-depth3.png` });
    }
  }
  results.sharpness = sharp;
  console.table(sharp);
});

// Headless Chromium paces rAF at 60 Hz regardless of load, so frame times say little. Instead,
// measure main-thread time (style, layout, script, total task time) per frame via CDP. Raster and
// compositing happen off the main thread and are not included.
test("main-thread cost of a deep fly", async ({ page }) => {
  test.setTimeout(300_000);
  const perf: Record<string, unknown> = {};
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };
  for (const copies of [1, 4]) {
    for (const mode of MODES) {
      for (const lod of [1, 0]) {
        await open(page, `mode=${mode}&lod=${lod}&copies=${copies}`);
        await page.evaluate(async () => {
          const spike = (window as unknown as { spike: Spike }).spike;
          await spike.goTo(spike.nodes.filter((n) => n.depth === 0 && n.kind === "slide").at(-1)!.id, { duration: 300 });
        });
        const before = await metrics();
        const s = await page.evaluate(async () => {
          const spike = (window as unknown as { spike: Spike }).spike;
          await spike.goTo(spike.nodes.find((n) => n.kind === "slide" && n.depth === 3)!.id, { duration: 1500 });
          return spike.stats();
        });
        const after = await metrics();
        const perFrame = (k: string) => +(((after[k]! - before[k]!) * 1000) / s.frames).toFixed(2);
        perf[`${copies * 76}n/${mode}/lod${lod}`] = {
          taskMs: perFrame("TaskDuration"),
          styleMs: perFrame("RecalcStyleDuration"),
          layoutMs: perFrame("LayoutDuration"),
          scriptMs: perFrame("ScriptDuration"),
        };
        expect(s.frames).toBeGreaterThan(0);
      }
    }
  }
  results.perf = perf;
  console.table(perf);
});
