// End-to-end tests for Lean nodes in the built docs talk: step through a proof, click a tactic,
// hover a token.
import { test, expect, type Page } from "@playwright/test";

const BASE = "http://localhost:4180/wavesol/";

interface LeanNode {
  id: string;
  type: string;
  steps: number;
  data: { steps: number[]; tactics: { text: string; kind: string }[] };
}

const problems: string[] = [];
test.beforeEach(async ({ page }) => {
  problems.length = 0;
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
});
test.afterEach(() => expect(problems).toEqual([]));

/** The docs' stepped Lean proof: the Lean node with the most steps. */
async function openProof(page: Page) {
  await page.goto(BASE);
  await page.waitForFunction(() => "wavesol" in window);
  const node = await page.evaluate(() =>
    (window as unknown as { wavesol: { talk: { nodes: LeanNode[] } } }).wavesol.talk.nodes
      .filter((n) => n.type === "lean")
      .sort((a, b) => b.steps - a.steps)[0]!,
  );
  await page.evaluate((id) => (location.hash = `#/${id}/0`), node.id);
  await expect.poll(() => page.evaluate(() => (window as unknown as { wavesol: { state: { nav: { node: string } } } }).wavesol.state.nav.node)).toBe(node.id);
  const root = page.locator(`.ws-node[data-id="${node.id}"]`);
  await expect(root).toHaveAttribute("data-detail", "active");
  return { node, root, info: root.locator(".ws-lean-info") };
}

test("Space steps through the proof: current tactic highlighted, goals before and after", async ({ page }) => {
  const { node, root, info } = await openProof(page);
  expect(node.steps).toBeGreaterThanOrEqual(3);
  // step 0: the starting goal, no tactic highlighted
  await expect(info.locator(".ws-info-head")).toHaveText("Start");
  await expect(info.locator(".ws-concl")).toHaveCount(1);
  await expect(root.locator(".ws-tac-current")).toHaveCount(0);

  for (let step = 1; step <= node.steps; step++) {
    await page.keyboard.press("Space");
    const tactic = node.data.tactics[node.data.steps[step - 1]!]!;
    await expect(root.locator(".ws-tac-current")).toHaveCount(1);
    await expect(root.locator(".ws-tac-current")).toContainText(tactic.text.replace(/,$/, ""));
    await expect(info.locator(".ws-info-head code")).toHaveText(tactic.text.replace(/,$/, ""));
    if (tactic.kind === "tactic") await expect(info.locator(".ws-info-sub")).toHaveText(["Before", "After"]);
  }
  // the last tactic closes the goal
  await expect(info.locator(".ws-goals").last()).toHaveText("No goals");
  // and Space moves on to the next node
  await page.keyboard.press("Space");
  await expect(root.locator(".ws-tac-current")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { wavesol: { state: { nav: { node: string } } } }).wavesol.state.nav.node)).not.toBe(node.id);
});

test("clicking a tactic shows its goals", async ({ page }) => {
  const { root, info } = await openProof(page);
  const rfl = root.locator(".ws-tac", { hasText: /^rfl$/ }).first();
  await rfl.click();
  await expect(rfl).toHaveClass(/ws-tac-current/);
  await expect(info.locator(".ws-info-head code")).toHaveText("rfl");
  await expect(info.locator(".ws-info-sub")).toHaveText(["Before", "After"]);
  await expect(info.locator(".ws-goals").last()).toHaveText("No goals");
  // clicking does not navigate
  expect(await page.evaluate(() => (window as unknown as { wavesol: { state: { nav: { step: number } } } }).wavesol.state.nav.step)).toBe(0);
});

test("hovering a constant shows its signature and docstring", async ({ page }) => {
  const { root } = await openProof(page);
  const hover = root.locator(".ws-lean-hover");
  await expect(hover).toBeHidden();
  await root.locator(".ws-lean-code .lk-const", { hasText: "List" }).first().hover();
  await expect(hover).toBeVisible();
  await expect(hover.locator(".ws-hover-sig")).toHaveText(/^List\.\{u\} \(α : Type u\) : Type u$/);
  await expect(hover.locator(".ws-hover-doc")).toContainText("Linked lists");
  await page.mouse.move(5, 5);
  await expect(hover).toBeHidden();
});
