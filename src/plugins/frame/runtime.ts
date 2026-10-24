import type { RuntimePlugin } from "../types.ts";

/** Frames only draw their chrome; children are separate nodes placed inside by the layout. */
export const frame: RuntimePlugin = {
  type: "frame",
  mount(el, node) {
    el.classList.add("ws-frame");
    const title = document.createElement("h2");
    title.className = "ws-frame-title";
    title.textContent = node.title;
    el.append(title);
    return { setStep() {} };
  },
};
