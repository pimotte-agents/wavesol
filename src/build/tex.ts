// TikZ (and tikz-cd) → SVG at build time: pdflatex on a standalone document, then pdftocairo -svg.
// Results are cached by the document's hash in <talk>/.wavesol/cache/tikz. The SVG is made fit for
// inlining: black becomes currentColor (so figures follow the theme's ink, light or dark), ids get a
// per-figure prefix (glyph ids would otherwise clash between figures on one page), and the size is
// given in em with 10pt = 1em, so TikZ text matches the surrounding text.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TikzOptions {
  /** Extra LaTeX packages (tikz-cd is added for `tikzcd` pictures). */
  packages?: string[];
  /** TikZ libraries (\usetikzlibrary). */
  libraries?: string[];
  /** Raw preamble lines, e.g. \definecolor. */
  preamble?: string;
  /** The talk's macros (name → expansion), as \providecommand. */
  macros?: Record<string, string>;
}

export type TikzResult = { svg: string; width: number; height: number } | { error: string; line?: number };

/** Bump when the post-processing changes, so cached SVGs are regenerated. */
const PIPELINE = "pdflatex+pdftocairo/v1";

function run(cmd: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<{ code: number | null; output: string; missing?: boolean }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(cmd, args, { cwd });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: null, output: e.message, missing: e.code === "ENOENT" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/** \newcommand-style definitions for the talk's macros (#n parameters counted from the body). */
function macroDefs(macros: Record<string, string>): string {
  return Object.entries(macros)
    .map(([name, body]) => {
      const n = Math.max(0, ...[...body.matchAll(/#(\d)/g)].map((m) => Number(m[1])));
      return `\\providecommand{${name}}${n ? `[${n}]` : ""}{${body}}`;
    })
    .join("\n");
}

/** The standalone document, and the line on which the picture starts (for error positions). */
export function tikzDocument(body: string, opts: TikzOptions = {}): { tex: string; bodyLine: number } {
  const packages = new Set(["amsmath", "amssymb", ...(opts.packages ?? [])]);
  if (/\\begin\{tikzcd\}/.test(body)) packages.add("tikz-cd");
  const head = [
    "\\documentclass[tikz,border=2pt]{standalone}",
    ...[...packages].map((p) => `\\usepackage{${p}}`),
    ...(opts.libraries?.length ? [`\\usetikzlibrary{${opts.libraries.join(",")}}`] : []),
    ...(opts.macros && Object.keys(opts.macros).length ? [macroDefs(opts.macros)] : []),
    ...(opts.preamble ? [opts.preamble.trim()] : []),
    "\\begin{document}",
  ].join("\n");
  return { tex: `${head}\n${body.trim()}\n\\end{document}\n`, bodyLine: head.split("\n").length + 1 };
}

/** Prepares pdftocairo's SVG for inlining (see the file comment). */
export function inlineSvg(svg: string, prefix: string): { svg: string; width: number; height: number } {
  const m = /<svg[^>]*\swidth="([\d.]+)pt"[^>]*\sheight="([\d.]+)pt"/.exec(svg);
  const width = m ? Number(m[1]) : 0;
  const height = m ? Number(m[2]) : 0;
  const out = svg
    .replace(/<\?xml[^>]*\?>\s*/, "")
    .replace(/rgb\(0%,\s*0%,\s*0%\)/g, "currentColor")
    .replace(/\bid="([^"]+)"/g, `id="${prefix}$1"`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(/(<svg[^>]*?)\swidth="[\d.]+pt"\s+height="[\d.]+pt"/, `$1 width="${(width / 10).toFixed(3)}em" height="${(height / 10).toFixed(3)}em"`)
    .replace("<svg ", '<svg class="ws-tikz" role="img" ')
    .trim();
  return { svg: out, width, height };
}

/** First LaTeX error in a log: message and line in the document. */
export function latexError(log: string): { message: string; line?: number } {
  const m = /^! (.+)$/m.exec(log);
  if (!m) return { message: log.trim().split("\n").slice(-5).join("\n") || "LaTeX failed" };
  const rest = log.slice(m.index);
  const l = /^l\.(\d+)/m.exec(rest);
  return { message: m[1]!.replace(/\.$/, ""), line: l ? Number(l[1]) : undefined };
}

export async function renderTikz(body: string, opts: TikzOptions, cacheDir: string): Promise<TikzResult> {
  const { tex, bodyLine } = tikzDocument(body, opts);
  const hash = createHash("sha256").update(PIPELINE).update(tex).digest("hex").slice(0, 16);
  const cached = join(cacheDir, `${hash}.svg`);
  if (existsSync(cached)) {
    const svg = readFileSync(cached, "utf8");
    const m = /data-size="([\d.]+) ([\d.]+)"/.exec(svg);
    return { svg, width: Number(m?.[1] ?? 0), height: Number(m?.[2] ?? 0) };
  }

  const work = mkdtempSync(join(tmpdir(), "wavesol-tikz-"));
  try {
    writeFileSync(join(work, "fig.tex"), tex);
    const latex = await run("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "fig.tex"], work);
    if (latex.missing) return { error: "TikZ needs LaTeX: install TeX Live (pdflatex, with the pgf, tikz-cd and standalone packages)" };
    if (latex.code !== 0) {
      const log = existsSync(join(work, "fig.log")) ? readFileSync(join(work, "fig.log"), "utf8") : latex.output;
      const e = latexError(log);
      const line = e.line !== undefined && e.line >= bodyLine ? e.line - bodyLine + 1 : undefined;
      return { error: `LaTeX: ${e.message}`, line };
    }
    const conv = await run("pdftocairo", ["-svg", "fig.pdf", "fig.svg"], work);
    if (conv.missing) return { error: "TikZ needs pdftocairo (poppler-utils) to turn LaTeX's PDF into SVG" };
    if (conv.code !== 0) return { error: `pdftocairo failed: ${conv.output.trim()}` };
    const result = inlineSvg(readFileSync(join(work, "fig.svg"), "utf8"), `t${hash.slice(0, 8)}-`);
    const svg = result.svg.replace("<svg ", `<svg data-size="${result.width} ${result.height}" `);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cached, svg);
    return { ...result, svg };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
