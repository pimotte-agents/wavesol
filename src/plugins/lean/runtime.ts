// Lean nodes in the browser: highlighted code with hovers, and an infoview with the goals before and
// after a tactic. Steps walk through the tactics (or named proof states); clicking a tactic shows its
// goals until the next step.
import type { RuntimePlugin } from "../types.ts";
import type { LeanData } from "./build.ts";
import { pointTarget } from "./steps.ts";
import type { CodeNode, Goal } from "./subverso.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderCode(nodes: CodeNode[], into: HTMLElement) {
  for (const n of nodes) {
    if (typeof n === "string") into.append(n);
    else if ("tac" in n) {
      const span = el("span", "ws-tac");
      span.dataset.tac = String(n.tac);
      renderCode(n.c, span);
      into.append(span);
    } else {
      const span = el("span", `lk-${n.k}`, n.t);
      if (n.h !== undefined) span.dataset.h = String(n.h);
      into.append(span);
    }
  }
}

function renderGoals(goals: Goal[]): HTMLElement {
  const box = el("div", "ws-goals");
  if (!goals.length) box.append(el("div", "ws-goal-done", "No goals"));
  for (const g of goals) {
    const goal = el("div", "ws-goal");
    if (g.name) goal.append(el("div", "ws-goal-case", `case ${g.name}`));
    for (const h of g.hyps) {
      const hyp = el("div", "ws-hyp");
      hyp.append(el("span", "ws-hyp-names", h.names.join(" ")), " : ");
      renderCode(h.type, hyp);
      goal.append(hyp);
    }
    const concl = el("div", "ws-concl");
    concl.append(el("span", "ws-turnstile", g.prefix.trim()), " ");
    renderCode(g.concl, concl);
    goal.append(concl);
    box.append(goal);
  }
  return box;
}

/**
 * Shrinks an element's font until its content fits (long Lean lines, big goals), down to `min` px.
 * Runs again whenever the element changes size, e.g. when a far-away node is first shown.
 */
function fitText(e: HTMLElement, base: number, min: number): () => void {
  const fit = () => {
    if (!e.clientWidth || !e.clientHeight) return;
    let size = base;
    e.style.fontSize = `${size}px`;
    while (size > min && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) {
      size = Math.max(min, Math.floor(size * Math.min(1, 0.97 * Math.min(e.clientWidth / e.scrollWidth, Math.sqrt(e.clientHeight / e.scrollHeight)))));
      e.style.fontSize = `${size}px`;
    }
  };
  new ResizeObserver(fit).observe(e);
  return fit;
}

export const lean: RuntimePlugin = {
  type: "lean",
  mount(root, node) {
    const data = node.data as LeanData;
    root.classList.add("ws-lean", `ws-lean-${data.infoview}`);
    const main = el("div", "ws-lean-main");
    if (data.caption) {
      const caption = el("div", "ws-lean-caption ws-slide");
      caption.innerHTML = data.caption;
      main.append(caption);
    }
    const pre = el("pre", "ws-lean-code");
    renderCode(data.code, pre);
    main.append(pre);
    const info = el("aside", "ws-lean-info");
    const hover = el("div", "ws-lean-hover");
    hover.hidden = true;
    root.append(main, info, hover);

    const fitCode = fitText(pre, 26, 14);
    const fitInfo = fitText(info, 22, 13);

    const spans = new Map([...pre.querySelectorAll<HTMLElement>(".ws-tac")].map((s) => [Number(s.dataset.tac), s]));
    const start = data.tactics.find((t) => t.kind === "by");

    /** Shows tactic `i` in the infoview (undefined: the starting state). */
    const show = (i: number | undefined, label?: string) => {
      for (const [n, s] of spans) s.classList.toggle("ws-tac-current", n === i);
      info.replaceChildren();
      const t = i === undefined ? undefined : data.tactics[i];
      const head = el("div", "ws-info-head");
      if (!t) head.textContent = label ?? "Start";
      else {
        head.append(el("code", undefined, t.text.replace(/,$/, "")));
        if (label) head.append(el("span", "ws-info-label", ` ${label}`));
      }
      info.append(head);
      if (!t) {
        info.append(start ? renderGoals(start.after) : el("div", "ws-muted", "Click a tactic to see its goals."));
        return fitInfo();
      }
      if (t.before) {
        info.append(el("div", "ws-info-sub", "Before"), renderGoals(t.before), el("div", "ws-info-sub", "After"));
      }
      info.append(renderGoals(t.after));
      fitInfo();
    };

    root.addEventListener("click", (e) => {
      const tac = (e.target as HTMLElement).closest<HTMLElement>(".ws-tac");
      if (!tac || !pre.contains(tac)) return;
      e.stopPropagation();
      show(Number(tac.dataset.tac));
    });

    // hovers: placed in the node's own (unscaled) coordinates, so they scale with it
    root.addEventListener("mouseover", (e) => {
      const tok = (e.target as HTMLElement).closest<HTMLElement>("[data-h]");
      if (!tok || !root.contains(tok)) return void (hover.hidden = true);
      const h = data.hovers[Number(tok.dataset.h)];
      if (!h) return;
      hover.replaceChildren();
      if (h.sig) hover.append(el("code", "ws-hover-sig", h.sig));
      if (h.doc) {
        const doc = el("div", "ws-hover-doc");
        doc.innerHTML = h.doc;
        hover.append(doc);
      }
      const r = root.getBoundingClientRect();
      const t = tok.getBoundingClientRect();
      const scale = r.width / root.offsetWidth || 1;
      hover.hidden = false;
      const x = Math.min((t.left - r.left) / scale, root.offsetWidth - hover.offsetWidth - 16);
      const below = (t.bottom - r.top) / scale + 8;
      const y = below + hover.offsetHeight > root.offsetHeight ? (t.top - r.top) / scale - hover.offsetHeight - 8 : below;
      hover.style.transform = `translate(${Math.max(16, x)}px, ${Math.max(16, y)}px)`;
    });
    root.addEventListener("mouseleave", () => (hover.hidden = true));

    show(undefined);
    fitCode();
    let step = 0;
    const showStep = () => {
      if (step === 0) return show(undefined);
      const i = data.steps[step - 1];
      if (i !== undefined) show(i, data.stepNames?.[step - 1]);
    };
    return {
      setStep(s) {
        hover.hidden = true;
        step = s;
        showStep();
      },
      pointAt(target) {
        // the laser moves through the proof only where steps are its tactics
        if (data.stepMode !== "tactics") return undefined;
        const tac = target.closest<HTMLElement>(".ws-tac");
        if (!tac || !pre.contains(tac)) return undefined;
        return pointTarget(data.steps, Number(tac.dataset.tac));
      },
      setFocus(focus) {
        if (focus === undefined) showStep();
        else show(focus);
      },
    };
  },
};
