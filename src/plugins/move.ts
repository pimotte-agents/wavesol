// "Magic move", shared by morph blocks (equations) and Lean goals: parts that are in both the old and
// the new content glide from their old place to their new one, while the rest crossfades. The moving
// parts are copies in a layer above the content, so they stay opaque while the rest fades; at the end
// the copies go and the new content is complete.

export const MOVE_MS = 600;
export const FADE_MS = 300;
const EASE = "cubic-bezier(0.45, 0, 0.2, 1)";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A part of the old content, measured before it was replaced. */
export interface OldPart {
  el: HTMLElement;
  box: Box;
  size: number;
}

/** Where the boxes are measured from: an element's rectangle and its scale on screen. */
export interface Frame {
  origin: DOMRect;
  scale: number;
}

export function frameOf(el: HTMLElement): Frame {
  const origin = el.getBoundingClientRect();
  return { origin, scale: origin.width / el.offsetWidth || 1 };
}

/** A box relative to the frame, in its own (unscaled) units. */
export function measure(el: HTMLElement, { origin, scale }: Frame): Box {
  const r = el.getBoundingClientRect();
  return { x: (r.left - origin.left) / scale, y: (r.top - origin.top) / scale, w: r.width / scale, h: r.height / scale };
}

export const fontSize = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize) || 1;

export function oldPart(el: HTMLElement, frame: Frame): OldPart {
  return { el, box: measure(el, frame), size: fontSize(el) };
}

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Fades the old content out and the new in, timed so the moving parts arrive as the new appears. */
export function crossfade(from: HTMLElement, to: HTMLElement): Animation[] {
  return [
    from.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: "ease-out", fill: "forwards" }),
    to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, delay: MOVE_MS - FADE_MS, easing: "ease-in", fill: "backwards" }),
  ];
}

/**
 * Glides each new part from where its old part was. The new parts are hidden while copies of them
 * move in `layer` (positioned over the frame's element); `wrapClass` gives the copies the parts'
 * context (e.g. KaTeX's styles). A part whose text changed crossfades on the way.
 */
export function glide(layer: HTMLElement, frame: Frame, moving: [OldPart, HTMLElement][], wrapClass: string): Animation[] {
  const running: Animation[] = [];
  for (const [old, el] of moving) {
    const a = old.box;
    const b = measure(el, frame);
    // the copy keeps the part's look: same element and font size, placed at its new box
    const copy = el.cloneNode(true) as HTMLElement;
    const wrap = document.createElement("span");
    wrap.className = wrapClass;
    wrap.style.fontSize = getComputedStyle(el.parentElement ?? el).fontSize;
    wrap.style.left = `${b.x}px`;
    wrap.style.top = `${b.y}px`;
    wrap.append(copy);
    // content that changes (7 → 4) crossfades on the way: the old travels along, fading out
    const changed = old.el.textContent !== el.textContent;
    const oldCopy = document.createElement("span");
    if (changed) {
      oldCopy.className = "ws-morph-old";
      const oldContent = old.el.cloneNode(true) as HTMLElement;
      oldContent.style.visibility = ""; // the original is hidden while it moves on
      oldCopy.append(oldContent);
      wrap.append(oldCopy);
    }
    layer.append(wrap);
    // line height may give the copy a slightly different box: align it with the part's
    const c = measure(copy, frame);
    wrap.style.left = `${2 * b.x - c.x}px`;
    wrap.style.top = `${2 * b.y - c.y}px`;
    el.style.visibility = "hidden";
    // one scale for both axes (glyphs keep their shape): the change in font size, if any;
    // centre to centre, so a part of another width doesn't drift
    const s = old.size / fontSize(el);
    const dx = a.x + a.w / 2 - (b.x + b.w / 2);
    const dy = a.y + a.h / 2 - (b.y + b.h / 2);
    running.push(wrap.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: "none" }], { duration: MOVE_MS, easing: EASE }));
    if (changed) {
      running.push(oldCopy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOVE_MS * 0.6, easing: "ease-out", fill: "forwards" }));
      running.push(copy.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOVE_MS * 0.6, delay: MOVE_MS * 0.3, easing: "ease-in", fill: "backwards" }));
    }
  }
  return running;
}
