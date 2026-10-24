// End-to-end tests for the phone controller: projector and phone in separate browser contexts (so
// nothing is shared but the network), connected through the local relay of the test server, which
// stands in for the public relays (those only get the manual smoke test, scripts/smoke-relays.ts).
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BASE = "http://localhost:4180/wavesol/";

interface Nav {
  node: string;
  step: number;
}
interface TalkData {
  start: string;
  nodes: { id: string; type: string; title: string; steps: number }[];
  edges: { from: string; to: string; default?: boolean }[];
}

const nav = (projector: Page) =>
  projector.evaluate(() => {
    const { node, step } = (window as unknown as { wavesol: { state: { nav: Nav } } }).wavesol.state.nav;
    return { node, step };
  });
const talk = (projector: Page) => projector.evaluate(() => (window as unknown as { wavesol: { talk: TalkData } }).wavesol.talk);
const phoneStatus = (phone: Page) => phone.evaluate(() => (window as unknown as { wavesolPhone?: { net: { status: string } } }).wavesolPhone?.net.status);
/** What the phone shows as current. */
const phoneNav = (phone: Page) =>
  phone.evaluate(() => {
    const s = (window as unknown as { wavesolPhone?: { peer: { current: { state?: Nav } } } }).wavesolPhone?.peer.current.state;
    return s ? { node: s.node, step: s.step } : undefined;
  });

const problems: string[] = [];
function watch(page: Page, who: string) {
  page.on("pageerror", (e) => problems.push(`${who} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${who} console: ${m.text()}`));
}
test.beforeEach(() => void (problems.length = 0));
test.afterEach(() => expect(problems).toEqual([]));

async function openProjector(context: BrowserContext, hash = "") {
  const page = await context.newPage();
  watch(page, "projector");
  await page.goto(BASE + hash);
  await page.waitForFunction(() => "wavesol" in window);
  return page;
}

/** Presses `c` on the projector and returns the pairing URL from the panel's link. */
async function pairUrl(projector: Page) {
  await projector.keyboard.press("c");
  const panel = projector.getByRole("complementary", { name: "Connect a phone" });
  await expect(panel.getByRole("img", { name: "QR code for the phone" })).toBeVisible();
  return (await panel.getByRole("link", { name: "this link" }).getAttribute("href"))!;
}

async function openPhone(browser: Browser, url: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  watch(page, "phone");
  await page.goto(url);
  return page;
}

test("pair with the QR link; the phone drives the projector and follows it", async ({ context, browser }) => {
  const projector = await openProjector(context);
  const url = await pairUrl(projector);
  expect(url).toMatch(/\?phone#k=[\w-]{22}$/);
  const phone = await openPhone(browser, url);
  await expect.poll(() => phoneStatus(phone), { timeout: 15_000 }).toBe("p2p");
  await expect(phone.getByRole("status")).toHaveText("Connected (direct)");
  await expect(projector.getByRole("complementary", { name: "Connect a phone" }).getByRole("status")).toHaveText("Phone connected (direct).");

  // phone → projector: Next, an edge, Back, Prev
  const t = await talk(projector);
  const start = await nav(projector);
  await phone.getByRole("button", { name: "Next" }).tap();
  await expect.poll(() => nav(projector)).not.toEqual(start);
  const out = t.edges.filter((e) => e.from === (start.node));
  await phone.getByRole("button", { name: "Back" }).tap();
  await expect.poll(() => nav(projector)).toEqual(start);
  await phone.locator(".ws-phone-edges button").nth(1).tap();
  await expect.poll(async () => (await nav(projector)).node).toBe(out[1]!.to);

  // projector → phone
  await projector.keyboard.press("Backspace");
  await expect.poll(() => phoneNav(phone)).toEqual(await nav(projector));
  await expect(phone.locator(".ws-phone-edges button")).toHaveCount(out.length);
});

test("the presenter view shows the phone and can show the QR code", async ({ context, browser }) => {
  const projector = await openProjector(context);
  const [presenter] = await Promise.all([context.waitForEvent("page"), projector.keyboard.press("p")]);
  watch(presenter, "presenter");
  await expect(presenter.locator(".ws-presenter-phone")).toContainText("not paired");
  await presenter.getByRole("button", { name: "Connect a phone" }).click();
  const qr = presenter.getByRole("img", { name: "QR code for the phone" });
  await expect(qr).toBeVisible();
  const url = (await presenter.locator(".ws-pair").getByRole("link", { name: "this link" }).getAttribute("href"))!;

  const phone = await openPhone(browser, url);
  await expect(presenter.locator(".ws-presenter-phone")).toContainText("direct", { timeout: 15_000 });
  await phone.close();
});

test("the laser pointer follows the phone's pad and disappears on release", async ({ context, browser }) => {
  const projector = await openProjector(context);
  const phone = await openPhone(browser, await pairUrl(projector));
  await expect.poll(() => phoneStatus(phone), { timeout: 15_000 }).toBe("p2p");
  await projector.keyboard.press("Escape"); // close the panel

  const pad = (await phone.locator(".ws-phone-laser").boundingBox())!;
  await phone.mouse.move(pad.x + pad.width * 0.2, pad.y + pad.height * 0.8);
  await phone.mouse.down();
  await phone.mouse.move(pad.x + pad.width * 0.75, pad.y + pad.height * 0.25, { steps: 8 });
  const laser = projector.locator(".ws-laser");
  await expect(laser).toHaveClass(/ws-on/);
  // settles on the target: 75% across, 25% down the projector screen
  const vp = projector.viewportSize()!;
  await expect
    .poll(async () => {
      const b = (await laser.boundingBox())!;
      return [Math.round((b.x + b.width / 2) / vp.width * 100), Math.round((b.y + b.height / 2) / vp.height * 100)];
    })
    .toEqual([75, 25]);
  await phone.mouse.up();
  await expect(laser).not.toHaveClass(/ws-on/);
});

test("a dropped direct connection falls back to the relay, then reconnects", async ({ context, browser }) => {
  const projector = await openProjector(context);
  const phone = await openPhone(browser, await pairUrl(projector));
  await expect.poll(() => phoneStatus(phone), { timeout: 15_000 }).toBe("p2p");

  await phone.evaluate(() => (window as unknown as { wavesolPhone: { net: { dropDirect(): void } } }).wavesolPhone.net.dropDirect());
  await expect.poll(() => phoneStatus(phone)).toBe("relay");
  await expect(phone.getByRole("status")).toHaveText("Connected (relayed)");
  const before = await nav(projector);
  await phone.getByRole("button", { name: "Next" }).tap();
  await expect.poll(() => nav(projector)).not.toEqual(before);

  // and the direct connection comes back on its own
  await expect.poll(() => phoneStatus(phone), { timeout: 15_000 }).toBe("p2p");
});

test("relay only: survives the relay dropping everyone, and resyncs", async ({ context, browser }) => {
  const projector = await openProjector(context);
  const phone = await openPhone(browser, (await pairUrl(projector)).replace("#k=", "#rtc=0&k="));
  await expect.poll(() => phoneStatus(phone), { timeout: 15_000 }).toBe("relay");
  const before = await nav(projector);
  await phone.getByRole("button", { name: "Next" }).tap();
  await expect.poll(() => nav(projector)).not.toEqual(before);

  // the relay server drops every connection; meanwhile the projector moves on
  await projector.request.post(`${BASE}__wavesol/test/drop-relay`);
  await projector.keyboard.press("Space");
  await projector.keyboard.press("Space");
  // both reconnect by themselves; the phone gets a full snapshot
  await expect.poll(() => phoneStatus(phone), { timeout: 20_000 }).toBe("relay");
  await expect.poll(() => phoneNav(phone), { timeout: 20_000 }).toEqual(await nav(projector));
  const now = await nav(projector);
  await phone.getByRole("button", { name: "Next" }).tap();
  await expect.poll(() => nav(projector)).not.toEqual(now);
});

test("a phone with the wrong key cannot control the projector", async ({ context, browser }) => {
  const projector = await openProjector(context);
  const url = await pairUrl(projector);
  const wrong = url.replace(/k=([\w-])/, (_, c: string) => `k=${c === "A" ? "B" : "A"}`);
  const phone = await openPhone(browser, wrong);
  await phone.waitForTimeout(3_000);
  expect(await phoneStatus(phone)).toBe("connecting");
  await expect(phone.getByRole("status")).toHaveText("Looking for the projector…");
  const before = await nav(projector);
  await phone.getByRole("button", { name: "Next" }).tap();
  await phone.waitForTimeout(1_000);
  expect(await nav(projector)).toEqual(before);
  await expect(projector.getByRole("complementary", { name: "Connect a phone" }).getByRole("status")).toHaveText("No phone connected yet.");
});

test("the phone follows a reloaded projector (same pairing)", async ({ context, browser }) => {
  const projector = await openProjector(context);
  const phone = await openPhone(browser, await pairUrl(projector));
  await expect.poll(() => phoneStatus(phone), { timeout: 15_000 }).toBe("p2p");

  await projector.reload();
  await projector.waitForFunction(() => "wavesol" in window);
  // no `c` needed after a reload: the tab remembers it was paired
  await expect.poll(() => phoneStatus(phone), { timeout: 20_000 }).toBe("p2p");
  const before = await nav(projector);
  await phone.getByRole("button", { name: "Next" }).tap();
  await expect.poll(() => nav(projector)).not.toEqual(before);
});

/** Projector position (normalised) of an element's centre. */
async function spot(projector: Page, target: ReturnType<Page["locator"]>): Promise<[number, number]> {
  const box = (await target.boundingBox())!;
  const vp = projector.viewportSize()!;
  return [(box.x + box.width / 2) / vp.width, (box.y + box.height / 2) / vp.height];
}

/** Holds the phone's laser still on a projector position, then lets go. */
async function holdLaser(phone: Page, at: [number, number], ms = 400) {
  const pad = (await phone.locator(".ws-phone-laser").boundingBox())!;
  await phone.mouse.move(pad.x + at[0] * pad.width, pad.y + at[1] * pad.height);
  await phone.mouse.down();
  await phone.waitForTimeout(ms);
  await phone.mouse.up();
}

/** Projector and phone (laser), on the docs' stepped Lean proof. */
async function onLeanProof(context: BrowserContext, browser: Browser) {
  const projector = await openProjector(context);
  const phone = await openPhone(browser, await pairUrl(projector));
  await expect.poll(() => phoneStatus(phone), { timeout: 15_000 }).toBe("p2p");
  await projector.keyboard.press("Escape"); // close the pairing panel
  const id = await projector.evaluate(() =>
    (window as unknown as { wavesol: { talk: { nodes: { id: string; type: string; steps: number }[] } } }).wavesol.talk.nodes
      .filter((n) => n.type === "lean")
      .sort((a, b) => b.steps - a.steps)[0]!.id,
  );
  await projector.evaluate((node) => (location.hash = `#/${node}/0`), id);
  const root = projector.locator(`.ws-node[data-id="${id}"]`);
  await expect(root).toHaveAttribute("data-detail", "active");
  // wait for the camera to arrive
  await expect.poll(() => projector.evaluate(() => document.querySelector<HTMLElement>(".ws-world")!.style.willChange)).not.toBe("transform");
  const tac = (text: string | RegExp) => root.locator(".ws-lean-code .ws-tac", { hasText: text });
  return { projector, phone, id, root, tac, head: root.locator(".ws-lean-info .ws-info-head") };
}

test("the laser resting on a tactic selects it; the step follows, and the selection stays", async ({ context, browser }) => {
  const { projector, phone, id, tac, head } = await onLeanProof(context, browser);
  const rule = tac(/^List\.reverse_append,$/);
  await holdLaser(phone, await spot(projector, rule));
  await expect(rule).toHaveClass(/ws-tac-current/);
  await expect(head.locator("code")).toHaveText("List.reverse_append");
  const step = (await nav(projector)).step;
  expect(step).toBeGreaterThan(0);
  expect(await nav(projector)).toEqual({ node: id, step });
  // released: the selection stays
  await projector.waitForTimeout(300);
  await expect(rule).toHaveClass(/ws-tac-current/);
  // and Space continues from it
  await projector.keyboard.press("Space");
  await expect(tac(/^ih$/)).toHaveClass(/ws-tac-current/);
  expect((await nav(projector)).step).toBe(step + 1);
});

test("the laser on `rw` shows the whole rewrite; Space then goes to its first rule; the presenter mirrors it", async ({ context, browser }) => {
  const { projector, phone, tac, head } = await onLeanProof(context, browser);
  const [presenter] = await Promise.all([context.waitForEvent("page"), projector.keyboard.press("p")]);
  watch(presenter, "presenter");
  await presenter.waitForLoadState();
  await projector.bringToFront();

  const rw = tac(/^rw \[/);
  const rwBox = (await rw.boundingBox())!;
  const vp = projector.viewportSize()!;
  // the `rw` keyword itself: the start of the span, not one of its rules
  await holdLaser(phone, [(rwBox.x + 12) / vp.width, (rwBox.y + rwBox.height / 2) / vp.height]);
  await expect(rw).toHaveClass(/ws-tac-current/);
  await expect(head.locator("code")).toHaveText("rw [List.reverse_cons, List.reverse_append, ih]");
  // the presenter's preview shows the same
  const preview = presenter.locator(".ws-presenter-current .ws-preview");
  await expect(preview.locator(".ws-tac-current")).toHaveText(/^rw \[/);
  await expect(preview.locator(".ws-info-head code")).toHaveText("rw [List.reverse_cons, List.reverse_append, ih]");

  await projector.keyboard.press("Space");
  await expect(tac(/^List\.reverse_cons,$/)).toHaveClass(/ws-tac-current/);
  await expect(preview.locator(".ws-tac-current")).toHaveText("List.reverse_cons,");
});

test("the laser on `by` goes back to the start", async ({ context, browser }) => {
  const { projector, phone, id, root, tac, head } = await onLeanProof(context, browser);
  await projector.keyboard.press("Space");
  await projector.keyboard.press("Space");
  await holdLaser(phone, await spot(projector, tac(/^by$/)));
  await expect.poll(() => nav(projector)).toEqual({ node: id, step: 0 });
  await expect(head).toHaveText("Start");
  await expect(root.locator(".ws-tac-current")).toHaveCount(0);
});

test("sweeping the laser across the code selects nothing", async ({ context, browser }) => {
  const { projector, phone, id, root, tac } = await onLeanProof(context, browser);
  const code = (await root.locator(".ws-lean-code").boundingBox())!;
  const rw = (await tac(/^rw \[/).boundingBox())!;
  const vp = projector.viewportSize()!;
  const pad = (await phone.locator(".ws-phone-laser").boundingBox())!;
  const toPad = (x: number, y: number) => [pad.x + (x / vp.width) * pad.width, pad.y + (y / vp.height) * pad.height] as const;
  // along the rw line: from its indentation, across `rw` and all its rules, to the far right (the
  // infoview, where there are no tactics)
  const y = rw.y + rw.height / 2;
  const [x0, y0] = toPad(code.x + 2, y);
  const [x1, y1] = toPad(vp.width - 10, y);
  await phone.mouse.move(x0, y0);
  await phone.mouse.down();
  // a steady sweep (~400 ms), as a hand would: the dot spends well under 100 ms on each tactic
  for (let i = 1; i <= 20; i++) {
    await phone.mouse.move(x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20);
    await phone.waitForTimeout(20);
  }
  await phone.waitForTimeout(400);
  await phone.mouse.up();
  expect(await nav(projector)).toEqual({ node: id, step: 0 });
  await expect(root.locator(".ws-tac-current")).toHaveCount(0);
});

test("a Lean node without tactic steps ignores the laser", async ({ context, browser }) => {
  const projector = await openProjector(context);
  const phone = await openPhone(browser, await pairUrl(projector));
  await expect.poll(() => phoneStatus(phone), { timeout: 15_000 }).toBe("p2p");
  await projector.keyboard.press("Escape");
  const id = await projector.evaluate(() =>
    (window as unknown as { wavesol: { talk: { nodes: { id: string; type: string; steps: number }[] } } }).wavesol.talk.nodes.find((n) => n.type === "lean" && n.steps === 0)!.id,
  );
  await projector.evaluate((node) => (location.hash = `#/${node}/0`), id);
  const root = projector.locator(`.ws-node[data-id="${id}"]`);
  await expect(root).toHaveAttribute("data-detail", "active");
  await expect.poll(() => projector.evaluate(() => document.querySelector<HTMLElement>(".ws-world")!.style.willChange)).not.toBe("transform");
  await holdLaser(phone, await spot(projector, root.locator(".ws-lean-code .ws-tac").last()));
  await expect(root.locator(".ws-tac-current")).toHaveCount(0);
  await expect(root.locator(".ws-lean-info .ws-info-head")).toHaveText("Start");
});
