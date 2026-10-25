// Morph blocks (`::: morph` of display equations): one equation shows at a time, and between steps
// the parts tagged with the same \mm{name}{…} glide from their old place to their new one ("magic
// move", see ../move.ts); untagged content crossfades.
import { crossfade, frameOf, glide, oldPart, reducedMotion } from "../move.ts";

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

  return {
    setStep(step, animate) {
      const target = forStep(step);
      if (target === shown) return;
      for (const a of running) a.cancel();
      running = [];
      const from = shown;
      if (!animate || reducedMotion() || !from || !target || !block.offsetWidth) return show(target);

      const frame = frameOf(block);
      const before = new Map([...tagged(from)].map(([k, el]) => [k, oldPart(el, frame)]));
      show(target);
      const after = tagged(target);
      const moving = [...after].filter(([k]) => before.has(k));

      // the old equation stays for the fade, without the parts that move on
      from.classList.add("ws-morph-shown");
      const fromParts = tagged(from);
      for (const [k] of moving) fromParts.get(k)!.style.visibility = "hidden";
      running.push(...crossfade(from, target));
      running.push(...glide(layer, frame, moving.map(([k, el]) => [before.get(k)!, el]), "katex ws-morph-copy"));

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
