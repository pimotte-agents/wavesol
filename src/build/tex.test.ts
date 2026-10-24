// TikZ rendering. The pure parts always run; real LaTeX runs need pdflatex and pdftocairo, and are
// skipped without them unless REQUIRE_TEX=1 (CI), where missing TeX is a failure.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inlineSvg, latexError, renderTikz, tikzDocument } from "./tex.ts";

const has = (cmd: string, arg: string) => {
  try {
    execFileSync(cmd, [arg], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const tex = has("pdflatex", "--version") && has("pdftocairo", "-v");
if (!tex && process.env.REQUIRE_TEX) throw new Error("REQUIRE_TEX is set but pdflatex/pdftocairo were not found");

describe("TikZ document and SVG", () => {
  it("builds a standalone document; tikz-cd only when used; macros as \\providecommand", () => {
    const { tex: doc, bodyLine } = tikzDocument("\\begin{tikzcd} A \\arrow[r] & B \\end{tikzcd}", {
      libraries: ["arrows.meta"],
      macros: { "\\R": "\\mathbb{R}", "\\abs": "\\left|#1\\right|" },
    });
    expect(doc).toContain("\\usepackage{tikz-cd}");
    expect(doc).toContain("\\usetikzlibrary{arrows.meta}");
    expect(doc).toContain("\\providecommand{\\R}{\\mathbb{R}}");
    expect(doc).toContain("\\providecommand{\\abs}[1]{\\left|#1\\right|}");
    expect(doc.split("\n")[bodyLine - 1]).toBe("\\begin{tikzcd} A \\arrow[r] & B \\end{tikzcd}");
    expect(tikzDocument("\\begin{tikzpicture}\\end{tikzpicture}").tex).not.toContain("tikz-cd");
  });

  it("makes the SVG inlinable: currentColor, prefixed ids, size in em", () => {
    const raw = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="62.4pt" height="20pt" viewBox="0 0 62.4 20" version="1.2">
<defs><symbol id="glyph0-1"><path style="stroke:none;" d="M0 0"/></symbol><clipPath id="clip1"><path d="M0 0"/></clipPath></defs>
<g clip-path="url(#clip1)" style="fill:rgb(0%,0%,0%);"><use xlink:href="#glyph0-1" x="1" y="2"/></g>
</svg>`;
    const { svg, width, height } = inlineSvg(raw, "t1-");
    expect([width, height]).toEqual([62.4, 20]);
    expect(svg).not.toContain("<?xml");
    expect(svg).toContain('width="6.240em" height="2.000em"');
    expect(svg).toContain('id="t1-glyph0-1"');
    expect(svg).toContain('href="#t1-glyph0-1"');
    expect(svg).toContain("url(#t1-clip1)");
    expect(svg).toContain("fill:currentColor");
    expect(svg).not.toContain("rgb(0%,0%,0%)");
  });

  it("takes the size from the viewBox, whatever width/height say (pdftocairo versions differ)", () => {
    for (const attrs of ['width="62.4" height="20"', 'height="20pt" width="62.4pt"', ""]) {
      const { svg, width, height } = inlineSvg(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs} viewBox="0 0 62.4 20"><g/></svg>`, "p-");
      expect([width, height]).toEqual([62.4, 20]);
      expect(svg).toMatch(/^<svg class="ws-tikz" role="img" width="6\.240em" height="2\.000em" xmlns/);
      expect(svg.match(/width=/g)).toHaveLength(1);
    }
  });

  it("finds the first LaTeX error and its line", () => {
    const log = "This is pdfTeX\n(./fig.tex\n! Undefined control sequence.\nl.7 \\foo\n         \n? \n";
    expect(latexError(log)).toEqual({ message: "Undefined control sequence", line: 7 });
  });
});

describe.skipIf(!tex)("TikZ with LaTeX", { timeout: 60_000 }, () => {
  let cache: string;
  beforeAll(() => void (cache = mkdtempSync(join(tmpdir(), "wavesol-tikz-cache-"))));
  afterAll(() => rmSync(cache, { recursive: true, force: true }));

  it("renders tikz-cd to SVG, and caches it", async () => {
    const body = "\\begin{tikzcd} A \\arrow[r, \"f\"] & B \\end{tikzcd}";
    const r = await renderTikz(body, {}, cache);
    if ("error" in r) throw new Error(r.error);
    expect(r.svg).toMatch(/^<svg data-size="[\d.]+ [\d.]+" class="ws-tikz"/);
    expect(r.width).toBeGreaterThan(10);
    expect(r.svg).toContain("currentColor");
    expect(readdirSync(cache)).toHaveLength(1);
    expect(await renderTikz(body, {}, cache)).toEqual(r);
  });

  it("uses the talk's macros", async () => {
    const r = await renderTikz("\\begin{tikzpicture}\\node {$\\R$};\\end{tikzpicture}", { macros: { "\\R": "\\mathbb{R}" } }, cache);
    expect("error" in r).toBe(false);
  });

  it("reports LaTeX errors at their line in the picture", async () => {
    const r = await renderTikz("\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\nosuchmacro\n\\end{tikzpicture}", {}, cache);
    expect(r).toEqual({ error: "LaTeX: Undefined control sequence", line: 3 });
  });
});
