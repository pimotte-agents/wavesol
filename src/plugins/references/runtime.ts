import type { RuntimePlugin } from "../types.ts";
import type { ReferencesData } from "./build.ts";

/** The cited works, as a slide with a heading. */
export const references: RuntimePlugin = {
  type: "references",
  mount(el, node) {
    el.classList.add("ws-slide", "ws-references");
    const h = document.createElement("h1");
    h.textContent = node.title;
    const list = document.createElement("div");
    list.innerHTML = (node.data as ReferencesData).html;
    el.append(h, list);
    return { setStep() {} };
  },
};
