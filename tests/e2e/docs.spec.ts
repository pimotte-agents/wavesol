// End-to-end tests against the built docs talk, served from a subpath (see playwright.config.ts).
// Assertions use the talk's own data (window.wavesol), so content edits don't break them.
import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:4180/wavesol/";

interface State {
  nav: { node: string; step: number; history: unknown[] };
  overview: boolean;
  outgoing: { edge: { to: string; default?: boolean } }[];
}
interface TalkData {
  start: string;
  nodes: { id: string; steps: number; type: string }[];
  edges: { from: string; to: string; default?: boolean }[];
}

const state = (page: Page) => page.evaluate(() => (window as unknown as { wavesol: { state: State } }).wavesol.state);
const talk = (page: Page) => page.evaluate(() => (window as unknown as { wavesol: { talk: TalkData } }).wavesol.talk);

/** Waits until the camera has stopped moving (same transform 250 ms apart, no animation running). */
async function settled(page: Page) {
  const snapshot = () =>
    page.evaluate(() => {
      const w = document.querySelector<HTMLElement>(".ws-world")!;
      return `${w.style.transform}|${w.style.opacity}|${w.style.willChange}`;
    });
  for (let i = 0; i < 40; i++) {
    const a = await snapshot();
    await page.waitForTimeout(250);
    if (a === (await snapshot()) && !a.endsWith("|transform")) return;
  }
  throw new Error("camera did not settle");
}

const problems: string[] = [];
test.beforeEach(async ({ page }) => {
  problems.length = 0;
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`));
});
test.afterEach(() => expect(problems).toEqual([]));

async function open(page: Page, hash = "") {
  await page.goto(BASE + hash);
  await page.waitForFunction(() => "wavesol" in window);
  await page.evaluate(() => document.fonts.ready);
}

test("loads from a subpath at the start node", async ({ page }) => {
  await open(page);
  const t = await talk(page);
  expect((await state(page)).nav).toMatchObject({ node: t.start, step: 0 });
  expect(page.url()).toContain(`#/${t.start}/0`);
});

test("Space walks every step along the default edges to the end", async ({ page }) => {
  await open(page);
  const t = await talk(page);
  const steps = new Map(t.nodes.map((n) => [n.id, n.steps]));
  // expected: follow default edges from the start, visiting every step of each node
  const expected: string[] = [];
  for (let id: string | undefined = t.start, seen = new Set<string>(); id && !seen.has(id); id = t.edges.find((e) => e.from === id && e.default)?.to) {
    seen.add(id);
    for (let s = 0; s <= steps.get(id)!; s++) expected.push(`${id}/${s}`);
  }
  const visited = [`${t.start}/0`];
  for (let i = 0; i < expected.length + 2; i++) {
    await page.keyboard.press("Space");
    const { nav } = await state(page);
    const pos = `${nav.node}/${nav.step}`;
    if (pos === visited.at(-1)) break;
    visited.push(pos);
  }
  expect(visited).toEqual(expected);
});

test("number keys take edges, Backspace goes back, ← steps back", async ({ page }) => {
  await open(page);
  const t = await talk(page);
  const branching = t.nodes.find((n) => t.edges.filter((e) => e.from === n.id).length >= 2)!;
  await open(page, `#/${branching.id}/0`);
  const { outgoing } = await state(page);
  await page.keyboard.press("2");
  expect((await state(page)).nav.node).toBe(outgoing[1]!.edge.to);
  await page.keyboard.press("Backspace");
  expect((await state(page)).nav).toMatchObject({ node: branching.id, step: 0 });

  const withSteps = t.nodes.find((n) => n.steps >= 2)!;
  await open(page, `#/${withSteps.id}/2`);
  await page.keyboard.press("ArrowLeft");
  expect((await state(page)).nav).toMatchObject({ node: withSteps.id, step: 1 });
});

test("fragments appear one step at a time", async ({ page }) => {
  await open(page);
  const t = await talk(page);
  const n = t.nodes.find((x) => x.type === "slide" && x.steps >= 2)!;
  await open(page, `#/${n.id}/0`);
  const visible = () => page.locator(`.ws-node[data-id="${n.id}"] .fragment.visible`).count();
  expect(await visible()).toBe(0);
  await page.keyboard.press("Space");
  const one = await visible();
  expect(one).toBeGreaterThan(0);
  await page.keyboard.press("Space");
  expect(await visible()).toBeGreaterThan(one);
});

test("overview: o zooms out, clicking a node flies there", async ({ page }) => {
  await open(page);
  const t = await talk(page);
  await page.keyboard.press("o");
  expect((await state(page)).overview).toBe(true);
  await settled(page);
  await expect(page.locator(".ws-stage")).toHaveClass(/ws-overview/);
  const target = t.nodes.filter((n) => n.type === "slide").at(-1)!;
  await page.locator(`.ws-node[data-id="${target.id}"]`).click();
  expect((await state(page)).nav.node).toBe(target.id);
  expect((await state(page)).overview).toBe(false);
});

test("the edges panel lists outgoing edges and navigates", async ({ page }) => {
  await open(page);
  await page.keyboard.press("e");
  const buttons = page.locator(".ws-edges-panel button");
  const { outgoing } = await state(page);
  await expect(buttons).toHaveCount(outgoing.length);
  await buttons.first().click();
  expect((await state(page)).nav.node).toBe(outgoing[0]!.edge.to);
});

test.describe("visual", () => {
  for (const [name, hash, keys] of [
    ["start", "", []],
    ["fragments", "#/fragments/0", ["Space", "Space"]],
    ["frame", "#/node-types/0", []],
    ["overview", "", ["o"]],
  ] as const) {
    test(name, async ({ page }) => {
      await open(page, hash);
      for (const k of keys) await page.keyboard.press(k);
      await settled(page);
      await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.01 });
    });
  }
});
