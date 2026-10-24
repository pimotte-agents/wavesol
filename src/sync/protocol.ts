// Sync protocol between the projector (single source of truth) and its peers (presenter view, phone).
// Transports only move JSON messages; the host applies intents and publishes snapshots.
import type { Intent, Position } from "../runtime/nav.ts";

export type SyncIntent =
  | Intent
  | { type: "overview"; on?: boolean }
  /** laser pointer at a normalised screen position ([0,1]², top-left origin), or null to hide it */
  | { type: "pointer"; at: [number, number] | null }
  /** laser "click": a click on whatever is at that normalised screen position (e.g. a Lean tactic) */
  | { type: "click"; at: [number, number] }
  /** start phone pairing on the projector (contacts the relays; the snapshot then carries `pair`) */
  | { type: "pair" };

/** A phone connected through the network transport, and how its messages travel. */
export interface Remote {
  id: string;
  link: "p2p" | "relay";
}

export interface Snapshot extends Position {
  history: Position[];
  overview: boolean;
  /** Outgoing edges of the current node, in order, so peers without the talk can draw buttons. */
  outgoing: { to: string; title: string; label?: string; default?: boolean }[];
  /** Phone control, once pairing has started on the projector. */
  phone?: PhoneState;
}

export interface PhoneState {
  /** Pairing URL for the QR code (contains the room secret; peers on a transport already know it). */
  url?: string;
  /** Why there is no URL, or what to watch out for. */
  hint?: string;
  remotes: Remote[];
}

export type Message =
  /** peer → host: send me the current state */
  | { kind: "hello" }
  | { kind: "state"; session: string; version: number; state: Snapshot }
  /** peer → host, issued against the state (session, version) the peer was showing; `id` is unique per intent */
  | { kind: "intent"; id: string; session: string; version: number; intent: SyncIntent }
  /** host → peers: the projector is going away */
  | { kind: "bye"; session: string };

export interface Transport {
  send(msg: Message): void;
  subscribe(fn: (msg: Message) => void): () => void;
  close(): void;
}

const INTENT_TYPES = new Set(["step", "prev", "edge", "back", "goto", "overview", "pointer", "click", "pair"]);
/** How many recent intent ids the host remembers to drop replays. */
const SEEN_LIMIT = 500;

function isMessage(m: unknown): m is Message {
  return typeof m === "object" && m !== null && typeof (m as { kind?: unknown }).kind === "string";
}

/** Several transports as one: the host talks to the presenter window and phones alike. */
export function fanout(...transports: Transport[]): Transport {
  return {
    send: (msg) => transports.forEach((t) => t.send(msg)),
    subscribe(fn) {
      const offs = transports.map((t) => t.subscribe(fn));
      return () => offs.forEach((off) => off());
    },
    close: () => transports.forEach((t) => t.close()),
  };
}

/** Same-browser transport for the pop-out presenter window. */
export function broadcastTransport(name: string): Transport {
  const ch = new BroadcastChannel(name);
  return {
    send: (msg) => ch.postMessage(msg),
    subscribe(fn) {
      const on = (e: MessageEvent) => isMessage(e.data) && fn(e.data);
      ch.addEventListener("message", on);
      return () => ch.removeEventListener("message", on);
    },
    close: () => ch.close(),
  };
}

/** In-memory bus for tests: like BroadcastChannel, a message reaches every other transport, not the sender. */
export function memoryBus(): () => Transport {
  const members = new Set<{ fns: Set<(m: Message) => void> }>();
  return () => {
    const self = { fns: new Set<(m: Message) => void>() };
    members.add(self);
    return {
      send(msg) {
        const copy = JSON.parse(JSON.stringify(msg)) as Message; // structured clone, as on a real channel
        for (const m of members) if (m !== self) for (const fn of m.fns) fn(copy);
      },
      subscribe(fn) {
        self.fns.add(fn);
        return () => self.fns.delete(fn);
      },
      close: () => void members.delete(self),
    };
  };
}

/**
 * Projector side: answers hellos, applies intents, publishes every state change.
 * Dropped: intents from an earlier projector session, replays (an id seen before), and `edge` intents
 * issued against an older state, since an edge index only means something on the node it was chosen
 * on. Other intents (step, back, ...) still apply when stale, so quick repeated presses all count.
 */
export class SyncHost {
  readonly session = Math.random().toString(36).slice(2, 10);
  private version = 0;
  private last?: Snapshot;
  private lastJson = "";
  private seen = new Set<string>();
  private unsubscribe: () => void;

  constructor(
    private transport: Transport,
    private apply: (intent: SyncIntent) => void,
  ) {
    this.unsubscribe = transport.subscribe((m) => this.receive(m));
  }

  get currentVersion(): number {
    return this.version;
  }

  /** Publishes `s` if it differs from the last snapshot; each change gets a new version. */
  publish(s: Snapshot): void {
    const json = JSON.stringify(s);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.last = s;
    this.version++;
    this.sendState();
  }

  close(): void {
    this.transport.send({ kind: "bye", session: this.session });
    this.unsubscribe();
    this.transport.close();
  }

  private sendState() {
    if (this.last) this.transport.send({ kind: "state", session: this.session, version: this.version, state: this.last });
  }

  private receive(m: Message) {
    if (m.kind === "hello") this.sendState();
    else if (m.kind === "intent") {
      if (m.session !== this.session || !m.intent || !INTENT_TYPES.has(m.intent.type)) return;
      if (typeof m.id !== "string" || this.seen.has(m.id)) return;
      this.seen.add(m.id);
      if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value!);
      if (m.intent.type === "edge" && m.version !== this.version) return;
      this.apply(m.intent);
    }
  }
}

export interface PeerView {
  connected: boolean;
  session?: string;
  version: number;
  state?: Snapshot;
}

/** Peer side: tracks the latest snapshot and sends intents against it. */
export class SyncPeer {
  private readonly id = Math.random().toString(36).slice(2, 10);
  private sent = 0;
  private view: PeerView = { connected: false, version: 0 };
  private listeners = new Set<(v: PeerView) => void>();
  private unsubscribe: () => void;

  constructor(private transport: Transport) {
    this.unsubscribe = transport.subscribe((m) => this.receive(m));
    transport.send({ kind: "hello" });
  }

  get current(): PeerView {
    return this.view;
  }

  subscribe(fn: (v: PeerView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Sends an intent against the state shown; false when there is no projector to send it to. */
  send(intent: SyncIntent): boolean {
    const { connected, session, version } = this.view;
    if (!connected || !session) return false;
    this.transport.send({ kind: "intent", id: `${this.id}:${this.sent++}`, session, version, intent });
    return true;
  }

  close(): void {
    this.unsubscribe();
    this.transport.close();
  }

  private receive(m: Message) {
    if (m.kind === "state") {
      // a newer session (projector reloaded) always wins; within a session, ignore out-of-order versions
      if (m.session === this.view.session && m.version <= this.view.version) return;
      this.set({ connected: true, session: m.session, version: m.version, state: m.state });
    } else if (m.kind === "bye" && m.session === this.view.session) {
      this.set({ ...this.view, connected: false });
    }
  }

  private set(v: PeerView) {
    this.view = v;
    for (const fn of this.listeners) fn(v);
  }
}
