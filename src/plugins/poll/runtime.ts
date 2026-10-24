// Poll nodes on the projector: the question, lettered options, the number of votes, and once revealed
// (step 1, or from the start with `results: live`) a bar per option. A small join QR code sits in the
// corner. Votes arrive through setLive from the audience room (see src/runtime/remote.ts).
import { renderSVG } from "uqr";
import type { RuntimePlugin } from "../types.ts";
import type { PollData } from "./build.ts";

export interface PollLive {
  results?: { counts: number[]; total: number };
  /** Join link for the QR code. */
  join?: string;
  /** Show the results whatever the step (the presenter view). */
  showResults?: boolean;
}

export const LETTERS = "ABCDEFGHI";

export const poll: RuntimePlugin = {
  type: "poll",
  mount(el, node) {
    const data = node.data as PollData;
    el.classList.add("ws-slide", "ws-poll");
    const question = document.createElement("div");
    question.className = "ws-poll-question";
    question.innerHTML = data.question;
    const list = document.createElement("ol");
    list.className = "ws-poll-options";
    const bars: { bar: HTMLElement; count: HTMLElement }[] = [];
    data.options.forEach((html, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="ws-poll-letter">${LETTERS[i]}</span><span class="ws-poll-text">${html}</span>`;
      const bar = document.createElement("span");
      bar.className = "ws-poll-bar";
      const count = document.createElement("span");
      count.className = "ws-poll-count";
      li.append(bar, count);
      list.append(li);
      bars.push({ bar, count });
    });
    const status = document.createElement("p");
    status.className = "ws-poll-status";
    const qr = document.createElement("div");
    qr.className = "ws-poll-qr";
    el.append(question, list, status, qr);

    let step = 0;
    let live: PollLive = {};
    let qrUrl: string | undefined;
    const render = () => {
      const r = live.results ?? { counts: data.options.map(() => 0), total: 0 };
      const shown = data.results === "live" || step >= 1 || !!live.showResults;
      el.classList.toggle("ws-poll-revealed", shown);
      status.textContent = `${r.total} vote${r.total === 1 ? "" : "s"}`;
      const max = Math.max(1, ...r.counts);
      bars.forEach(({ bar, count }, i) => {
        const c = r.counts[i] ?? 0;
        bar.style.width = shown ? `${(c / max) * 100}%` : "0";
        count.textContent = shown ? String(c) : "";
      });
      if (live.join !== qrUrl) {
        qrUrl = live.join;
        qr.innerHTML = qrUrl ? renderSVG(qrUrl, { border: 2 }) : "";
      }
    };
    render();
    return {
      setStep(s) {
        step = s;
        render();
      },
      setLive(value) {
        live = value as PollLive;
        render();
      },
    };
  },
};
