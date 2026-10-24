// Morph blocks (`::: morph` of display equations): one equation shows at a time, and between steps
// the parts tagged with the same \mm{name}{…} glide from their old place to their new one ("magic
// move"); untagged content crossfades. The moving parts are copies in a layer above the equations, so
// they stay opaque while the rest fades; at the end the copies go and the new equation is complete.

const MOVE_MS = 600;
const FADE_MS = 300;
const EASE = "cubic-bezier(0.45, 0, 0.2, 1)";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Morph {
  /** Shows the equation for `step`; animated when `animate` (and motion is allowed). */
  setStep(step: number, animate: boolean): void;
}

/** Tagged parts of an equation by name (a repeated name counts up: s, s#2, …), outermost only. */
function tagged(eq: HTMLElement): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const el of eq.querySelectorAll<HTMLElement>("[data-morph]")) {
    if (el.parentElement?.closest("[data-morph]") && eq.contains(el.parentElement.closest("[data-morph]"))) continue;
    let key = el.dataset.morph!;
    for (let i = 2; out.has(key); i++) key = `${el.dataset.morph}#${i}`;
    out.set(key, el);
  }
  return out;
}

export function setupMorph(block: HTMLElement): Morph {
  const steps = [...block.querySelectorAll<HTMLElement>(":scope > .ws-morph-step")].map((el) => ({ el, step: Number(el.dataset.step) }));
  const layer = document.createElement("div");
  layer.className = "ws-morph-layer";
  block.append(layer);
  let shown: HTMLElement | undefined;
  let running: Animation[] = [];

  /** The equation for a step: the last one whose step has come (none before the first). */
  const forStep = (step: number) => steps.filter((s) => s.step <= step).at(-1)?.el;

  const show = (el: HTMLElement | undefined) => {
    for (const s of steps) {
      s.el.classList.toggle("ws-morph-shown", s.el === el);
      s.el.style.opacity = "";
      for (const part of s.el.querySelectorAll<HTMLElement>("[data-morph]")) part.style.visibility = "";
    }
    layer.replaceChildren();
    shown = el;
  };

  /** A box relative to the block, in the block's own (unscaled) units. */
  const measure = (el: HTMLElement, origin: DOMRect, scale: number): Box => {
    const r = el.getBoundingClientRect();
    return { x: (r.left - origin.left) / scale, y: (r.top - origin.top) / scale, w: r.width / scale, h: r.height / scale };
  };

  return {
    setStep(step, animate) {
      const target = forStep(step);
      if (target === shown) return;
      for (const a of running) a.cancel();
      running = [];
      const from = shown;
      const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!animate || reduced || !from || !target || !block.offsetWidth) return show(target);

      const origin = block.getBoundingClientRect();
      const scale = origin.width / block.offsetWidth || 1;
      const before = new Map([...tagged(from)].map(([k, el]) => [k, measure(el, origin, scale)]));
      show(target);
      const after = tagged(target);
      const moving = [...after].filter(([k]) => before.has(k));

      // the old equation stays for the fade, without the parts that move on
      from.classList.add("ws-morph-shown");
      const fromParts = tagged(from);
      for (const [k] of moving) fromParts.get(k)!.style.visibility = "hidden";
      running.push(from.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: "ease-out", fill: "forwards" }));
      running.push(target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, delay: MOVE_MS - FADE_MS, easing: "ease-in", fill: "backwards" }));

      for (const [k, el] of moving) {
        const a = before.get(k)!;
        const b = measure(el, origin, scale);
        // the copy keeps the part's look: same element and font size, placed at its new box
        const copy = el.cloneNode(true) as HTMLElement;
        const wrap = document.createElement("span");
        wrap.className = "katex ws-morph-copy";
        wrap.style.fontSize = getComputedStyle(el.parentElement ?? el).fontSize;
        wrap.style.left = `${b.x}px`;
        wrap.style.top = `${b.y}px`;
        wrap.append(copy);
        layer.append(wrap);
        // line height may give the copy a slightly different box: align it with the part's
        const c = measure(copy, origin, scale);
        wrap.style.left = `${2 * b.x - c.x}px`;
        wrap.style.top = `${2 * b.y - c.y}px`;
        el.style.visibility = "hidden";
        const sx = c.w ? a.w / c.w : 1;
        const sy = c.h ? a.h / c.h : 1;
        const anim = wrap.animate(
          [{ transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${sx}, ${sy})` }, { transform: "none" }],
          { duration: MOVE_MS, easing: EASE },
        );
        running.push(anim);
      }

      const all = running;
      void Promise.all(all.map((a) => a.finished)).then(
        () => {
          // the fades' end states must not outlive the move (an equation may be shown again later)
          for (const a of all) a.cancel();
          if (shown === target) show(target);
        },
        () => {}, // cancelled by the next step
      );
    },
  };
}
