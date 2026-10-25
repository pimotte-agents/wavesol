// Screen-space chrome over the canvas: outgoing-edges panel, keyboard help, phone pairing, and the
// touch bars on phones and tablets.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { renderSVG } from "uqr";
import type { Presentation, PresentationState } from "../presentation.ts";
import { KEY_HELP, bindKeys, type Controls, type Panel } from "../keys.ts";
import type { AudienceHub, PhoneControl } from "../remote.ts";
import { PairPanel } from "./PairPanel.tsx";
import { TouchBars, useTouch } from "./TouchBars.tsx";

export function Overlay({ presentation, phone, audience }: { presentation: Presentation; phone: PhoneControl; audience: AudienceHub }) {
  const [state, setState] = useState<PresentationState>(presentation.state);
  const [panel, setPanel] = useState<Panel | undefined>();
  const touch = useTouch();
  const phoneState = useSyncExternalStore(
    useCallback((fn) => phone.onChange(fn), [phone]),
    () => phone.state,
  );

  const audienceState = useSyncExternalStore(
    useCallback((fn) => audience.onChange(fn), [audience]),
    () => audience.state,
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
      join: audience.enabled ? () => void audience.start() : undefined,
      blackout: (on) => presentation.setBlackout(on),
      toggleDragMode: import.meta.env.DEV ? () => presentation.setDragMode(!presentation.dragMode) : undefined,
    };
    return bindKeys(controls, (p) => setPanel((cur) => (p === undefined || cur === p ? undefined : p)));
  }, [presentation, phone, audience]);

  return (
    <>
      {touch && <TouchBars presentation={presentation} state={state} />}
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
      {panel === "join" && (
        <div className="ws-join" role="dialog" aria-label="Join the poll">
          <h2>Join with your phone</h2>
          <JoinCode url={audienceState?.url} />
          {audienceState?.hint && <p className="ws-pair-hint">{audienceState.hint}</p>}
          <p className="ws-muted" role="status">
            {audienceState ? `${audienceState.joined} joined` : "Starting…"}
          </p>
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
          {presentation.talk.pdf && (
            <p>
              <a href={presentation.talk.pdf.file} download>
                Download the talk as PDF
              </a>
            </p>
          )}
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

function JoinCode({ url }: { url?: string }) {
  const svg = useMemo(() => (url ? renderSVG(url, { border: 2 }) : undefined), [url]);
  if (!svg) return null;
  return (
    <>
      <div className="ws-qr ws-join-qr" role="img" aria-label="QR code to join" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="ws-join-url">
        or open <a href={url}>this link</a>
      </p>
    </>
  );
}
