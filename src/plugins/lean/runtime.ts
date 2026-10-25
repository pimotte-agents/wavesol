// Lean nodes in the browser: highlighted code with hovers, and an infoview with the goals after a
// tactic. Steps walk through the tactics (or named proof states), the goals moving from one step to the
// next; clicking a tactic shows its goals until the next step.
import { crossfade, frameOf, glide, oldPart, reducedMotion } from "../move.ts";
import type { RuntimePlugin } from "../types.ts";
import type { LeanData } from "./build.ts";
import { matchTokens } from "./match.ts";
import { pointTarget } from "./steps.ts";
import type { CodeNode, Goal } from "./subverso.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Renders code; with `atoms`, every token and every word of plain text is a span that can move. */
function renderCode(nodes: CodeNode[], into: HTMLElement, atoms = false) {
  for (const n of nodes) {
    if (typeof n === "string") {
      if (!atoms) into.append(n);
      else for (const part of n.split(/(\s+)/)) if (part) into.append(/\s/.test(part) ? part : el("span", "ws-atom", part));
    } else if ("tac" in n) {
      const span = el("span", "ws-tac");
      span.dataset.tac = String(n.tac);
      renderCode(n.c, span, atoms);
      into.append(span);
    } else {
      const span = el("span", atoms ? `lk-${n.k} ws-atom` : `lk-${n.k}`, n.t);
      if (n.h !== undefined) span.dataset.h = String(n.h);
      into.append(span);
    }
  }
}

/** The goals, with every token a `.ws-atom` (see renderCode), so they can move to the next goals. */
function renderGoals(goals: Goal[]): HTMLElement {
  const box = el("div", "ws-goals");
  if (!goals.length) box.append(el("div", "ws-goal-done ws-atom", "No goals"));
  for (const g of goals) {
    const goal = el("div", "ws-goal");
    if (g.name) goal.append(el("div", "ws-goal-case ws-atom", `case ${g.name}`));
    for (const h of g.hyps) {
      const hyp = el("div", "ws-hyp");
      const names = el("span", "ws-hyp-names");
      h.names.forEach((n, i) => names.append(...(i ? [" "] : []), el("span", "ws-atom", n)));
      hyp.append(names, " ", el("span", "ws-atom", ":"), " ");
      renderCode(h.type, hyp, true);
      goal.append(hyp);
    }
    const concl = el("div", "ws-concl");
    concl.append(el("span", "ws-turnstile ws-atom", g.prefix.trim()), " ");
    renderCode(g.concl, concl, true);
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

    let goals: HTMLElement | undefined;
    let running: Animation[] = [];

    /**
     * Shows the goals after tactic `i` in the infoview (undefined: the starting state). With `animate`,
     * the tokens the old and new goals share move to their new place, and the rest crossfades.
     */
    const show = (i: number | undefined, label?: string, animate = false) => {
      for (const [n, s] of spans) s.classList.toggle("ws-tac-current", n === i);
      for (const a of running) a.cancel();
      running = [];
      const t = i === undefined ? undefined : data.tactics[i];
      const head = el("div", "ws-info-head");
      if (!t) head.textContent = label ?? "Start";
      else {
        head.append(el("code", undefined, t.text.replace(/,$/, "")));
        if (label) head.append(el("span", "ws-info-label", ` ${label}`));
      }
      const next = t ? renderGoals(t.after) : start ? renderGoals(start.after) : el("div", "ws-muted", "Click a tactic to see its goals.");

      const from = goals;
      goals = next;
      if (!animate || reducedMotion() || !from?.isConnected || !info.offsetWidth) {
        info.replaceChildren(head, next);
        return fitInfo();
      }
      // the old goals stay where they were, at their size, while they fade out
      const frame = frameOf(info);
      const old = [...from.querySelectorAll<HTMLElement>(".ws-atom")].map((a) => oldPart(a, frame));
      const place = { left: `${from.offsetLeft}px`, top: `${from.offsetTop}px`, width: `${from.offsetWidth}px`, fontSize: getComputedStyle(from).fontSize };
      info.replaceChildren(head, next);
      fitInfo();
      Object.assign(from.style, { position: "absolute", margin: "0", ...place });
      const layer = el("div", "ws-morph-layer");
      info.append(from, layer);

      const now = [...next.querySelectorAll<HTMLElement>(".ws-atom")];
      const pairs = matchTokens(old.map((p) => p.el.textContent ?? ""), now.map((a) => a.textContent ?? ""));
      for (const [k] of pairs) old[k]!.el.style.visibility = "hidden";
      const all = [...crossfade(from, next), ...glide(layer, frame, pairs.map(([k, j]) => [old[k]!, now[j]!]), "ws-morph-copy")];
      running = all;
      const settle = () => {
        from.remove();
        layer.remove();
        for (const a of now) a.style.visibility = "";
      };
      void Promise.all(all.map((a) => a.finished)).then(
        () => {
          for (const a of all) a.cancel();
          settle();
        },
        settle, // cancelled by the next step: its replaceChildren already took the old goals away
      );
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
    const showStep = (animate = false) => {
      if (step === 0) return show(undefined, undefined, animate);
      const i = data.steps[step - 1];
      if (i !== undefined) show(i, data.stepNames?.[step - 1], animate);
    };
    return {
      setStep(s, { animate }) {
        hover.hidden = true;
        step = s;
        showStep(animate);
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
