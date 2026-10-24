import type { RuntimePlugin } from "../types.ts";
import type { SlideData } from "./build.ts";
import { setupMorph } from "./morph.ts";

export const slide: RuntimePlugin = {
  type: "slide",
  mount(el, node) {
    el.classList.add("ws-slide");
    el.innerHTML = (node.data as SlideData).html;
    const fragments = [...el.querySelectorAll<HTMLElement>("[data-step]:not(.ws-morph-step)")].map((f) => ({ el: f, step: Number(f.dataset.step) }));
    const morphs = [...el.querySelectorAll<HTMLElement>(".ws-morph")].map(setupMorph);
    return {
      setStep(step, { animate }) {
        el.classList.toggle("ws-no-anim", !animate);
        for (const f of fragments) {
          f.el.classList.toggle("visible", f.step <= step);
          f.el.classList.toggle("current-fragment", f.step === step);
        }
        for (const m of morphs) m.setStep(step, animate);
      },
    };
  },
};
