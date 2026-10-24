// Screen-space chrome over the canvas: outgoing-edges panel, keyboard help and phone pairing.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Presentation, PresentationState } from "../presentation.ts";
import { KEY_HELP, bindKeys, type Controls, type Panel } from "../keys.ts";
import type { PhoneControl } from "../remote.ts";
import { PairPanel } from "./PairPanel.tsx";

export function Overlay({ presentation, phone }: { presentation: Presentation; phone: PhoneControl }) {
  const [state, setState] = useState<PresentationState>(presentation.state);
  const [panel, setPanel] = useState<Panel | undefined>();
  const phoneState = useSyncExternalStore(
    useCallback((fn) => phone.onChange(fn), [phone]),
    () => phone.state,
  );

  useEffect(() => presentation.subscribe(setState), [presentation]);
  useEffect(() => {
    const controls: Controls = {
      talk: presentation.talk,
      dispatch: (i) => presentation.dispatch(i),
      toggleOverview: (on) => presentation.toggleOverview(on),
      zoomOverview: (f) => presentation.zoomOverview(f),
      openPresenter: () => presentation.openPresenter(),
      pair: phone.enabled ? () => void phone.start() : undefined,
      toggleDragMode: import.meta.env.DEV ? () => presentation.setDragMode(!presentation.dragMode) : undefined,
    };
    return bindKeys(controls, (p) => setPanel((cur) => (p === undefined || cur === p ? undefined : p)));
  }, [presentation, phone]);

  return (
    <>
      {panel === "edges" && (
        <aside className="ws-panel ws-edges-panel" aria-label="Outgoing edges">
          <h3>{state.node.title}</h3>
          {state.outgoing.length === 0 && <p className="ws-muted">No outgoing edges. Backspace goes back.</p>}
          <ol>
            {state.outgoing.map(({ edge, target }, i) => (
              <li key={i}>
                <button onClick={() => presentation.dispatch({ type: "edge", index: i })}>
                  <kbd>{i + 1}</kbd> {edge.label ?? target.title}
                  {edge.default && <span className="ws-muted"> (default)</span>}
                </button>
              </li>
            ))}
          </ol>
        </aside>
      )}
      {state.dragMode && (
        <div className="ws-drag-banner" role="status">
          Drag mode: drag a node to pin it in talk.yaml. <kbd>o</kbd> overview, <kbd>d</kbd> to leave.
        </div>
      )}
      {panel === "pair" && (
        <aside className="ws-panel ws-pair-panel" aria-label="Connect a phone">
          <PairPanel phone={phoneState} />
        </aside>
      )}
      {panel === "help" && (
        <aside className="ws-panel ws-help-panel" aria-label="Keyboard help">
          <h3>Keys</h3>
          <dl>
            {KEY_HELP.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </>
  );
}
