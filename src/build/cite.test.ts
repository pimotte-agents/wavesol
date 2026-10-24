import { describe, expect, it } from "vitest";
import { loadBibliography, parseCitation, type Bibliography } from "./cite.ts";

const BIB = `@book{knuth1984, author = {Donald E. Knuth}, title = {The {\\TeX}book}, publisher = {Addison-Wesley}, year = {1984}}
@inproceedings{deMoura2021, author = {de Moura, Leonardo and Ullrich, Sebastian}, title = {The {Lean} 4 Theorem Prover and Programming Language}, booktitle = {CADE-28}, year = {2021}, pages = {625--635}}
@misc{many2020, author = {A, Ann and B, Bob and C, Cy}, title = {Three Authors}, year = {2020}}`;

const bib = () => loadBibliography(BIB) as Bibliography;

describe("citation syntax", () => {
  it("parses keys, locators and several works", () => {
    expect(parseCitation("@knuth1984")).toEqual([{ id: "knuth1984" }]);
    expect(parseCitation("@knuth1984, p. 3")).toEqual([{ id: "knuth1984", label: "page", locator: "3" }]);
    expect(parseCitation("@knuth1984, pp. 3–5")).toEqual([{ id: "knuth1984", label: "page", locator: "3–5" }]);
    expect(parseCitation("@knuth1984, 12")).toEqual([{ id: "knuth1984", label: "page", locator: "12" }]);
    expect(parseCitation("@knuth1984, chap. 2; @deMoura2021")).toEqual([{ id: "knuth1984", label: "chapter", locator: "2" }, { id: "deMoura2021" }]);
    expect(parseCitation("@knuth1984, see the appendix")).toEqual([{ id: "knuth1984", suffix: ", see the appendix" }]);
  });

  it("is not a citation without @ keys", () => {
    expect(parseCitation("a link")).toBeUndefined();
    expect(parseCitation("@")).toBeUndefined();
    expect(parseCitation("@a; not a key")).toBeUndefined();
  });
});

describe("bibliography", () => {
  it("formats author–year citations", () => {
    const b = bib();
    const c = (s: string) => {
      const r = b.cite(parseCitation(s)!);
      return "text" in r ? r.text : r.error;
    };
    expect(c("@knuth1984")).toBe("(Knuth, 1984)");
    expect(c("@knuth1984, p. 3")).toBe("(Knuth, 1984, p. 3)");
    expect(c("@deMoura2021")).toBe("(de Moura & Ullrich, 2021)");
    expect(c("@many2020")).toBe("(A et al., 2020)");
    expect(c("@knuth1984; @deMoura2021")).toBe("(de Moura & Ullrich, 2021; Knuth, 1984)");
  });

  it("gives the full reference as a title, with TeX in titles cleaned up", () => {
    const r = bib().cite([{ id: "knuth1984" }]);
    expect(r).toEqual({ text: "(Knuth, 1984)", title: "Knuth, D. E. (1984). The TeXbook. Addison-Wesley." });
  });

  it("reports unknown keys and records what was cited, in order", () => {
    const b = bib();
    expect(b.cite([{ id: "nope" }, { id: "knuth1984" }])).toEqual({ error: 'unknown citation key "nope"' });
    b.cite([{ id: "many2020" }]);
    b.cite([{ id: "knuth1984" }, { id: "many2020" }]);
    expect(b.cited()).toEqual(["many2020", "knuth1984"]);
  });

  it("lists references as HTML", () => {
    const html = bib().references(["knuth1984", "deMoura2021"]);
    expect(html).toContain('class="csl-entry"');
    expect(html).toContain("de Moura, L., &#38; Ullrich, S. (2021). The Lean 4 Theorem Prover and Programming Language.");
    expect(bib().references([])).toBe("");
  });
});
