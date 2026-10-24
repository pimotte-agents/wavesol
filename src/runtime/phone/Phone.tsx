// The phone controller (`?phone#k=<room secret>`): a big Next button, Prev and Back, one button per
// outgoing edge, and a laser pointer pad. Intents go to the projector over the network transport.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CompiledTalk } from "../../model/compiled.ts";
import type { NetPeer, PeerStatus } from "../../sync/net.ts";
import type { PeerView, SyncIntent, SyncPeer } from "../../sync/protocol.ts";

const STATUS_TEXT: Record<PeerStatus, string> = {
  p2p: "Connected (direct)",
  relay: "Connected (relayed)",
  connecting: "Looking for the projector…",
  offline: "Offline: reconnecting…",
};
/** A press shorter and smaller than this is a tap (a click on the projector). */
const TAP_MS = 300;
const TAP_PX = 10;
/** Pointer updates per second: smooth when direct, gentler on public relays (they rate-limit). */
const POINTER_MS: Record<PeerStatus, number> = { p2p: 33, relay: 100, connecting: 100, offline: 100 };

export function PhoneError({ message }: { message: string }) {
  return (
    <main className="ws-phone ws-phone-error">
      <p>{message}</p>
    </main>
  );
}

export function Phone({ talk, peer, net }: { talk: CompiledTalk; peer: SyncPeer; net: NetPeer }) {
  const view = useSyncExternalStore<PeerView>(
    useCallback((fn) => peer.subscribe(fn), [peer]),
    () => peer.current,
  );
  const status = useSyncExternalStore<PeerStatus>(
    useCallback((fn) => net.onStatus(fn), [net]),
    () => net.status,
  );
  const awake = useWakeLock();
  const s = view.state;
  const node = s ? talk.nodes.find((n) => n.id === s.node) : undefined;
  const live = view.connected && status !== "connecting" && status !== "offline";

  const send = (intent: SyncIntent) => {
    if (!peer.send(intent)) return;
    navigator.vibrate?.(8);
  };

  return (
    <main className={`ws-phone${live ? "" : " ws-phone-waiting"}`}>
      <header className="ws-phone-bar">
        <span className={`ws-phone-status ws-${status}`} role="status">
          {STATUS_TEXT[status]}
        </span>
        <span className="ws-phone-title">
          {node?.title ?? talk.meta.title}
          {node && node.steps > 0 && (
            <span className="ws-muted">
              {" "}
              {s!.step}/{node.steps}
            </span>
          )}
        </span>
      </header>

      <LaserPad send={send} interval={POINTER_MS[status]} />

      <ol className="ws-phone-edges" aria-label="Outgoing edges">
        {s?.outgoing.map((e, i) => (
          <li key={i}>
            <button onClick={() => send({ type: "edge", index: i })}>
              {e.label ?? e.title}
              {e.default && <span className="ws-muted"> (default)</span>}
            </button>
          </li>
        ))}
      </ol>

      <nav className="ws-phone-nav">
        <button className="ws-phone-back" disabled={!s?.history.length} onClick={() => send({ type: "back" })}>
          Back
        </button>
        <button className="ws-phone-prev" onClick={() => send({ type: "prev" })}>
          Prev
        </button>
        <button className="ws-phone-next" onClick={() => send({ type: "step" })}>
          Next
        </button>
      </nav>
      {!awake && <p className="ws-phone-hint">This browser can't keep the screen on: turn off auto-lock while presenting.</p>}
    </main>
  );
}

/** A 16:9 touch area mapped onto the projector screen; while touched, the projector shows a dot. */
function LaserPad({ send, interval }: { send: (i: SyncIntent) => void; interval: number }) {
  const pad = useRef<HTMLDivElement>(null);
  const [throttle] = useState(() => new Throttle());
  // a quick tap that barely moves is a click on the projector
  const press = useRef<{ x: number; y: number; t: number; at: [number, number] } | undefined>(undefined);
  const [active, setActive] = useState(false);

  const at = (e: React.PointerEvent): [number, number] => {
    const r = pad.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const move = (p: [number, number]) => throttle.push(() => send({ type: "pointer", at: p }), interval);
  const end = (e: React.PointerEvent) => {
    throttle.cancel();
    setActive(false);
    send({ type: "pointer", at: null });
    const p = press.current;
    press.current = undefined;
    if (e.type === "pointerup" && p && performance.now() - p.t < TAP_MS && Math.hypot(e.clientX - p.x, e.clientY - p.y) < TAP_PX) {
      send({ type: "click", at: p.at });
    }
  };

  return (
    <div
      ref={pad}
      className={`ws-phone-laser${active ? " ws-active" : ""}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
        throttle.reset();
        press.current = { x: e.clientX, y: e.clientY, t: performance.now(), at: at(e) };
        move(at(e));
      }}
      onPointerMove={(e) => active && move(at(e))}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span>Laser pointer: drag to point, tap to click</span>
    </div>
  );
}

/** Runs at most one action per interval; the latest action before a pause always runs. */
class Throttle {
  private last = 0;
  private timer?: ReturnType<typeof setTimeout>;
  push(action: () => void, interval: number) {
    clearTimeout(this.timer);
    const wait = this.last + interval - Date.now();
    if (wait > 0) return void (this.timer = setTimeout(() => this.push(action, interval), wait));
    this.last = Date.now();
    action();
  }
  cancel() {
    clearTimeout(this.timer);
  }
  reset() {
    this.cancel();
    this.last = 0;
  }
}

/** Keeps the screen on while the page is visible; false where the browser can't (e.g. plain HTTP). */
function useWakeLock(): boolean {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator && window.isSecureContext;
  useEffect(() => {
    if (!supported) return;
    let lock: WakeLockSentinel | undefined;
    const acquire = () => {
      if (document.visibilityState === "visible") void navigator.wakeLock.request("screen").then((l) => (lock = l), () => {});
    };
    acquire();
    // the lock is released when the page is hidden; take it again on return
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release();
    };
  }, [supported]);
  return supported;
}
