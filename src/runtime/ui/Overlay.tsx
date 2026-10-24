// Screen-space chrome over the canvas: outgoing-edges panel and keyboard help.
import { useEffect, useState } from "react";
import type { Presentation, PresentationState } from "../presentation.ts";
import { KEY_HELP, bindKeys, type Panel } from "../keys.ts";

export function Overlay({ presentation }: { presentation: Presentation }) {
  const [state, setState] = useState<PresentationState>(presentation.state);
  const [panel, setPanel] = useState<Panel | undefined>();

  useEffect(() => presentation.subscribe(setState), [presentation]);
  useEffect(() => bindKeys(presentation, (p) => setPanel((cur) => (p === undefined || cur === p ? undefined : p))), [presentation]);

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
