// Audience polls end to end: the built docs talk on the projector, ~30 simulated audience phones
// (network clients in this process, through the test server's local relay, as real phones would go
// through `wavesol serve`'s) plus two real browser phones.
import { test, expect, type Page } from "@playwright/test";
import { room } from "../../src/sync/crypto.ts";
import { NetPeer } from "../../src/sync/net.ts";
import { RoomSignal } from "../../src/sync/signal.ts";
import { Voter, type AudienceMessage } from "../../src/sync/audience.ts";
import { SyncPeer, type Message } from "../../src/sync/protocol.ts";

const BASE = "http://localhost:4180/wavesol/";
const RELAY = "ws://localhost:4180/wavesol/__wavesol/relay";
const SIMULATED = 30;

const problems: string[] = [];
function watch(page: Page, who: string) {
  page.on("pageerror", (e) => problems.push(`${who} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`${who} console: ${m.text()}`));
}
test.beforeEach(() => void (problems.length = 0));
test.afterEach(() => expect(problems).toEqual([]));

const nav = (p: Page) =>
  p.evaluate(() => {
    const { node, step } = (window as unknown as { wavesol: { state: { nav: { node: string; step: number } } } }).wavesol.state.nav;
    return { node, step };
  });

/** Opens the projector on the docs' poll and returns the audience's join URL (from `j`). */
async function projectorOnPoll(page: Page) {
  watch(page, "projector");
  await page.goto(BASE);
  await page.waitForFunction(() => "wavesol" in window);
  const id = await page.evaluate(() => (window as unknown as { wavesol: { talk: { nodes: { id: string; type: string }[] } } }).wavesol.talk.nodes.find((n) => n.type === "poll")!.id);
  await page.evaluate((id) => (location.hash = `#/${id}/0`), id);
  await page.keyboard.press("j");
  const url = (await page.locator(".ws-join a").getAttribute("href"))!;
  await page.keyboard.press("Escape");
  const pollNode = page.locator(`.ws-node[data-id="${id}"]`);
  return { id, url, pollNode, secret: new URLSearchParams(url.split("#")[1]).get("k")! };
}

/** A simulated audience phone: the same network client and voter as the audience page. */
function simulatedPhone<M extends { kind: string }>(secret: string) {
  const r = room(secret);
  return new NetPeer<M>({ room: r, signal: new RoomSignal(RELAY, r.topic), ice: false });
}

test(`a poll with ${SIMULATED} simulated phones and two real ones: counts, changed votes, reveal, presenter`, async ({ page, browser, context }) => {
  test.setTimeout(120_000);
  const { url, pollNode, secret } = await projectorOnPoll(page);
  const [presenter] = await Promise.all([context.waitForEvent("page"), page.keyboard.press("p")]);
  watch(presenter, "presenter");
  await page.bringToFront();

  const sims = Array.from({ length: SIMULATED }, (_, i) => {
    const net = simulatedPhone<AudienceMessage>(secret);
    return { net, voter: new Voter(net, `sim-${i}`) };
  });
  try {
    // each sees the poll, then votes option i % 4
    await expect.poll(() => sims.filter((s) => s.voter.current.poll).length, { timeout: 30_000 }).toBe(SIMULATED);
    sims.forEach((s, i) => s.voter.vote(i % 4));
    // real phones: open the join link, vote B
    const phones: Page[] = [];
    for (let i = 0; i < 2; i++) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const phone = await ctx.newPage();
      watch(phone, `phone ${i}`);
      await phone.goto(url);
      await phone.getByRole("button", { name: /^B/ }).tap();
      await expect(phone.getByRole("note")).toHaveText("You voted B. Tap another answer to change it.");
      phones.push(phone);
    }
    await expect(pollNode.locator(".ws-poll-status")).toHaveText(`${SIMULATED + 2} votes`, { timeout: 20_000 });

    // five simulated phones change their mind to D; one real phone too
    for (const s of sims.slice(0, 5)) s.voter.vote(3);
    await phones[1]!.getByRole("button", { name: /^D/ }).tap();
    // expected: 30 votes spread over A–D, minus 5 moved to D (sims 0–4 had A, B, C, D, A), plus the phones
    const expected = [0, 0, 0, 0];
    sims.forEach((_, i) => expected[i < 5 ? 3 : i % 4]!++);
    expected[1]!++; // phone 0: B
    expected[3]!++; // phone 1: D
    // before the reveal: no counts on the projector, but the presenter sees them
    await expect(pollNode.locator(".ws-poll-count").first()).toHaveText("");
    const preview = presenter.locator(".ws-presenter-current .ws-preview .ws-poll-count");
    await expect.poll(() => preview.allTextContents(), { timeout: 20_000 }).toEqual(expected.map(String));
    // Space reveals
    await page.keyboard.press("Space");
    await expect(pollNode.locator(".ws-poll")).toHaveClass(/ws-poll-revealed/);
    await expect.poll(() => pollNode.locator(".ws-poll-count").allTextContents()).toEqual(expected.map(String));
    await expect(pollNode.locator(".ws-poll-status")).toHaveText(`${SIMULATED + 2} votes`);

    // leaving the poll closes it on the phones
    await page.keyboard.press("Space");
    await expect(phones[0]!.getByText("Waiting for the next poll…")).toBeVisible();
    await expect.poll(() => sims.filter((s) => s.voter.current.poll).length).toBe(0);
  } finally {
    for (const s of sims) s.net.close();
  }
});

test("the audience's code cannot drive the talk", async ({ page }) => {
  const { id, secret } = await projectorOnPoll(page);
  // a controller in the audience room: it would step the talk if the projector listened there
  const net = simulatedPhone<Message>(secret);
  const intruder = new SyncPeer(net);
  try {
    await page.waitForTimeout(2_000);
    intruder.send({ type: "step" });
    intruder.send({ type: "goto", node: "welcome" });
    await page.waitForTimeout(1_000);
    expect(await nav(page)).toEqual({ node: id, step: 0 });
    expect(intruder.current.connected).toBe(false); // the projector sends no talk state in that room
  } finally {
    net.close();
  }
});
