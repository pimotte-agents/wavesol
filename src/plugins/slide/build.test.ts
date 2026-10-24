import { describe, expect, it } from "vitest";
import { slide, type SlideData } from "./build.ts";
import type { BuildCtx } from "../types.ts";

async function build(body: string, data: { fragments?: "lists"; notes?: string } = {}) {
  const reports: string[] = [];
  const ctx: BuildCtx = { talkDir: "/", macros: { "\\R": "\\mathbb{R}" }, asset: (p) => `assets/${p.split("/").pop()}`, report: (s, m, l) => reports.push(`${l ?? "-"}: ${s}: ${m}`), reportIn: (f, s, m, l) => reports.push(`${f}:${l ?? "-"}: ${s}: ${m}`),
    // a two-entry bibliography
    cite: (items) => {
      const known: Record<string, string> = { knuth1984: "Knuth, 1984", moura2021: "de Moura & Ullrich, 2021" };
      const bad = items.find((i) => !(i.id in known));
      if (bad) return { error: `unknown citation key "${bad.id}"` };
      return { text: `(${items.map((i) => known[i.id] + (i.locator ? `, p. ${i.locator}` : "")).join("; ")})`, title: "full <ref>" };
    },
    references: () => "",
    // stands in for LaTeX: echoes the picture, or fails on \\fail at its line
    tikz: async (b) => {
      const bad = b.split("\n").findIndex((l) => l.includes("\\fail"));
      return bad >= 0 ? { error: "LaTeX: boom", line: bad + 1 } : { svg: `<svg class="ws-tikz">${b}</svg>`, width: 10, height: 5 };
    },
  };
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

describe("tikz fences", () => {
  it("renders ```tikzcd and ```tikz as inline figures, wrapping the environment when missing", async () => {
    const r = await build("# T\n\n```tikzcd\nA \\arrow[r] & B\n```\n\n```tikz\n\\draw (0,0) -- (1,1);\n```\n");
    expect(r.html).toContain('<figure class="ws-tikz-figure"><svg class="ws-tikz">\\begin{tikzcd}\nA \\arrow[r] & B\n\\end{tikzcd}</svg></figure>');
    expect(r.html).toContain("\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}");
    expect(r.reports).toEqual([]); // not an "unknown code language"
  });

  it("keeps a picture that has its own environment as is", async () => {
    const r = await build("```tikz\n\\begin{tikzpicture}[scale=2]\n\\end{tikzpicture}\n```\n");
    expect(r.html).toContain("<svg class=\"ws-tikz\">\\begin{tikzpicture}[scale=2]\n\\end{tikzpicture}\n</svg>");
  });

  it("reports LaTeX errors at their line in the node file", async () => {
    // body starts at file line 3; the fence opens on body line 3 (file line 5); \fail is its 2nd line
    const r = await build("# T\n\n```tikz\n\\draw (0,0);\n\\fail\n```\n");
    expect(r.reports).toEqual(["7: error: tikz: LaTeX: boom"]);
    expect(r.html).toContain('<pre class="math-error">');
  });
});

describe("citations", () => {
  it("renders [@key] groups as author–year citations with the full reference as a tooltip", async () => {
    const r = await build("As shown [@knuth1984, p. 3], and [@knuth1984; @moura2021].");
    expect(r.html).toContain('<span class="ws-cite" data-keys="knuth1984" title="full &lt;ref&gt;">(Knuth, 1984, p. 3)</span>');
    expect(r.html).toContain('data-keys="knuth1984 moura2021"');
    expect(r.html).toContain("(Knuth, 1984; de Moura &amp; Ullrich, 2021)");
    expect(r.reports).toEqual([]);
  });

  it("leaves links and other brackets alone", async () => {
    const r = await build("[a link](https://x.org), [not @a citation], email@example.org");
    expect(r.html).toContain('<a href="https://x.org">a link</a>');
    expect(r.html).toContain("[not @a citation]");
    expect(r.html).not.toContain("ws-cite");
  });

  it("reports unknown keys at their line", async () => {
    const r = await build("# T\n\nSee [@nope].");
    expect(r.reports).toEqual(['5: error: unknown citation key "nope"']);
    expect(r.html).toContain('<span class="ws-cite ws-cite-error">[@nope]</span>');
  });
});
