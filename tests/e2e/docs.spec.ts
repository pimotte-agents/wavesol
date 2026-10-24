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

/** The world transform as [tx, ty, scale]. */
const camera = (page: Page) =>
  page.evaluate(() => {
    const m = document.querySelector<HTMLElement>(".ws-world")!.style.transform.match(/translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/)!;
    return [Number(m[1]), Number(m[2]), Number(m[3])] as const;
  });

test("overview: wheel zooms around the cursor, + and − zoom, zoom is limited", async ({ page }) => {
  await open(page);
  await page.keyboard.press("o");
  await settled(page);
  const [tx0, ty0, k0] = await camera(page);
  const [px, py] = [1000, 400];
  const world = (tx: number, ty: number, k: number) => [(px - tx) / k, (py - ty) / k];
  await page.mouse.move(px, py);
  await page.mouse.wheel(0, -300);
  const [tx1, ty1, k1] = await camera(page);
  expect(k1).toBeGreaterThan(k0);
  // the world point under the cursor stays put
  expect(world(tx1, ty1, k1)[0]).toBeCloseTo(world(tx0, ty0, k0)[0]!, 0);
  expect(world(tx1, ty1, k1)[1]).toBeCloseTo(world(tx0, ty0, k0)[1]!, 0);

  await page.keyboard.press("-");
  expect((await camera(page))[2]).toBeLessThan(k1);
  await page.keyboard.press("+");
  expect((await camera(page))[2]).toBeCloseTo(k1, 5);

  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 1000);
  expect((await camera(page))[2]).toBeCloseTo(k0 / 2, 5); // at most twice the fitted width
  expect((await state(page)).overview).toBe(true);
});

test("overview: dragging pans and does not navigate; a click still does", async ({ page }) => {
  await open(page);
  const start = (await state(page)).nav.node;
  await page.keyboard.press("o");
  await settled(page);
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.wheel(0, -300); // zoom in so the pan is not clamped
  const [tx0, ty0] = await camera(page);
  // a slide whose center is on screen, so the press lands on it
  const visible = await page.evaluate(([w, h]) => {
    for (const el of document.querySelectorAll<HTMLElement>(".ws-node.ws-type-slide")) {
      const r = el.getBoundingClientRect();
      const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
      if (cx > 150 && cx < w! - 150 && cy > 100 && cy < h! - 100 && document.elementFromPoint(cx, cy)?.closest(".ws-node") === el) return el.dataset.id;
    }
  }, [vp.width, vp.height]);
  expect(visible).toBeDefined();
  expect(visible).not.toBe(start);
  const target = page.locator(`.ws-node[data-id="${visible}"]`);
  const box = (await target.boundingBox())!;
  // press on a node, then drag: a pan, not a click on that node
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  const [tx1, ty1] = await camera(page);
  expect(tx1 - tx0).toBeCloseTo(-120, 0);
  expect(ty1 - ty0).toBeCloseTo(60, 0);
  expect((await state(page)).overview).toBe(true);
  expect((await state(page)).nav.node).toBe(start);

  await target.click();
  expect((await state(page)).overview).toBe(false);
  expect((await state(page)).nav.node).toBe(await target.getAttribute("data-id"));
});

test("TikZ figures render as inline SVG; citations show the full reference; references list them", async ({ page }) => {
  await open(page);
  const t = (await talk(page)) as unknown as { nodes: { id: string; type: string }[] };
  const tikzNode = t.nodes.find((n) => n.type === "tikz")!;
  await open(page, `#/${tikzNode.id}/0`);
  const svg = page.locator(`.ws-node[data-id="${tikzNode.id}"] svg.ws-tikz`);
  await expect(svg).toHaveCount(1);
  expect(await svg.locator("path").count()).toBeGreaterThan(5);
  // and has a real size on screen
  const box = (await svg.boundingBox())!;
  expect(box.width).toBeGreaterThan(50);
  expect(box.height).toBeGreaterThan(20);
  const inline = page.locator(".ws-tikz-figure svg").first();
  expect(await inline.evaluate((e) => e.getAttribute("width"))).toMatch(/^\d+\.\d+em$/);
  // drawn in the theme's ink, not hard-coded black
  expect(await svg.evaluate((e) => e.outerHTML.includes("rgb(0%,0%,0%)"))).toBe(false);

  const cite = page.locator(".ws-cite").first();
  await expect(cite).toHaveText(/^\(.+, \d{4}.*\)$/);
  expect(await cite.getAttribute("title")).toMatch(/\(\d{4}\)\./);
  const refs = t.nodes.find((n) => n.type === "references")!;
  await expect(page.locator(`.ws-node[data-id="${refs.id}"] .csl-entry`)).not.toHaveCount(0);
});

test("clicking a citation flies to the references, with the cited works highlighted; Back returns", async ({ page }) => {
  await open(page);
  const t = (await talk(page)) as unknown as { nodes: { id: string; type: string; steps: number }[] };
  const refs = t.nodes.find((n) => n.type === "references")!;
  // the slide with the citation of two works, at its last step (everything shown)
  const id = await page.evaluate(() => document.querySelector('.ws-cite[data-keys*=" "]')!.closest<HTMLElement>(".ws-node")!.dataset.id!);
  const slide = t.nodes.find((n) => n.id === id)!;
  await open(page, `#/${id}/${slide.steps}`);
  await settled(page);
  const cite = page.locator(`.ws-node[data-id="${id}"] .ws-cite[data-keys*=" "]`);
  const keys = (await cite.getAttribute("data-keys"))!.split(" ");
  await cite.click();
  expect((await state(page)).nav.node).toBe(refs.id);
  const entries = page.locator(`.ws-node[data-id="${refs.id}"] .csl-entry`);
  const marked = page.locator(`.ws-node[data-id="${refs.id}"] .csl-entry.ws-cited`);
  await expect(marked).toHaveCount(keys.length);
  for (const k of keys) await expect(entries.and(page.locator(`[data-csl-entry-id="${k}"]`))).toHaveClass(/ws-cited/);
  // Back: to the slide that cited them, and the marks go
  await page.keyboard.press("Backspace");
  expect((await state(page)).nav).toMatchObject({ node: id, step: slide.steps });
  await expect(marked).toHaveCount(0);
});

test("morph: tagged parts glide to their new place between steps, and back", async ({ page }) => {
  await open(page, "#/morph/0");
  await settled(page);
  const block = page.locator('.ws-node[data-id="morph"] .ws-morph');
  const shownStep = () => block.locator(".ws-morph-step.ws-morph-shown").getAttribute("data-step");
  const part = (step: number) => block.locator(`.ws-morph-step[data-step="${step}"] [data-morph="b"]`);
  expect(await shownStep()).toBe("0");
  const from = (await part(0).boundingBox())!;

  await page.keyboard.press("Space");
  // mid-move: a copy of the part is on its way, between its old and new place
  const copy = block.locator(".ws-morph-copy", { hasText: "3" });
  await expect(copy).toHaveCount(1);
  await page.waitForTimeout(250);
  const mid = (await copy.boundingBox())!;
  await expect(block.locator(".ws-morph-copy")).toHaveCount(0, { timeout: 2000 });
  expect(await shownStep()).toBe("1");
  const to = (await part(1).boundingBox())!;
  expect(to.x).toBeGreaterThan(from.x + 50); // the 3 moved right, across the =
  expect(mid.x).toBeGreaterThan(from.x + 5);
  expect(mid.x).toBeLessThan(to.x - 5);

  // glyphs keep their proportions while moving: every copy scales the same in x and y
  await page.keyboard.press("Space"); // 2x = 7 − 3 → 2x = 4: the 7 becomes a 4
  await page.waitForTimeout(150);
  const scales = await block.locator(".ws-morph-copy").evaluateAll((els) =>
    els.map((e) => {
      const m = new DOMMatrix(getComputedStyle(e).transform);
      return [m.a, m.d];
    }),
  );
  expect(scales.length).toBeGreaterThan(0);
  for (const [sx, sy] of scales) expect(sx).toBeCloseTo(sy!, 3);
  // a part whose content changes crossfades: the old 7 travels along, fading out
  const oldSeven = block.locator(".ws-morph-copy .ws-morph-old", { hasText: "7" });
  await expect(oldSeven).toHaveCount(1);
  // and is actually visible at the start of the move
  expect(await oldSeven.locator("[data-morph]").evaluate((e) => getComputedStyle(e).visibility)).toBe("visible");
  await expect(block.locator(".ws-morph-copy")).toHaveCount(0, { timeout: 2000 });
  await page.keyboard.press("ArrowLeft");
  await expect(block.locator(".ws-morph-copy")).toHaveCount(0, { timeout: 2000 });

  // back: the same move in reverse
  await page.keyboard.press("ArrowLeft");
  await expect(block.locator(".ws-morph-copy")).not.toHaveCount(0);
  await expect(block.locator(".ws-morph-copy")).toHaveCount(0, { timeout: 2000 });
  expect(await shownStep()).toBe("0");
  // and every equation can be shown again, fully opaque (no fade left behind)
  for (let i = 0; i < 3; i++) await page.keyboard.press("Space");
  await expect(block.locator(".ws-morph-copy")).toHaveCount(0, { timeout: 3000 });
  expect(await shownStep()).toBe("3");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await expect(block.locator(".ws-morph-copy")).toHaveCount(0, { timeout: 3000 });
  expect(await block.locator(".ws-morph-step.ws-morph-shown").evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
});

test("the dark theme recolours the page, code highlighting and TikZ figures", async ({ page }) => {
  await open(page);
  const t = (await talk(page)) as unknown as { nodes: { id: string; type: string }[] };
  await open(page, `#/${t.nodes.find((n) => n.type === "tikz")!.id}/0`);
  const look = () =>
    page.evaluate(() => {
      const code = document.querySelector(".shiki span[style]")!;
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        code: getComputedStyle(code).color,
        tikz: getComputedStyle(document.querySelector("svg.ws-tikz")!).color,
      };
    });
  const light = await look();
  await page.evaluate(() => (document.documentElement.dataset.theme = "academic-dark"));
  const dark = await look();
  expect(dark.bg).not.toBe(light.bg);
  expect(dark.code).not.toBe(light.code); // Shiki's dark colours, from --shiki-dark
  expect(dark.tikz).not.toBe(light.tikz); // TikZ is drawn in the theme's ink
  // dark background, light ink
  const lum = (c: string) => c.match(/\d+/g)!.slice(0, 3).reduce((s, v) => s + Number(v), 0);
  expect(lum(dark.bg)).toBeLessThan(lum(dark.tikz));
});

test("the help panel links to the talk's PDF, which the build wrote", async ({ page }) => {
  await open(page);
  await page.keyboard.press("?");
  const link = page.getByRole("link", { name: "Download the talk as PDF" });
  await expect(link).toHaveAttribute("href", "talk.pdf");
  const res = await page.request.get(new URL("talk.pdf", BASE).href);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
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
    ["frame", "#/content/0", []],
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
