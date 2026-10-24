// Drag mode in `wavesol dev`: a real dev server on a temporary copy of tests/fixtures/drag-talk
// (dragging writes pins into its talk.yaml).
import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// one dev server per worker; its URL is taken from its own output (Vite moves on if a port is taken)
let URL = "";
const FIXTURE = resolve(import.meta.dirname, "../fixtures/drag-talk");
let dir: string;
let server: ChildProcess;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "wavesol-drag-"));
  cpSync(FIXTURE, dir, { recursive: true });
  const port = String(5191 + test.info().workerIndex);
  server = spawn("node", [resolve(import.meta.dirname, "../../bin/wavesol.js"), "dev", dir, "--port", port], { stdio: "pipe" });
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("dev server did not start")), 60_000);
    server.stdout!.on("data", (d) => {
      const m = /dev server for .* at (http:\/\/\S+)/.exec(String(d));
      if (m) {
        URL = m[1]!;
        clearTimeout(timer);
        ok();
      }
    });
  });
});
// every test starts from the fixture's talk.yaml (earlier drags wrote pins into the copy)
test.beforeEach(async () => {
  const original = readFileSync(join(FIXTURE, "talk.yaml"), "utf8");
  if (readFileSync(join(dir, "talk.yaml"), "utf8") !== original) {
    writeFileSync(join(dir, "talk.yaml"), original);
    // let the dev server see the change and recompile before the test opens its page: a reload
    // arriving after that would end drag mode mid-test
    await new Promise((r) => setTimeout(r, 2000));
  }
});
test.afterAll(() => {
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

const yaml = () => readFileSync(join(dir, "talk.yaml"), "utf8");
const nodeBox = (page: Page, id: string) => page.locator(`.ws-node[data-id="${id}"]`).boundingBox();
const world = (page: Page, id: string): Promise<[number, number]> =>
  page.evaluate((id): [number, number] => {
    const n = (window as unknown as { wavesol: { talk: { nodes: { id: string; x: number; y: number }[] } } }).wavesol.talk.nodes.find((m) => m.id === id)!;
    return [n.x, n.y];
  }, id);

async function open(page: Page) {
  await page.goto(URL);
  await page.waitForFunction(() => "wavesol" in window);
}

/** Opens the overview and waits for the camera to arrive there. */
async function overview(page: Page) {
  await page.keyboard.press("o");
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>(".ws-world")!.style.willChange)).not.toBe("transform");
  await page.waitForTimeout(100);
}

/** Marks the current page, so we can tell when the reload after a pin has replaced it. */
const markPage = (page: Page) => page.evaluate(() => ((window as unknown as { beforePin: boolean }).beforePin = true));
/** Waits for the reloaded page: a new page (no mark), loaded, back in drag mode. */
const reloaded = (page: Page) =>
  page.waitForFunction(() => !(window as unknown as { beforePin?: boolean }).beforePin && "wavesol" in window && !!document.querySelector(".ws-drag-banner"));

async function dragBy(page: Page, id: string, dx: number, dy: number) {
  const b = (await nodeBox(page, id))!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
}

test("d toggles drag mode; a short press pins nothing", async ({ page }) => {
  await open(page);
  await page.keyboard.press("d");
  await expect(page.getByRole("status")).toContainText("Drag mode");
  await overview(page);
  const before = yaml();
  const b = (await nodeBox(page, "b"))!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(500);
  expect(yaml()).toBe(before);
  expect(await page.evaluate(() => (window as unknown as { wavesol: { state: { nav: { node: string } } } }).wavesol.state.nav.node)).toBe("a");
  await page.keyboard.press("d");
  await expect(page.locator(".ws-drag-banner")).toHaveCount(0);
});

test("dragging a slide pins it where it was dropped; only its entry in talk.yaml changes", async ({ page }) => {
  await open(page);
  await overview(page);
  await page.keyboard.press("d");
  const [x0, y0] = await world(page, "b");
  const k = await page.evaluate(() => {
    const w = document.querySelector<HTMLElement>(".ws-world")!.style.transform;
    return Number(/scale\(([\d.e-]+)\)/.exec(w)![1]);
  });
  const before = yaml();
  await markPage(page);
  await dragBy(page, "b", 120, 80);
  await expect.poll(yaml).toMatch(/ {2}b: \{ pin: \[-?\d+, -?\d+\] \}/);
  expect(yaml().replace(/ {2}b: \{ pin: \[-?\d+, -?\d+\] \}/, "  b: {}")).toBe(before);
  // the page reloads with the new layout, still in drag mode
  await reloaded(page);
  await expect.poll(() => world(page, "b")).not.toEqual([x0, y0]);
  const [x1, y1] = await world(page, "b");
  expect(Math.abs(x1 - (x0 + 120 / k))).toBeLessThan(2 / k + 2);
  expect(Math.abs(y1 - (y0 + 80 / k))).toBeLessThan(2 / k + 2);
});

test("dragging a frame takes its children along", async ({ page }) => {
  await open(page);
  await overview(page);
  await page.keyboard.press("d");
  const [fx0] = await world(page, "f");
  const [xx0] = await world(page, "x");
  // grab the frame by its title band, above the children
  await markPage(page);
  const f = (await nodeBox(page, "f"))!;
  await page.mouse.move(f.x + 10, f.y + 6);
  await page.mouse.down();
  await page.mouse.move(f.x + 10 - 100, f.y + 6, { steps: 6 });
  await page.mouse.up();
  await expect.poll(yaml).toMatch(/\n {4}pin: \[-?\d+, -?\d+\]\n/);
  await reloaded(page);
  await expect.poll(async () => (await world(page, "f"))[0]).toBeLessThan(fx0);
  const [fx1] = await world(page, "f");
  const [xx1] = await world(page, "x");
  expect(xx1 - fx1).toBeCloseTo(xx0 - fx0, 0);
});
