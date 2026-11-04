// Reflow: when a `collapse` fragment appears or disappears, the slide's layout changes (a table column comes
// in, the other columns get narrower and their text wraps). The text then moves to its new place word by
// word, with the magic move of ../move.ts: each word and each atomic part (formula, code block, image)
// glides from where it was. Table lines (the cells' borders) and the backgrounds of inline code are redrawn
// over the slide and stretch from their old place to their new one. The new layout shows at once under a copy of the old one that fades
// out, so what doesn't change stays put; what appears fades in as the words arrive.
import { fadeIn, fadeOut, frameOf, glide, measure, MOVE_MS, oldPart, reducedMotion, type Box, type Frame, type OldPart } from "../move.ts";

const EASE = "cubic-bezier(0.45, 0, 0.2, 1)";
const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

/** A cell's borders, drawn on their own over the slide at `box`. */
function borders(box: Box, style: Record<string, string>): HTMLElement {
  const b = document.createElement("div");
  b.className = "ws-reflow-borders";
  Object.assign(b.style, style, place(box));
  return b;
}

const place = (b: Box) => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });

/** A cell on screen: its box and its borders' style. */
interface Cell {
  box: Box;
  style: Record<string, string>;
}

/** The cells on screen, measured now. */
function cells(all: HTMLElement[], frame: Frame): Map<HTMLElement, Cell> {
  const out = new Map<HTMLElement, Cell>();
  for (const el of all) {
    if (!shown(el)) continue;
    const computed = getComputedStyle(el);
    const style: Record<string, string> = {};
    for (const side of SIDES) for (const k of ["Width", "Style", "Color"]) style[`border${side}${k}`] = computed.getPropertyValue(`border-${side.toLowerCase()}-${k.toLowerCase()}`);
    out.set(el, { box: measure(el, frame), style });
  }
  return out;
}

const union = (bs: Box[]): Box => {
  const [x, y] = [Math.min(...bs.map((b) => b.x)), Math.min(...bs.map((b) => b.y))];
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};

/**
 * The background of inline code, for words that move: one piece per run of words that are on the same line
 * before and after (a piece per line, split where the lines break differently), from where the words were to
 * where they go, padded as the code is.
 */
function codeBackgrounds(code: HTMLElement, words: HTMLElement[], before: Map<HTMLElement, OldPart>, frame: Frame) {
  const style = getComputedStyle(code);
  const px = (k: string) => parseFloat(style.getPropertyValue(k)) || 0;
  const all = code.querySelectorAll(".ws-word");
  const [first, last] = [all[0], all[all.length - 1]];
  // as the code's own background: padded above and below, and left and right only at its start and end
  // (a line break cuts it off square)
  const pad = (b: Box, start: boolean, end: boolean): Box => {
    const [l, r] = [start ? px("padding-left") : 0, end ? px("padding-right") : 0];
    return { x: b.x - l, y: b.y - px("padding-top"), w: b.w + l + r, h: b.h + px("padding-top") + px("padding-bottom") };
  };
  const runs: { words: HTMLElement[]; from: Box[]; to: Box[] }[] = [];
  for (const w of words) {
    const [a, b] = [before.get(w)!.box, measure(w, frame)];
    const run = runs.at(-1);
    const sameLine = (x: Box, y: Box) => Math.abs(x.y - y.y) < x.h / 2;
    if (run && sameLine(run.from.at(-1)!, a) && sameLine(run.to.at(-1)!, b)) {
      run.words.push(w);
      run.from.push(a);
      run.to.push(b);
    } else runs.push({ words: [w], from: [a], to: [b] });
  }
  const pieces = runs.map((r) => {
    const [start, end] = [r.words[0] === first, r.words.at(-1) === last];
    const bg = document.createElement("div");
    bg.className = "ws-reflow-bg";
    bg.style.backgroundColor = style.backgroundColor;
    const radius = (corner: string, on: boolean) => (on ? style.getPropertyValue(`border-${corner}-radius`) : "0");
    bg.style.borderRadius = [radius("top-left", start), radius("top-right", end), radius("bottom-right", end), radius("bottom-left", start)].join(" ");
    return { el: bg, from: pad(union(r.from), start, end), to: pad(union(r.to), start, end) };
  });
  // runs next to each other on a line join up across the space between them
  for (const [p, q] of pieces.slice(1).map((q, i) => [pieces[i]!, q] as const)) {
    for (const k of ["from", "to"] as const) {
      if (Math.abs(p[k].y - q[k].y) < p[k].h / 2 && q[k].x > p[k].x + p[k].w) p[k].w = q[k].x - p[k].x;
    }
  }
  return pieces;
}

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
  const tableCells = [...slide.querySelectorAll<HTMLElement>("th, td")];
  const cellIndex = new Map(tableCells.map((el, i) => [el, i]));
  const codes = [...slide.querySelectorAll<HTMLElement>("code")].filter((c) => !c.closest(ATOMIC));
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
      const cellsBefore = cells(tableCells, frame);
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

      // table lines: each cell's borders stretch from its old box to its new one (so lines stay joined);
      // a cell that comes or goes has its borders fade in or out. Meanwhile the cells draw none themselves.
      const cellsAfter = cells(tableCells, frame);
      const oldCells = [...old.querySelectorAll<HTMLElement>("th, td")];
      const bare: HTMLElement[] = [];
      for (const el of new Set([...cellsBefore.keys(), ...cellsAfter.keys()])) {
        const [a, b] = [cellsBefore.get(el), cellsAfter.get(el)];
        const lines = borders((b ?? a)!.box, (b ?? a)!.style);
        layer.prepend(lines);
        if (a && b) running.push(lines.animate([place(a.box), place(b.box)], { duration: MOVE_MS, easing: EASE }));
        else running.push(b ? fadeIn(lines) : fadeOut(lines));
        el.style.borderColor = "transparent";
        oldCells[cellIndex.get(el)!]!.style.borderColor = "transparent";
        bare.push(el);
      }
      // inline code: its background moves with its words, in pieces that join up again where they arrive
      const oldCodes = [...old.querySelectorAll<HTMLElement>("code")].filter((c) => !c.closest(ATOMIC));
      codes.forEach((code, i) => {
        const words = moving.filter((w) => code.contains(w));
        if (!words.length) return;
        for (const bg of codeBackgrounds(code, words, before, frame)) {
          layer.prepend(bg.el);
          running.push(bg.el.animate([place(bg.from), place(bg.to)], { duration: MOVE_MS, easing: EASE, fill: "both" }));
        }
        code.style.backgroundColor = "transparent";
        oldCodes[i]!.style.backgroundColor = "transparent";
        bare.push(code);
      });

      running.push(...glide(layer, frame, moving.map((el) => [before.get(el)!, el]), "ws-morph-copy"));

      const anims = running;
      cleanup = () => {
        old.remove();
        layer.remove();
        slide.classList.remove("ws-reflowing");
        for (const el of moving) el.style.visibility = "";
        for (const el of bare) {
          el.style.borderColor = "";
          el.style.backgroundColor = "";
        }
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
