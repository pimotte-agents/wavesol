// Reflow: when a `collapse` fragment appears or disappears, the slide's layout changes (a table column comes
// in, the other columns get narrower and their text wraps). The text then moves to its new place word by
// word, with the magic move of ../move.ts: each word and each atomic part (formula, code block, image)
// glides from where it was. The new layout shows at once under a copy of the old one that fades out, so
// what doesn't change stays put; what appears fades in as the words arrive.
import { fadeIn, fadeOut, frameOf, glide, oldPart, reducedMotion, type OldPart } from "../move.ts";

/** Elements that move as a whole; their text is not split into words. */
const ATOMIC = ".katex, pre, img, svg, .ws-morph";

/** Wraps every word of the slide's text in a span, so that words can be measured and moved. */
function splitWords(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(ATOMIC) || !n.textContent?.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) {
    // words become spans, the spaces between them stay text: the lines still break where they did
    const parts = text.textContent!.split(/(\s+)/).filter(Boolean);
    text.replaceWith(
      ...parts.map((p) => {
        if (/^\s/.test(p)) return p;
        const w = document.createElement("span");
        w.className = "ws-word";
        w.textContent = p;
        return w;
      }),
    );
  }
}

/** The parts that move: words and atomic elements (outermost only). */
function parts(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`.ws-word, ${ATOMIC}`)].filter((el) => !el.parentElement?.closest(ATOMIC));
}

/** Whether a part is on screen: laid out, and not in a fragment that is hidden or faded out. */
const shown = (el: HTMLElement) =>
  el.getClientRects().length > 0 && !el.closest(".fragment:not(.visible):not(.fade-out):not(.highlight), .fragment.fade-out.visible");

export interface Reflow {
  /** Runs `apply` (which changes the slide to its new step); animated when `animate` and the layout changes. */
  step(apply: () => void, layoutChanges: boolean, animate: boolean): void;
}

export function setupReflow(slide: HTMLElement): Reflow {
  splitWords(slide);
  const all = parts(slide);
  const index = new Map(all.map((el, i) => [el, i]));
  let running: Animation[] = [];
  let cleanup = () => {};

  return {
    step(apply, layoutChanges, animate) {
      for (const a of running) a.cancel();
      running = [];
      cleanup();
      if (!animate || !layoutChanges || reducedMotion() || !slide.offsetWidth) return apply();

      slide.classList.add("ws-reflowing"); // positioned: the layers below go over it
      const collapses = [...slide.querySelectorAll<HTMLElement>(".fragment.collapse")];
      const wasLaidOut = new Set(collapses.filter((el) => el.getClientRects().length > 0));
      const frame = frameOf(slide);
      const before = new Map<HTMLElement, OldPart>();
      for (const el of all) if (shown(el)) before.set(el, oldPart(el, frame));
      // the old layout, as a copy over the slide that fades out
      const old = document.createElement("div");
      old.className = "ws-reflow-old";
      old.append(...[...slide.childNodes].map((n) => n.cloneNode(true)));
      apply();
      const moving = all.filter((el) => before.has(el) && shown(el));
      const oldParts = parts(old);
      for (const el of moving) oldParts[index.get(el)!]!.style.visibility = "hidden";

      const appeared = collapses.filter((el) => !wasLaidOut.has(el) && el.getClientRects().length > 0);
      const layer = document.createElement("div");
      layer.className = "ws-morph-layer";
      slide.append(old, layer);
      running.push(fadeOut(old), ...appeared.map(fadeIn));
      running.push(...glide(layer, frame, moving.map((el) => [before.get(el)!, el]), "ws-morph-copy"));

      const anims = running;
      cleanup = () => {
        old.remove();
        layer.remove();
        slide.classList.remove("ws-reflowing");
        for (const el of moving) el.style.visibility = "";
        for (const a of anims) a.cancel();
        cleanup = () => {};
      };
      void Promise.all(anims.map((a) => a.finished)).then(
        () => cleanup(),
        () => {}, // cancelled by the next step, which cleans up first
      );
    },
  };
}
