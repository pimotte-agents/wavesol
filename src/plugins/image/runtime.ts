import type { RuntimePlugin } from "../types.ts";
import type { ImageData } from "./build.ts";

export const image: RuntimePlugin = {
  type: "image",
  mount(el, node) {
    const data = node.data as ImageData;
    el.classList.add("ws-image");
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    img.src = data.src;
    img.alt = node.title;
    img.style.objectFit = data.fit;
    figure.append(img);
    if (data.caption) {
      const caption = document.createElement("figcaption");
      caption.innerHTML = data.caption;
      figure.append(caption);
    }
    el.append(figure);
    return { setStep() {} };
  },
};
