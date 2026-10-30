// Clicking inside the current frame: a frame has an edge to everything inside it, so a click on a
// node in it flies there, also into a nested frame. Against tests/fixtures/frames-talk (see
// playwright.config.ts).
import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:4181/";

const node = (page: Page) => page.evaluate(() => (window as unknown as { wavesol: { state: { nav: { node: string } } } }).wavesol.state.nav.node);

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

async function open(page: Page, hash: string) {
  await page.goto(BASE + hash);
  await page.waitForFunction(() => "wavesol" in window);
  await settled(page);
}
const click = (page: Page, id: string) => page.locator(`.ws-node[data-id="${id}"]`).click();

test("at a frame, clicking a slide in it flies there", async ({ page }) => {
  await open(page, "#/outer/0");
  await click(page, "intro");
  expect(await node(page)).toBe("intro");
});

test("at a frame, clicking a slide in a nested frame flies there", async ({ page }) => {
  await open(page, "#/outer/0");
  await click(page, "deeper");
  expect(await node(page)).toBe("deeper");
});

test("at a frame, clicking a nested frame flies there", async ({ page }) => {
  await open(page, "#/outer/0");
  // its title bar: the slides inside cover the rest
  await page.locator('.ws-node[data-id="inner"] .ws-frame-title').click();
  expect(await node(page)).toBe("inner");
});

test("at a slide, clicking it doesn't navigate", async ({ page }) => {
  await open(page, "#/intro/0");
  await click(page, "intro");
  expect(await node(page)).toBe("intro");
});

/** The hovered node's cursor and outline. */
async function hoverStyle(page: Page, id: string) {
  await page.locator(`.ws-node[data-id="${id}"]`).hover();
  return page.evaluate((id) => {
    const s = getComputedStyle(document.querySelector(`.ws-node[data-id="${id}"]`)!);
    return { cursor: s.cursor, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` };
  }, id);
}

test("at a frame, a node inside it highlights on hover as in the overview", async ({ page }) => {
  await open(page, "#/start/0");
  await page.keyboard.press("o");
  await settled(page);
  const overview = await hoverStyle(page, "intro");
  expect(overview.cursor).toBe("pointer");
  expect(overview.outline).toMatch(/^solid /);

  await open(page, "#/outer/0");
  expect(await hoverStyle(page, "intro")).toEqual(overview);
  expect((await hoverStyle(page, "deeper")).outline).toBe(overview.outline);
});

test("at a slide, it doesn't highlight on hover", async ({ page }) => {
  await open(page, "#/intro/0");
  const style = await hoverStyle(page, "intro");
  expect(style.cursor).not.toBe("pointer");
  expect(style.outline).toMatch(/^none /);
});
