// Phone control glue for the browser: which relay to use (the local one of `wavesol serve`/`dev`, else
// the talk's public relays), the room secret, and the pairing URL. The projector contacts no relay
// until pairing is asked for (or a phone was paired in this tab before a reload).
import type { CompiledTalk } from "../model/compiled.ts";
import { newSecret, room } from "../sync/crypto.ts";
import { DEFAULT_ICE, NetHost, NetPeer, type AnyMessage } from "../sync/net.ts";
import { PollHost, type AudienceMessage, type PollView, type Results } from "../sync/audience.ts";
import type { Message, PhoneState, Transport } from "../sync/protocol.ts";
import { DEFAULT_RELAYS, signalForAll } from "../sync/relays.ts";
import { RoomSignal, type Signal } from "../sync/signal.ts";

interface ServeInfo {
  relay: string;
  lan: string[];
}

/** Asks the server whether it is `wavesol serve`/`dev` with a local relay; static hosts say no. */
async function serveInfo(): Promise<ServeInfo | undefined> {
  try {
    const res = await fetch("__wavesol/serve.json", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!res.ok) return undefined;
    const info = (await res.json()) as ServeInfo;
    return typeof info.relay === "string" && Array.isArray(info.lan) ? info : undefined;
  } catch {
    return undefined;
  }
}

function signalFor(talk: CompiledTalk, topic: string, info: ServeInfo | undefined): Signal {
  if (info) {
    const url = new URL(info.relay, location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new RoomSignal(url.href, topic);
  }
  return signalForAll(talk.sync.relays ?? DEFAULT_RELAYS, topic);
}

const iceFor = (talk: CompiledTalk): RTCIceServer[] => [...DEFAULT_ICE, ...talk.sync.ice];

const SECRET_KEY = `wavesol:room:${location.pathname}`;

function storage(): Storage | undefined {
  try {
    return sessionStorage;
  } catch {
    return undefined;
  }
}

export interface Pairing<M extends AnyMessage = Message> {
  net: NetHost<M>;
  /** URL for the phone (QR code). */
  url: string;
  /** Why there is no URL, or what to watch out for. */
  hint?: string;
}

/** Projector side: starts the room (once) and returns the pairing details. */
/**
 * Projector side: starts a room (once per tab; its secret survives a reload) and returns the join
 * URL. `control` is the phone controller's room, `audience` the polls' room: separate secrets, so the
 * audience's public QR code never lets anyone drive the talk.
 */
async function startRoom<M extends AnyMessage>(talk: CompiledTalk, kind: "control" | "audience"): Promise<Pairing<M>> {
  const key = kind === "control" ? SECRET_KEY : `wavesol:audience:${location.pathname}`;
  const store = storage();
  let secret = store?.getItem(key) ?? "";
  try {
    room(secret);
  } catch {
    secret = newSecret();
  }
  store?.setItem(key, secret);
  const r = room(secret);
  const info = await serveInfo();
  const net = new NetHost<M>({ room: r, signal: signalFor(talk, r.topic, info), ice: iceFor(talk) });

  // a phone can't open localhost; the link still works from another window on this machine
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  let base = location.origin + location.pathname;
  let hint: string | undefined;
  if (info?.lan[0]) base = info.lan[0] + location.pathname;
  else if (local)
    hint = info
      ? "This link only works on this computer: for a phone, restart with --host and use the same network."
      : "This link only works on this computer: present from the deployed site, or wavesol serve --host.";
  return { net, url: `${base}?${kind === "control" ? "phone" : "audience"}#k=${secret}`, hint };
}

export const startPairing = (talk: CompiledTalk) => startRoom<Message>(talk, "control");

/** Whether this tab paired a phone before (so a reload reconnects without asking). */
export function wasPaired(): boolean {
  return !!storage()?.getItem(SECRET_KEY);
}

/** Phone side: joins the room from the secret in the URL fragment. */
export async function joinRoom<M extends AnyMessage = Message>(talk: CompiledTalk, kind: "control" | "audience" = "control"): Promise<NetPeer<M> | { error: string }> {
  const params = new URLSearchParams(location.hash.slice(1));
  let r;
  try {
    r = room(params.get("k") ?? "");
  } catch {
    return {
      error: kind === "control" ? "Scan the QR code shown in the presenter view (press c on the projector)." : "Scan the QR code on the screen to join.",
    };
  }
  const info = await serveInfo();
  // rtc=0: relay only (tests, or networks where WebRTC misbehaves)
  return new NetPeer<M>({ room: r, signal: signalFor(talk, r.topic, info), ice: params.get("rtc") === "0" ? false : iceFor(talk) });
}

/**
 * Projector side as a transport for the SyncHost: inert until pairing starts (`c` on the projector,
 * or "Connect a phone" in the presenter view), then the network hub.
 */
export class PhoneControl implements Transport {
  private net?: NetHost;
  private subs = new Set<(m: Message) => void>();
  private listeners = new Set<() => void>();
  state?: PhoneState;

  constructor(private talk: CompiledTalk) {
    if (talk.sync.phone && wasPaired()) void this.start();
  }

  get enabled(): boolean {
    return this.talk.sync.phone;
  }

  async start(): Promise<void> {
    if (this.state || !this.talk.sync.phone) return;
    this.state = { remotes: [] };
    this.emit();
    const p = await startPairing(this.talk);
    this.net = p.net;
    this.state = { url: p.url, hint: p.hint, remotes: [] };
    p.net.subscribe((m) => this.subs.forEach((fn) => fn(m)));
    p.net.onRemotes((remotes) => {
      this.state = { ...this.state!, remotes };
      this.emit();
    });
    this.emit();
  }

  send(m: Message): void {
    this.net?.send(m);
  }

  subscribe(fn: (m: Message) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.net?.close();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export interface AudienceState {
  /** Join URL for the audience QR code. */
  url?: string;
  hint?: string;
  /** Phones in the audience room. */
  joined: number;
}

/**
 * Projector side of the polls: the audience room (started at the first poll or `j`), and the votes.
 * The presentation tells it which poll is on screen.
 */
export class AudienceHub {
  private host?: PollHost;
  private starting?: Promise<void>;
  private pending?: PollView;
  private listeners = new Set<() => void>();
  state?: AudienceState;

  constructor(private talk: CompiledTalk) {}

  get enabled(): boolean {
    return this.talk.sync.phone && this.talk.nodes.some((n) => n.type === "poll");
  }

  start(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    this.starting ??= (async () => {
      const p = await startRoom<AudienceMessage>(this.talk, "audience");
      let store: Storage | undefined;
      try {
        store = sessionStorage;
      } catch {
        // votes then don't survive a reload
      }
      this.host = new PollHost(p.net, store && { get: (k) => store.getItem(k), set: (k, v) => store.setItem(k, v) });
      this.state = { url: p.url, hint: p.hint, joined: 0 };
      p.net.onRemotes((r) => {
        this.state = { ...this.state!, joined: r.length };
        this.emit();
      });
      this.host.onChange(() => this.emit());
      this.host.open(this.pending);
      this.emit();
    })();
    return this.starting;
  }

  /** The poll on screen, or undefined; starts the room at the first poll. */
  show(poll: PollView | undefined): void {
    this.pending = poll;
    if (poll) void this.start();
    this.host?.open(poll);
  }

  results(poll: string): Results | undefined {
    return this.host?.results(poll);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
