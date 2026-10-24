// Rendering a built talk in a headless browser: the visual check (`wavesol check --render`) and the
// PDF (`wavesol build` with `pdf:`). Both open the print view (?print), which has every node at its
// steps on its own 1600×900 page. Needs Playwright with Chromium (an optional dependency).
import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sirv from "sirv";
import type { Browser, BrowserType, Page } from "@playwright/test";
import type { Diagnostic } from "../model/compiled.ts";

const INSTALL = "install it in the talk: npm install --save-dev playwright && npx playwright install chromium";

async function chromium(): Promise<BrowserType> {
  for (const name of ["playwright", "@playwright/test", "playwright-core"]) {
    try {
      const m = (await import(name)) as { chromium?: BrowserType };
      if (m.chromium) return m.chromium;
    } catch {
      // try the next
    }
  }
  throw new Error(`rendering needs Playwright: ${INSTALL}`);
}

function serve(dir: string): Promise<{ url: string; server: Server }> {
  const files = sirv(dir, { dev: true });
  const server = createServer((req, res) => files(req, res));
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, server })));
}

/** Opens the print view of the built site in `dir`, runs `fn`, and cleans up. */
async function withPrintView<T>(dir: string, steps: "last" | "all", fn: (page: Page) => Promise<T>): Promise<T> {
  const type = await chromium();
  let browser: Browser;
  try {
    browser = await type.launch();
  } catch (e) {
    throw new Error(`could not start Chromium (${(e as Error).message.split("\n")[0]}): run npx playwright install chromium`, { cause: e });
  }
  const { url, server } = await serve(dir);
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // functions sent to the page come from tsx-compiled code, which may call esbuild's __name helper
    await page.addInitScript({ content: "window.__name = (f) => f;" });
    await page.goto(`${url}?print&steps=${steps}`);
    await page.waitForFunction(() => (window as unknown as { wavesolPrint?: { ready: boolean } }).wavesolPrint?.ready, null, { timeout: 120_000 });
    if (errors.length) throw new Error(`the talk failed to render: ${errors[0]}`);
    return await fn(page);
  } finally {
    await browser.close();
    server.close();
  }
}

interface Problem {
  node: string;
  step: number;
  message: string;
}

/** Measures every node at every step for things a reader would see as broken. */
export async function checkRender(dir: string, files: Map<string, string>, shots?: string): Promise<Diagnostic[]> {
  return withPrintView(dir, "all", async (page) => {
    if (shots) {
      mkdirSync(shots, { recursive: true });
      for (const el of await page.locator(".ws-print-page").all()) {
        const name = `${await el.getAttribute("data-node")}-${await el.getAttribute("data-step")}.png`;
        await el.screenshot({ path: join(shots, name) });
      }
    }
    const problems = await page.evaluate(() => {
      const out: { node: string; step: number; message: string }[] = [];
      for (const p of document.querySelectorAll<HTMLElement>(".ws-print-page")) {
        const node = p.dataset.node!;
        const step = Number(p.dataset.step);
        const root = p.querySelector<HTMLElement>(".ws-preview-world > .ws-node .ws-content");
        if (!root) continue;
        const over = (el: Element, what: string) => {
          const dy = el.scrollHeight - el.clientHeight;
          const dx = el.scrollWidth - el.clientWidth;
          if (dy > 1) out.push({ node, step, message: `${what} is ${dy}px too tall for the slide` });
          if (dx > 1) out.push({ node, step, message: `${what} is ${dx}px too wide for the slide` });
        };
        if (!root.closest(".ws-type-frame")) over(root, "the content");
        for (const info of root.querySelectorAll(".ws-lean-info")) over(info, "the Lean infoview");
        for (const code of root.querySelectorAll(".ws-lean-code")) over(code, "the Lean code");
        for (const img of root.querySelectorAll("img")) {
          if (!img.complete || !img.naturalWidth) out.push({ node, step, message: `image ${img.getAttribute("src")} did not load` });
        }
      }
      return out;
    });
    // one report per node and problem: the first step it shows up at
    const seen = new Set<string>();
    const diagnostics: Diagnostic[] = [];
    for (const p of problems as Problem[]) {
      const kind = `${p.node}|${p.message.replace(/\d+px/, "")}`;
      if (seen.has(kind)) continue;
      seen.add(kind);
      diagnostics.push({ severity: "warning", file: files.get(p.node) ?? "talk.yaml", message: `${p.node}: ${p.message}${p.step ? ` (at step ${p.step})` : ""}` });
    }
    return diagnostics;
  });
}

/** Prints the talk (the built site in `dir`) to a PDF: one 16:9 page per node, or per step. */
export async function writePdf(dir: string, file: string, steps: "last" | "all"): Promise<number> {
  return withPrintView(dir, steps, async (page) => {
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: join(dir, file), width: "1600px", height: "900px", printBackground: true, preferCSSPageSize: true });
    return page.locator(".ws-print-page").count();
  });
}
