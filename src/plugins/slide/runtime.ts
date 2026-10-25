import type { RuntimePlugin } from "../types.ts";
import type { SlideData } from "./build.ts";
import { setupMorph } from "./morph.ts";

export const slide: RuntimePlugin = {
  type: "slide",
  mount(el, node) {
    const { html, summaryStep } = node.data as SlideData;
    el.classList.add("ws-slide");
    el.innerHTML = html;
    const fragments = [...el.querySelectorAll<HTMLElement>("[data-step]:not(.ws-morph-step)")].map((f) => ({ el: f, step: Number(f.dataset.step) }));
    const marks = [...el.querySelectorAll<HTMLElement>("[data-mark-step]")].map((m) => ({ el: m, step: Number(m.dataset.markStep) }));
    const morphs = [...el.querySelectorAll<HTMLElement>(".ws-morph")].map(setupMorph);
    return {
      setStep(step, { animate }) {
        el.classList.toggle("ws-no-anim", !animate);
        for (const f of fragments) {
          f.el.classList.toggle("visible", f.step <= step);
          f.el.classList.toggle("current-fragment", f.step === step);
        }
        for (const m of marks) m.el.classList.toggle("current-mark", m.step === step);
        // walkthrough: items before the current one are dimmed, until the summary step shows them all again
        el.classList.toggle("ws-walking", summaryStep !== undefined && step < summaryStep);
        for (const m of morphs) m.setStep(step, animate);
      },
    };
  },
};
