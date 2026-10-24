import { describe, expect, it } from "vitest";
import { slide, type SlideData } from "./build.ts";
import type { BuildCtx } from "../types.ts";

async function build(body: string, data: { fragments?: "lists"; notes?: string } = {}) {
  const reports: string[] = [];
  const ctx: BuildCtx = { talkDir: "/", macros: { "\\R": "\\mathbb{R}" }, asset: (p) => `assets/${p.split("/").pop()}`, report: (s, m, l) => reports.push(`${l ?? "-"}: ${s}: ${m}`) };
  const r = await slide.build({ id: "s", data, body, bodyLine: 3, file: "/talk/nodes/s.md" }, ctx);
  const steps = [...(r.data as SlideData).html.matchAll(/data-step="(\d+)"/g)].map((m) => Number(m[1]));
  return { ...r, html: (r.data as SlideData).html, steps, reports };
}

describe("slide build", () => {
  it("numbers fragments: one step after the previous, or explicit", async () => {
    const r = await build("A {.fragment}\n\n- b {.fragment step=3}\n- c {.fragment step=3}\n\n::: fragment fade-up\nD\n:::\n\nE {.fragment step=1}\n");
    expect(r.steps).toEqual([1, 2, 2, 3, 1]); // 1, 3, 3, 4, 1 normalised to consecutive steps
    expect(r.html).toContain('class="fragment fade-up"');
  });

  it("makes top-level list items fragments with fragments: lists", async () => {
    const r = await build("- a\n- b\n  - nested\n", { fragments: "lists" });
    expect(r.steps).toEqual([1, 2]);
  });

  it("extracts notes, title and math, and reports errors with lines", async () => {
    const r = await build("# Hello $\\R$\n\n$\\nope$\n\n::: notes\nSecret\n:::\n", { notes: "Front" });
    expect(r.title).toBe("Hello");
    expect(r.notes).toContain("Front");
    expect(r.notes).toContain("Secret");
    expect(r.html).not.toContain("Secret");
    expect(r.html).toContain("katex");
    expect(r.reports).toEqual(["5: error: math: KaTeX parse error: Undefined control sequence: \\nope at position 1: \\̲n̲o̲p̲e̲"]);
  });

  it("rewrites relative image paths to assets", async () => {
    const r = await build("![x](../figures/a.png) ![y](https://example.com/b.png)");
    expect(r.html).toContain('src="assets/a.png"');
    expect(r.html).toContain('src="https://example.com/b.png"');
  });
});
