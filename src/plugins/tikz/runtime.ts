import type { RuntimePlugin } from "../types.ts";
import type { TikzData } from "./build.ts";

/** A TikZ picture filling the node (scaled to fit), with its caption below. */
export const tikz: RuntimePlugin = {
  type: "tikz",
  mount(el, node) {
    const data = node.data as TikzData;
    el.classList.add("ws-tikz-node");
    const figure = document.createElement("figure");
    const picture = document.createElement("div");
    picture.className = "ws-tikz-picture";
    picture.innerHTML = data.svg;
    figure.append(picture);
    if (data.caption) {
      const caption = document.createElement("figcaption");
      caption.innerHTML = data.caption;
      figure.append(caption);
    }
    el.append(figure);
    return { setStep() {} };
  },
};
