// The presenter view: a second window, synced with the projector over the sync protocol. Shows the
// current node at its step, what Space does next, outgoing edges, speaker notes, timer, clock and a
// mini-map. Its keys and clicks are sent to the projector as intents.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CompiledTalk } from "../../model/compiled.ts";
import type { RuntimePlugin } from "../../plugins/types.ts";
import type { PeerView, SyncPeer } from "../../sync/protocol.ts";
import { bindKeys, type Controls } from "../keys.ts";
import { NavGraph, navigate } from "../nav.ts";
import { MiniMap } from "./MiniMap.tsx";
import { NodePreview } from "./NodePreview.tsx";
import { PairPanel, linkLabel } from "../ui/PairPanel.tsx";

interface Props {
  talk: CompiledTalk;
  peer: SyncPeer;
  plugins: Record<string, RuntimePlugin>;
}

export function Presenter({ talk, peer, plugins }: Props) {
  // an external store: a state that arrives before the first render's effects run is not lost
  const view = useSyncExternalStore<PeerView>(
    useCallback((fn) => peer.subscribe(fn), [peer]),
    () => peer.current,
  );
  const graph = useMemo(() => new NavGraph(talk), [talk]);
  const byId = useMemo(() => new Map(talk.nodes.map((n) => [n.id, n])), [talk]);
  const timer = useTimer();
  const now = useNow();
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    const controls: Controls = {
      talk,
      dispatch: (intent) => peer.send(intent),
      toggleOverview: (on) => peer.send({ type: "overview", on: on ?? !peer.current.state?.overview }),
      zoomOverview: () => {},
      pair: () => peer.send({ type: "pair" }),
    };
    return bindKeys(controls, (panel) => panel === "pair" && setPairing((on) => !on));
  }, [peer, talk]);

  // the clock starts with the first move away from where the presenter view found the talk
  const pos = view.state ? `${view.state.node}/${view.state.step}` : "";
  const firstPos = useRef<string | null>(null);
  const { start } = timer;
  useEffect(() => {
    if (!pos) return;
    if (firstPos.current === null) firstPos.current = pos;
    else if (pos !== firstPos.current) start();
  }, [pos, start]);

  const s = view.state;
  const node = s ? byId.get(s.node) : undefined;
  const next = s ? navigate(graph, { node: s.node, step: s.step, history: s.history }, { type: "step" }) : undefined;
  const nextNode = next && next.kind !== "none" ? byId.get(next.state.node) : undefined;
  const visited = useMemo(() => new Set(s ? [...s.history.map((h) => h.node), s.node] : []), [s]);

  return (
    <div className={`ws-presenter${view.connected ? "" : " ws-disconnected"}`}>
      <section className="ws-presenter-current" aria-label="Current">
        <h2 className="ws-ph">
          {node?.title ?? "—"}
          {node && node.steps > 0 && (
            <span className="ws-muted">
              {" "}
              · step {s!.step} of {node.steps}
            </span>
          )}
          {s?.overview && <span className="ws-muted"> · overview</span>}
        </h2>
        {s && <NodePreview talk={talk} node={s.node} step={s.step} focus={s.focus} live={s.live} plugins={plugins} />}
      </section>

      <section className="ws-presenter-next" aria-label="Next">
        <h2 className="ws-ph">
          Next <kbd>Space</kbd>{" "}
          <span className="ws-muted">
            {!next || next.kind === "none" ? "end: no default edge" : next.kind === "step" ? `step ${next.state.step}` : nextNode?.title}
          </span>
        </h2>
        {next && next.kind !== "none" && <NodePreview talk={talk} node={next.state.node} step={next.state.step} plugins={plugins} />}
      </section>

      <section className="ws-presenter-side">
        <header className="ws-presenter-bar">
          <span className={`ws-status ${view.connected ? "ws-ok" : "ws-waiting"}`} role="status">
            {view.connected ? "Projector connected" : "Waiting for the projector: open the talk in another window, or press p there"}
          </span>
          <button className="ws-timer" onClick={timer.toggle} title="Click to pause or resume">
            {formatDuration(timer.elapsed(now))}
            {!timer.running && timer.elapsed(now) > 0 && <span className="ws-muted"> paused</span>}
          </button>
          <button className="ws-timer-reset" onClick={timer.reset}>
            Reset
          </button>
          <span className="ws-clock">{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </header>
        <div className="ws-presenter-phone">
          <span>
            Phone:{" "}
            {!s?.phone ? (
              <span className="ws-muted">not paired</span>
            ) : s.phone.remotes.length ? (
              s.phone.remotes.map(linkLabel).join(", ")
            ) : (
              <span className="ws-muted">none connected</span>
            )}
          </span>
          <button
            className="ws-pair-button"
            onClick={() => {
              if (!pairing) peer.send({ type: "pair" });
              setPairing(!pairing);
            }}
          >
            {pairing ? "Hide QR code" : "Connect a phone"}
          </button>
        </div>
        {pairing && <PairPanel phone={s?.phone} />}
        <div className="ws-presenter-edges" aria-label="Outgoing edges">
          <h2 className="ws-ph">Edges</h2>
          {s && s.outgoing.length === 0 && <p className="ws-muted">No outgoing edges. Backspace goes back.</p>}
          <ol>
            {s?.outgoing.map((e, i) => (
              <li key={i}>
                <button onClick={() => peer.send({ type: "edge", index: i })}>
                  <kbd>{i + 1}</kbd> {e.label ?? e.title}
                  {e.default && <span className="ws-muted"> (default)</span>}
                </button>
              </li>
            ))}
          </ol>
          <button className="ws-back" disabled={!s?.history.length} onClick={() => peer.send({ type: "back" })}>
            <kbd>⌫</kbd> Back{s?.history.length ? ` to ${byId.get(s.history.at(-1)!.node)?.title}` : ""}
          </button>
        </div>
        <div className="ws-presenter-notes" aria-label="Speaker notes">
          <h2 className="ws-ph">Notes</h2>
          {node?.notes ? <div className="ws-notes" dangerouslySetInnerHTML={{ __html: node.notes }} /> : <p className="ws-muted">No notes for this node.</p>}
        </div>
      </section>

      <section className="ws-presenter-map" aria-label="Mini-map">
        {s && <MiniMap talk={talk} current={s.node} visited={visited} onGo={(id) => peer.send({ type: "goto", node: id })} />}
      </section>
    </div>
  );
}

function formatDuration(ms: number): string {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return now;
}

interface TimerState {
  /** ms counted before the current run */
  base: number;
  /** when the current run started; null while paused or not started */
  since: number | null;
}
const TIMER_KEY = "wavesol:presenter-timer";

/** Talk timer; survives a reload of the presenter window (sessionStorage, if available). */
function useTimer() {
  const [t, setT] = useState<TimerState>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(TIMER_KEY) ?? "null") as TimerState | null;
      if (saved && typeof saved.base === "number") return saved;
    } catch {
      // storage unavailable: start fresh
    }
    return { base: 0, since: null };
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(TIMER_KEY, JSON.stringify(t));
    } catch {
      // not persisted; the timer still works
    }
  }, [t]);
  // stable, so callers can depend on it without re-running when the timer ticks or resets
  const start = useCallback(() => setT((c) => (c.since === null && c.base === 0 ? { base: 0, since: Date.now() } : c)), []);
  return {
    running: t.since !== null,
    elapsed: (now: number) => t.base + (t.since === null ? 0 : now - t.since),
    /** starts the timer if it has never run (or was reset) */
    start,
    toggle: () => setT((c) => (c.since === null ? { ...c, since: Date.now() } : { base: c.base + Date.now() - c.since, since: null })),
    reset: () => setT({ base: 0, since: null }),
  };
}
