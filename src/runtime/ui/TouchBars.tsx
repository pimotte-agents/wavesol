// Touch screens (phones, tablets): buttons above and below the slide. Portrait has room there, so the
// bars sit in it and the camera fits the slide between them; landscape has none, so the buttons float
// in the corners and fade while unused. Swipes (in Presentation) do the same as ◀ and ▶.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Presentation, PresentationState } from "../presentation.ts";

function useMedia(query: string): boolean {
  const subscribe = (fn: () => void) => {
    const m = matchMedia(query);
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  };
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}

/** Whether the device's main pointer is touch: then the touch bars are shown. */
export function useTouch(): boolean {
  return useMedia("(pointer: coarse)");
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);
const PREV = "M15 5 8 12l7 7";
const NEXT = "m9 5 7 7-7 7";
const OVERVIEW = "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z";
const MENU = "M4 7h16M4 12h16M4 17h16";
const DETOURS = "M7 3v18M7 10c0 4 10 3 10 8v3M14 6l3-3 3 3M17 3v5";

type Sheet = "edges" | "menu" | "gestures";

export function TouchBars({ presentation, state }: { presentation: Presentation; state: PresentationState }) {
  const portrait = useMedia("(orientation: portrait)");
  const [sheet, setSheet] = useState<Sheet | undefined>();
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // portrait: the camera fits the slide between the bars; landscape: over the whole screen
  useEffect(() => {
    if (!portrait) return presentation.setInsets(0, 0);
    const measure = () => presentation.setInsets(top.current?.offsetHeight ?? 0, bottom.current?.offsetHeight ?? 0);
    const ro = new ResizeObserver(measure);
    for (const r of [top, bottom]) if (r.current) ro.observe(r.current);
    measure();
    return () => {
      ro.disconnect();
      presentation.setInsets(0, 0);
    };
  }, [portrait, presentation]);

  // landscape: the floating buttons fade after a while (a CSS animation); touching or moving on
  // restarts it, so they come back
  const float = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (portrait) return;
    const wake = () => {
      for (const a of float.current?.getAnimations({ subtree: true }) ?? []) a.currentTime = 0;
    };
    wake();
    window.addEventListener("pointerdown", wake);
    return () => window.removeEventListener("pointerdown", wake);
  }, [portrait, state.nav]);

  const { nav, node, outgoing, overview } = state;
  const steps = node.steps;
  const next = outgoing.find((o) => o.edge.default);
  const canNext = nav.step < steps || !!next;
  const canPrev = nav.step > 0 || nav.history.length > 0;
  const detours = outgoing.filter((o) => !o.edge.default);
  const parent = node.parent ? presentation.talk.nodes.find((n) => n.id === node.parent) : undefined;
  const siblings = parent?.children ?? [];
  const pdf = presentation.talk.pdf?.file;
  const fullscreen = typeof document !== "undefined" && document.fullscreenEnabled;
  // the stage takes horizontal drags for swipes, while pinch-zoom still works
  useEffect(() => {
    document.documentElement.classList.add("ws-touch-mode");
    return () => document.documentElement.classList.remove("ws-touch-mode");
  }, []);

  const go = (f: () => void) => () => {
    setSheet(undefined);
    f();
  };

  const prevButton = (
    <button className="ws-touch-btn ws-touch-prev" aria-label="Previous" disabled={!canPrev} onClick={go(() => presentation.dispatch({ type: "prev" }))}>
      <Icon d={PREV} />
    </button>
  );
  const nextButton = (
    <button className="ws-touch-btn ws-touch-next" aria-label="Next" disabled={!canNext} onClick={go(() => presentation.dispatch({ type: "step" }))}>
      <Icon d={NEXT} />
    </button>
  );
  const detourButton = detours.length > 0 && (
    <button className="ws-touch-btn ws-touch-detours" aria-label={`${detours.length} more ways from here`} onClick={() => setSheet(sheet === "edges" ? undefined : "edges")}>
      <Icon d={DETOURS} />
      <span>
        {detours.length} {detours.length === 1 ? "detour" : "detours"}
      </span>
    </button>
  );
  const overviewButton = (
    <button className={`ws-touch-btn${overview ? " ws-on" : ""}`} aria-label="Overview" aria-pressed={overview} onClick={go(() => presentation.toggleOverview())}>
      <Icon d={OVERVIEW} />
    </button>
  );
  const menuButton = (
    <button className="ws-touch-btn" aria-label="Menu" aria-expanded={sheet === "menu"} onClick={() => setSheet(sheet === "menu" ? undefined : "menu")}>
      <Icon d={MENU} />
    </button>
  );

  let sheetContent: ReactNode = null;
  if (sheet === "edges") {
    sheetContent = (
      <>
        <h3>From here</h3>
        <ol>
          {outgoing.map(({ edge, target }, i) => (
            <li key={i}>
              <button onClick={go(() => presentation.dispatch({ type: "edge", index: i }))}>
                {edge.label ?? target.title}
                {edge.default && <span className="ws-muted"> · next</span>}
              </button>
            </li>
          ))}
        </ol>
      </>
    );
  } else if (sheet === "menu") {
    sheetContent = (
      <ol>
        {pdf && (
          <li>
            <a href={pdf} download onClick={() => setSheet(undefined)}>
              Download the slides as PDF
            </a>
          </li>
        )}
        {fullscreen && (
          <li>
            <button onClick={go(() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}))}>
              {document.fullscreenElement ? "Leave fullscreen" : "Fullscreen"}
            </button>
          </li>
        )}
        <li>
          <button onClick={() => setSheet("gestures")}>Gestures</button>
        </li>
      </ol>
    );
  } else if (sheet === "gestures") {
    sheetContent = (
      <>
        <h3>Gestures</h3>
        <dl>
          <dt>Swipe ← or ▶</dt>
          <dd>next step, then the next slide</dd>
          <dt>Swipe → or ◀</dt>
          <dd>previous step, then back</dd>
          <dt>Detours</dt>
          <dd>the other ways on from this slide</dd>
          <dt>▦</dt>
          <dd>overview: tap a slide to go there; drag and pinch to look around</dd>
        </dl>
      </>
    );
  }

  const sheets = sheet && (
    <>
      <div className="ws-touch-scrim" onClick={() => setSheet(undefined)} />
      <div className={`ws-touch-sheet ws-touch-sheet-${sheet}`} role="dialog" aria-label={sheet === "edges" ? "From here" : sheet === "menu" ? "Menu" : "Gestures"}>
        {sheetContent}
      </div>
    </>
  );

  if (!portrait) {
    return (
      <div className="ws-touch ws-touch-float" ref={float}>
        <div className="ws-touch-corner ws-touch-tl">{overviewButton}</div>
        <div className="ws-touch-corner ws-touch-tr">{menuButton}</div>
        {!overview && (
          <>
            <div className="ws-touch-corner ws-touch-bl">{prevButton}</div>
            <div className="ws-touch-corner ws-touch-bc">{detourButton}</div>
            <div className="ws-touch-corner ws-touch-br">{nextButton}</div>
          </>
        )}
        {sheets}
      </div>
    );
  }

  return (
    <div className="ws-touch ws-touch-bars">
      <header className="ws-touch-top" ref={top}>
        {overviewButton}
        <div className="ws-touch-title">
          <div className="ws-touch-node">{overview ? presentation.talk.meta.title : node.title}</div>
          {!overview && parent && (
            <div className="ws-touch-where ws-muted">
              {parent.title} · {siblings.indexOf(node.id) + 1} / {siblings.length}
            </div>
          )}
        </div>
        {menuButton}
      </header>
      <footer className="ws-touch-bottom" ref={bottom}>
        {overview ? (
          <p className="ws-touch-hint ws-muted">Tap a slide to go there</p>
        ) : (
          <>
            <div className="ws-touch-dots" aria-label={steps ? `Step ${nav.step + 1} of ${steps + 1}` : undefined}>
              {steps > 0 && Array.from({ length: steps + 1 }, (_, i) => <span key={i} className={i <= nav.step ? "ws-on" : ""} />)}
            </div>
            <div className="ws-touch-row">
              {prevButton}
              <div className="ws-touch-middle">{detourButton}</div>
              {nextButton}
            </div>
            <div className="ws-touch-next-hint ws-muted">{nav.step >= steps && next ? `Next: ${next.edge.label ?? next.target.title}` : " "}</div>
          </>
        )}
      </footer>
      {sheets}
    </div>
  );
}
