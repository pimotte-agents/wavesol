// Keyboard bindings for the projector window. Clickers send PageDown/PageUp (and sometimes arrows).
import type { Intent } from "./nav.ts";

export type Panel = "edges" | "help" | "pair";

/** What the keys drive: the presentation itself, or the projector from the presenter view. */
export interface Controls {
  readonly talk: { start: string };
  dispatch(intent: Intent): void;
  toggleOverview(on?: boolean): void;
  zoomOverview(factor: number): void;
  /** Opens the presenter view (projector only). */
  openPresenter?(): void;
  /** Starts pairing a phone (contacts the relays). */
  pair?(): void;
  /** Toggles drag mode (wavesol dev only). */
  toggleDragMode?(): void;
}

export const KEY_HELP: [string, string][] = [
  ["Space / → / PageDown", "next step, then the default edge"],
  ["← / PageUp", "previous step, then back"],
  ["1 – 9", "take the n-th outgoing edge"],
  ["Backspace", "back (history)"],
  ["o", "overview; click a node to fly there"],
  ["+ / −", "zoom the overview (also wheel, pinch; drag to pan)"],
  ["Home", "go to the start"],
  ["e", "show outgoing edges"],
  ["p", "open the presenter view (notes, next, timer)"],
  ["c", "connect a phone (QR code)"],
  ["d", "drag mode: drag nodes to pin them in talk.yaml (wavesol dev)"],
  ["f", "fullscreen"],
  ["?", "this help"],
  ["Esc", "close panels and the overview"],
];

export function bindKeys(p: Controls, togglePanel: (panel: Panel | undefined) => void): () => void {
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
      case "+":
      case "=":
        p.zoomOverview(1 / 1.4);
        break;
      case "-":
        p.zoomOverview(1.4);
        break;
      case "p":
        if (p.openPresenter) p.openPresenter();
        else handled = false;
        break;
      case "c":
        if (!p.pair) {
          handled = false;
          break;
        }
        p.pair();
        togglePanel("pair");
        break;
      case "d":
        if (p.toggleDragMode) p.toggleDragMode();
        else handled = false;
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
