import type { RuntimePlugin } from "../types.ts";
import type { ReferencesData } from "./build.ts";

/** Smallest text scale used to make the entries fit their pages. */
const MIN_SCALE = 0.6;

/**
 * Splits `heights` into at most `pages` consecutive groups whose largest total is as small as
 * possible; returns the page of each item and that largest total.
 */
export function balance(heights: number[], pages: number): { pageOf: number[]; max: number } {
  const assign = (cap: number) => {
    const pageOf: number[] = [];
    let page = 0;
    let used = 0;
    for (const h of heights) {
      if (used > 0 && used + h > cap) {
        page++;
        used = 0;
      }
      used += h;
      pageOf.push(page);
    }
    return { pageOf, count: page + 1 };
  };
  let lo = Math.max(0, ...heights);
  let hi = heights.reduce((a, b) => a + b, 0);
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (assign(mid).count <= pages) hi = mid;
    else lo = mid;
  }
  return { pageOf: assign(hi).pageOf, max: hi };
}

/**
 * The cited works, as a slide with a heading. A long list has a page per step (the build decides how
 * many): the entries are measured and spread evenly over the pages, and their text shrinks a little
 * if they still don't fit.
 */
export const references: RuntimePlugin = {
  type: "references",
  mount(el, node) {
    const data = node.data as ReferencesData;
    const pages = Math.max(1, data.pages ?? 1);
    el.classList.add("ws-slide", "ws-references");
    const h = document.createElement("h1");
    const list = document.createElement("div");
    list.className = "ws-references-list";
    list.innerHTML = data.html;
    el.append(h, list);
    const entries = [...list.querySelectorAll<HTMLElement>(".csl-entry")];
    let pageOf = entries.map(() => 0);
    let step = 0;

    const show = () => {
      h.textContent = pages > 1 ? `${node.title} (${step + 1}/${pages})` : node.title;
      entries.forEach((e, i) => (e.style.display = pageOf[i] === step ? "" : "none"));
    };
    const layout = () => {
      if (pages === 1 || !list.clientHeight) return;
      for (const e of entries) e.style.display = "";
      let scale = 1;
      for (;;) {
        list.style.fontSize = `${scale}em`;
        // offsetHeight is in layout pixels, unaffected by the camera's transforms
        const heights = entries.map((e) => e.offsetHeight + parseFloat(getComputedStyle(e).marginBottom || "0"));
        const fit = balance(heights, pages);
        pageOf = fit.pageOf;
        if (fit.max <= list.clientHeight || scale <= MIN_SCALE) break;
        scale = Math.max(MIN_SCALE, scale * Math.max(0.9, Math.min(0.98, list.clientHeight / fit.max)));
      }
      show();
    };
    show();
    new ResizeObserver(layout).observe(list);
    void document.fonts?.ready.then(layout);

    return {
      setStep(s) {
        step = Math.min(s, pages - 1);
        show();
      },
      mark(ids) {
        let first: number | undefined;
        entries.forEach((entry, i) => {
          const on = ids.includes(entry.dataset.cslEntryId ?? "");
          entry.classList.toggle("ws-cited", on);
          if (on && first === undefined) first = pageOf[i];
        });
        return first;
      },
    };
  },
};
