import { describe, expect, it } from "vitest";
import { parseMacros } from "./macros.ts";

describe("parseMacros", () => {
  it("parses the supported forms", () => {
    const { macros, errors } = parseMacros(String.raw`
      \newcommand{\R}{\mathbb{R}}      % reals
      \newcommand\N{\mathbb{N}}
      \renewcommand{\abs}[1]{\left|#1\right|}
      \DeclareMathOperator{\Hom}{Hom}
      \DeclareMathOperator*{\argmax}{arg\,max}
      \providecommand{\R}{ignored}
    `);
    expect(errors).toEqual([]);
    expect(macros).toEqual({
      "\\R": "\\mathbb{R}",
      "\\N": "\\mathbb{N}",
      "\\abs": "\\left|#1\\right|",
      "\\Hom": "\\operatorname{Hom}",
      "\\argmax": "\\operatorname*{arg\\,max}",
    });
  });

  it("reports unsupported and broken definitions with line numbers", () => {
    const { errors } = parseMacros("\\newcommand{\\a}[2][x]{#1#2}\n\\newcommand{\\b}");
    expect(errors).toEqual([
      { line: 1, message: "\\a: optional arguments with defaults are not supported" },
      { line: 2, message: "\\b: missing body" },
    ]);
  });
});
