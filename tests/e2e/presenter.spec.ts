// End-to-end tests for the presenter view: a second window synced with the projector over
// BroadcastChannel, against the built docs talk served from a subpath.
import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const BASE = "http://localhost:4180/wavesol/";

interface Nav {
  node: string;
  step: number;
}
interface TalkData {
  start: string;
  nodes: { id: string; type: string; title: string; steps: number; notes?: string }[];
  edges: { from: string; to: string; default?: boolean }[];
}

const nav = (projector: Page) =>
  projector.evaluate(() => {
    const { node, step } = (window as unknown as { wavesol: { state: { nav: Nav } } }).wavesol.state.nav;
    return { node, step };
  });
const talk = (projector: Page) => projector.evaluate(() => (window as unknown as { wavesol: { talk: TalkData } }).wavesol.talk);
/** What the presenter view shows as current (its preview carries node and step). */
const shown = async (presenter: Page) => {
  const el = presenter.locator(".ws-presenter-current .ws-preview");
  return { node: await el.getAttribute("data-node"), step: Number(await el.getAttribute("data-step")) };
};

const problems: string[] = [];
function watch(page: Page) {
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
}
test.beforeEach(() => void (problems.length = 0));
test.afterEach(() => expect(problems).toEqual([]));

async function openProjector(context: BrowserContext, hash = "") {
  const page = await context.newPage();
  watch(page);
  await page.goto(BASE + hash);
  await page.waitForFunction(() => "wavesol" in window);
  return page;
}

/** Opens the presenter view with the `p` key, as a presenter would. */
async function popOut(projector: Page) {
  const [presenter] = await Promise.all([projector.context().waitForEvent("page"), projector.keyboard.press("p")]);
  watch(presenter);
  await presenter.waitForLoadState();
  await expect(presenter.getByRole("status")).toHaveText("Projector connected");
  return presenter;
}

test("p pops out the presenter view, which stays in sync both ways", async ({ context }) => {
  const projector = await openProjector(context);
  const presenter = await popOut(projector);
  expect(presenter.url()).toBe(`${BASE}?presenter`);
  expect(await shown(presenter)).toEqual(await nav(projector));

  // projector → presenter
  await projector.keyboard.press("Space");
  await expect.poll(() => shown(presenter)).toEqual(await nav(projector));

  // presenter → projector, including quick repeated presses (as from a clicker)
  const before = await nav(projector);
  await presenter.keyboard.press("Space");
  await presenter.keyboard.press("Space");
  await presenter.keyboard.press("ArrowLeft");
  await expect.poll(() => nav(projector)).not.toEqual(before);
  await expect.poll(() => shown(presenter)).toEqual(await nav(projector));

  // overview from the presenter's keyboard
  await presenter.keyboard.press("o");
  await expect.poll(() => projector.evaluate(() => (window as unknown as { wavesol: { state: { overview: boolean } } }).wavesol.state.overview)).toBe(true);
  await presenter.keyboard.press("Escape");
  await expect.poll(() => projector.evaluate(() => (window as unknown as { wavesol: { state: { overview: boolean } } }).wavesol.state.overview)).toBe(false);
});

test("edges, back and the mini-map in the presenter view drive the projector", async ({ context }) => {
  const projector = await openProjector(context);
  const t = await talk(projector);
  const branching = t.nodes.find((n) => t.edges.filter((e) => e.from === n.id).length >= 2)!;
  const out = t.edges.filter((e) => e.from === branching.id);
  await projector.evaluate((id) => (location.hash = `#/${id}/0`), branching.id);
  await expect.poll(async () => (await nav(projector)).node).toBe(branching.id);
  const presenter = await popOut(projector);

  const buttons = presenter.locator(".ws-presenter-edges ol button");
  await expect(buttons).toHaveCount(out.length);
  await buttons.nth(1).click();
  await expect.poll(async () => (await nav(projector)).node).toBe(out[1]!.to);

  await presenter.locator(".ws-back").click();
  await expect.poll(async () => (await nav(projector)).node).toBe(branching.id);

  // a slide: a frame's box is mostly covered by its children on the map
  const far = t.nodes.find((n) => n.type === "slide" && n.id !== branching.id && !out.some((e) => e.to === n.id))!;
  await presenter.locator(`.ws-minimap-node[data-id="${far.id}"]`).click();
  await expect.poll(async () => (await nav(projector)).node).toBe(far.id);
  await expect(presenter.locator(`.ws-minimap-node[data-id="${far.id}"]`)).toHaveClass(/ws-current/);
});

test("shows the speaker notes and what Space does next", async ({ context }) => {
  const projector = await openProjector(context);
  const t = await talk(projector);
  const withNotes = t.nodes.find((n) => n.notes && n.steps === 0 && t.edges.some((e) => e.from === n.id && e.default))!;
  const next = t.nodes.find((n) => n.id === t.edges.find((e) => e.from === withNotes.id && e.default)!.to)!;
  await projector.evaluate((id) => (location.hash = `#/${id}/0`), withNotes.id);
  const presenter = await popOut(projector);

  const notesText = await presenter.evaluate((html) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.textContent!.trim();
  }, withNotes.notes!);
  await expect(presenter.locator(".ws-notes")).toHaveText(notesText);
  await expect(presenter.locator(".ws-presenter-next h2")).toContainText(next.title);
  await expect(presenter.locator(".ws-presenter-next .ws-preview")).toHaveAttribute("data-node", next.id);
});

test("the layout fills the window without cutting anything off, at any window size", async ({ context }) => {
  const projector = await openProjector(context);
  const presenter = await popOut(projector);
  for (const [width, height] of [
    [1280, 720],
    [1280, 800],
    [1000, 640],
    [1600, 1000],
  ] as const) {
    await presenter.setViewportSize({ width, height });
    // measured after the next painted frame: what the presenter sees
    const boxes = await presenter.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = (el: Element) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
      };
      const grid = document.querySelector(".ws-presenter")!;
      const parts = [".ws-presenter-bar", ".ws-presenter-current", ".ws-presenter-next", ".ws-presenter-side", ".ws-presenter-map", ".ws-minimap", ".ws-preview-world"];
      return {
        grid: r(grid),
        parts: parts.flatMap((sel) => [...document.querySelectorAll(sel)].map((el) => ({ sel, ...r(el) }))),
      };
    });
    const where = `${width}x${height}`;
    expect(boxes.grid, where).toEqual({ top: 0, left: 0, bottom: height, right: width });
    for (const p of boxes.parts) {
      expect(p.bottom, `${p.sel} at ${where}`).toBeLessThanOrEqual(height + 0.5);
      expect(p.right, `${p.sel} at ${where}`).toBeLessThanOrEqual(width + 0.5);
      expect(p.top, `${p.sel} at ${where}`).toBeGreaterThanOrEqual(-0.5);
      expect(p.left, `${p.sel} at ${where}`).toBeGreaterThanOrEqual(-0.5);
    }
  }
});

test("the status and time bar sits in the side column, leaving the left side to the previews", async ({ context }) => {
  const projector = await openProjector(context);
  const presenter = await popOut(projector);
  const bar = presenter.locator(".ws-presenter-side > .ws-presenter-bar");
  await expect(bar).toHaveCount(1);
  await expect(bar.getByRole("heading")).toHaveCount(0);
  await expect(bar.locator(".ws-timer")).toBeVisible();
  await expect(bar.locator(".ws-clock")).toBeVisible();
  // the current-slide panel starts at the top of the window: no full-width bar above it
  const top = await presenter.locator(".ws-presenter-current").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThanOrEqual(16);
});

test("an image node renders in the presenter preview", async ({ context }) => {
  const projector = await openProjector(context);
  const t = await talk(projector);
  const img = t.nodes.find((n) => n.type === "image")!;
  await projector.evaluate((id) => (location.hash = `#/${id}/0`), img.id);
  const presenter = await popOut(projector);
  const el = presenter.locator(".ws-presenter-current .ws-preview img");
  await expect.poll(() => el.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
});

test("the presenter view waits for the projector and survives a projector reload", async ({ context }) => {
  // opened first, directly: waits
  const presenter = await context.newPage();
  watch(presenter);
  await presenter.goto(`${BASE}?presenter`);
  await expect(presenter.getByRole("status")).toContainText("Waiting for the projector");

  const projector = await openProjector(context);
  await expect(presenter.getByRole("status")).toHaveText("Projector connected");
  await projector.keyboard.press("Space");
  await expect.poll(() => shown(presenter)).toEqual(await nav(projector));

  // a reload is a new projector session; the presenter follows it and can drive it
  await projector.reload();
  await projector.waitForFunction(() => "wavesol" in window);
  await expect(presenter.getByRole("status")).toHaveText("Projector connected");
  const before = await nav(projector);
  await presenter.keyboard.press("Space");
  await expect.poll(() => nav(projector)).not.toEqual(before);

  await projector.close();
  await expect(presenter.getByRole("status")).toContainText("Waiting for the projector");
});
