// `wavesol check --render` on a fixture talk with slides that overflow and an image that can't load,
// and `wavesol build --pdf`. These run the CLI (which runs Chromium through Playwright).
import { test, expect } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { PNG } from "pngjs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "../../bin/wavesol.js");
const TALK = resolve(import.meta.dirname, "../fixtures/render-talk");

/** Runs the CLI; its reports go to stderr. */
function run(args: string[]): { code: number; out: string } {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { code: r.status ?? 1, out: r.stdout + r.stderr };
}

test("check --render reports overflowing slides and images that don't load, at their files", () => {
  test.setTimeout(120_000);
  const shots = mkdtempSync(join(tmpdir(), "wavesol-shots-"));
  try {
    const r = run(["check", TALK, "--render", "--shots", shots]);
    const lines = r.out.split("\n").filter((l) => l.includes("warning"));
    // (hidden fragments take their space too, so it overflows from the first step)
    expect(lines).toContainEqual(expect.stringMatching(/^nodes\/long\.md: warning: long: the content is \d+px too tall for the slide$/));
    expect(lines).toContainEqual(expect.stringMatching(/^nodes\/wide\.md: warning: wide: the content is \d+px too wide for the slide$/));
    expect(lines).toContainEqual("nodes/broken.md: warning: broken: image https://wavesol.invalid/missing.png did not load");
    expect(lines.some((l) => l.includes("fine"))).toBe(false);
    // reported once, not once per step
    expect(lines.filter((l) => l.includes("long:"))).toHaveLength(1);
    // a screenshot per node and step: fine 0, long 0–25, wide 0, broken 0
    expect(readdirSync(shots).filter((f) => f.endsWith(".png"))).toHaveLength(1 + 26 + 1 + 1);
    expect(r.code).toBe(0); // warnings, not errors
  } finally {
    rmSync(shots, { recursive: true, force: true });
  }
});

test("build --pdf writes a PDF with a 16:9 page per node, in reading order", () => {
  test.setTimeout(120_000);
  const out = mkdtempSync(join(tmpdir(), "wavesol-pdf-"));
  try {
    const r = run(["build", TALK, "--out", out, "--pdf"]);
    expect(r.out).toContain("(4 pages)");
    const pdf = join(out, "talk.pdf");
    expect(existsSync(pdf)).toBe(true);
    const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
    expect(info).toMatch(/Pages:\s+4\b/);
    const [w, h] = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info)!.slice(1).map(Number);
    expect(w! / h!).toBeCloseTo(16 / 9, 2);
    // text is real text, pages in reading order
    const text = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
    const at = (s: string) => text.indexOf(s);
    expect(at("Fine")).toBeGreaterThanOrEqual(0);
    expect(at("Fine")).toBeLessThan(at("Too long"));
    expect(at("Too long")).toBeLessThan(at("Too wide"));
    expect(at("Too wide")).toBeLessThan(at("Broken image"));
    // steps: last → the list's fragments are shown (the end of the list is cut off: it overflows)
    expect(text).toContain("line 3 of far too many");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("in a long PDF (the docs: 41 pages) every page is full-size", () => {
  // Chrome's print layout used to shrink all pages once a talk had ~20 of them (the previews'
  // oversized worlds leaked into it); the docs build that the e2e server runs writes this PDF
  const pdf = resolve(import.meta.dirname, "../../test-results/docs-dist/talk.pdf");
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [pdf], { encoding: "utf8" }))![1]);
  expect(pages).toBeGreaterThan(20);
  const dir = mkdtempSync(join(tmpdir(), "wavesol-pdfpage-"));
  try {
    // the last page: a slide card should span (nearly) the page's width
    execFileSync("pdftoppm", ["-f", String(pages), "-l", String(pages), "-scale-to-x", "800", "-scale-to-y", "-1", "-png", pdf, join(dir, "p")]);
    const file = readdirSync(dir).find((f) => f.endsWith(".png"))!;
    const img = PNG.sync.read(readFileSync(join(dir, file)));
    const y = Math.floor(img.height / 2);
    let left = -1;
    let right = -1;
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i]! >= 0xfc && img.data[i + 1]! >= 0xfa) {
        if (left < 0) left = x;
        right = x;
      }
    }
    expect((right - left + 1) / img.width).toBeGreaterThan(0.95);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
