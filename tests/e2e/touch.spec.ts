// Touch screens: bars above and below the slide (portrait) or floating buttons (landscape), and swipes.
import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:4180/wavesol/";

interface State {
  nav: { node: string; step: number };
  overview: boolean;
}
const nav = (page: Page) => page.evaluate(() => (window as unknown as { wavesol: { state: State } }).wavesol.state.nav);
const talk = (page: Page) =>
  page.evaluate(() => (window as unknown as { wavesol: { talk: { start: string; edges: { from: string; to: string; default?: boolean; label?: string }[] } } }).wavesol.talk);

async function open(page: Page, hash = "") {
  await page.goto(BASE + hash);
  await page.waitForFunction(() => "wavesol" in window);
  await page.evaluate(() => document.fonts.ready);
}

/** A touch swipe on the stage, `dx` px sideways and `dy` down. */
const swipe = (page: Page, dx: number, dy = 0) =>
  page.evaluate(
    ({ dx, dy }) => {
      const stage = document.querySelector(".ws-stage")!;
      const x = innerWidth / 2 - dx / 2;
      const y = innerHeight / 2 - dy / 2;
      const ev = (type: string, f: number) =>
        stage.dispatchEvent(new PointerEvent(type, { pointerType: "touch", isPrimary: true, pointerId: 3, clientX: x + dx * f, clientY: y + dy * f, bubbles: true }));
      ev("pointerdown", 0);
      ev("pointermove", 0.5);
      ev("pointerup", 1);
    },
    { dx, dy },
  );

test("no touch bars with a mouse", async ({ page }) => {
  await open(page);
  await expect(page.locator(".ws-touch")).toHaveCount(0);
});

test.describe("phone, portrait", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("bars above and below, the slide fitted between them", async ({ page }) => {
    await open(page);
    const top = page.locator(".ws-touch-top");
    const bottom = page.locator(".ws-touch-bottom");
    await expect(top).toBeVisible();
    await expect(bottom).toBeVisible();
    const title = await page.evaluate(() => (window as unknown as { wavesol: { state: { node: { title: string } } } }).wavesol.state.node.title);
    await expect(page.locator(".ws-touch-node")).toHaveText(title);
    await expect
      .poll(async () => {
        const node = (await page.locator(".ws-node.ws-current").boundingBox())!;
        const t = (await top.boundingBox())!;
        const b = (await bottom.boundingBox())!;
        return node.y >= t.y + t.height - 1 && node.y + node.height <= b.y + 1;
      })
      .toBe(true);
  });

  test("◀ and ▶ step like the keys; detours open a sheet of the ways on", async ({ page }) => {
    await open(page);
    const { start, edges } = await talk(page);
    const prev = page.getByRole("button", { name: "Previous" });
    const next = page.getByRole("button", { name: "Next" });
    await expect(prev).toBeDisabled(); // the start, no history
    const def = edges.find((e) => e.from === start && e.default)!;
    await expect(page.locator(".ws-touch-next-hint")).toContainText("Next:");
    await next.click();
    expect((await nav(page)).node).toBe(def.to);
    await prev.click();
    expect((await nav(page)).node).toBe(start);

    const detour = edges.find((e) => e.from === start && !e.default)!;
    await page.getByRole("button", { name: /more ways/ }).click();
    const sheet = page.getByRole("dialog", { name: "From here" });
    await expect(sheet.getByRole("button")).toHaveCount(edges.filter((e) => e.from === start).length);
    await sheet.getByRole("button", { name: detour.label! }).click();
    await expect(sheet).toHaveCount(0);
    expect((await nav(page)).node).toBe(detour.to);
  });

  test("steps show as dots", async ({ page }) => {
    await open(page, "#/fragments/0");
    const dots = page.locator(".ws-touch-dots span");
    const total = await dots.count();
    expect(total).toBeGreaterThan(1);
    await expect(page.locator(".ws-touch-dots span.ws-on")).toHaveCount(1);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(".ws-touch-dots span.ws-on")).toHaveCount(2);
  });

  test("swiping left is next, right is previous; short or vertical swipes do nothing", async ({ page }) => {
    await open(page, "#/fragments/0");
    await swipe(page, -150);
    expect(await nav(page)).toMatchObject({ node: "fragments", step: 1 });
    await swipe(page, 150);
    expect(await nav(page)).toMatchObject({ node: "fragments", step: 0 });
    await swipe(page, -30);
    await swipe(page, -80, 200);
    expect(await nav(page)).toMatchObject({ node: "fragments", step: 0 });
  });

  test("the overview: the button is on, the bottom bar says to tap a slide", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Overview" }).click();
    await expect(page.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".ws-touch-hint")).toHaveText("Tap a slide to go there");
    await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
    // swipes don't navigate there (dragging pans)
    const before = await nav(page);
    await swipe(page, -150);
    expect(await nav(page)).toEqual(before);
  });

  test("the menu has the gestures help", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Gestures" }).click();
    await expect(page.getByRole("dialog", { name: "Gestures" })).toContainText("Swipe");
  });
});

test.describe("phone, landscape", () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test("buttons float in the corners and fade while unused", async ({ page }) => {
    await open(page);
    await expect(page.locator(".ws-touch-top")).toHaveCount(0);
    const next = page.locator(".ws-touch-br");
    await expect(next.getByRole("button", { name: "Next" })).toBeVisible();
    await expect.poll(() => next.evaluate((e) => Number(getComputedStyle(e).opacity)), { timeout: 6000 }).toBeLessThan(0.5);
    await next.getByRole("button", { name: "Next" }).click();
    await expect.poll(() => next.evaluate((e) => Number(getComputedStyle(e).opacity))).toBeGreaterThan(0.9);
  });
});
