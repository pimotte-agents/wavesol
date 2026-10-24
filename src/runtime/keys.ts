// Keyboard bindings for the projector window. Clickers send PageDown/PageUp (and sometimes arrows).
import type { Presentation } from "./presentation.ts";

export type Panel = "edges" | "help";

export const KEY_HELP: [string, string][] = [
  ["Space / → / PageDown", "next step, then the default edge"],
  ["← / PageUp", "previous step, then back"],
  ["1 – 9", "take the n-th outgoing edge"],
  ["Backspace", "back (history)"],
  ["o", "overview; click a node to fly there"],
  ["Home", "go to the start"],
  ["e", "show outgoing edges"],
  ["f", "fullscreen"],
  ["?", "this help"],
  ["Esc", "close panels and the overview"],
];

export function bindKeys(p: Presentation, togglePanel: (panel: Panel | undefined) => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return;
    let handled = true;
    switch (e.key) {
      case " ":
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
        p.dispatch({ type: "step" });
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
        p.dispatch({ type: "prev" });
        break;
      case "Backspace":
        p.dispatch({ type: "back" });
        break;
      case "Home":
        p.dispatch({ type: "goto", node: p.talk.start });
        break;
      case "o":
        p.toggleOverview();
        break;
      case "Escape":
        p.toggleOverview(false);
        togglePanel(undefined);
        break;
      case "e":
        togglePanel("edges");
        break;
      case "?":
        togglePanel("help");
        break;
      case "f":
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
        break;
      default:
        if (/^[1-9]$/.test(e.key)) p.dispatch({ type: "edge", index: Number(e.key) - 1 });
        else handled = false;
    }
    if (handled) e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
