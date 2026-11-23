import { describe, expect, it } from "vitest";
import { entryTexts, estimatePages } from "./build.ts";
import { balance } from "./runtime.ts";

const entry = (chars: number) => "x".repeat(chars);

describe("references pages", () => {
  it("reads the text of each entry from the bibliography HTML", () => {
    const html = '<div class="csl-bib-body">\n  <div data-csl-entry-id="a" class="csl-entry">Knuth, D. (1984). <i>Literate</i> &amp; programming.</div>\n  <div class="csl-entry">B.</div>\n</div>';
    expect(entryTexts(html)).toEqual(["Knuth, D. (1984). Literate x programming.", "B."]);
  });

  it("a short list is one page, a long one several, a larger slide fewer", () => {
    expect(estimatePages([], [1600, 900], 36)).toBe(1);
    expect(estimatePages(Array.from({ length: 5 }, () => entry(150)), [1600, 900], 36)).toBe(1);
    const many = Array.from({ length: 21 }, () => entry(200));
    expect(estimatePages(many, [1600, 900], 36)).toBeGreaterThan(2);
    expect(estimatePages(many, [1600, 1800], 36)).toBeLessThan(estimatePages(many, [1600, 900], 36));
  });

  it("spreads entries evenly over the pages, in order", () => {
    expect(balance([1, 1, 1, 1], 2).pageOf).toEqual([0, 0, 1, 1]);
    expect(balance([1, 1, 1, 1], 2).max).toBeCloseTo(2, 0);
    const { pageOf, max } = balance([3, 1, 1, 1, 3], 2);
    expect(pageOf).toEqual([0, 0, 0, 1, 1]);
    expect(max).toBeCloseTo(5, 0);
    expect(balance([2, 2], 1).pageOf).toEqual([0, 0]);
  });
});
