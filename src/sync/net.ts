// Network transport between the projector (hub) and phones. Everything goes through a signal (relay
// network) sealed with the room key, so it works at once; meanwhile each phone sets up a WebRTC data
// channel with the projector over the same signal, and once it is open their messages go direct.
// Anything that does not open with the room key is ignored: that is what keeps strangers out.
import { open, seal, type Room } from "./crypto.ts";
import type { Message, Remote, Transport } from "./protocol.ts";
import type { Signal } from "./signal.ts";

type Role = "host" | "peer";
type RtcData = { sdp: RTCSessionDescriptionInit } | { ice: RTCIceCandidateInit };

interface Envelope {
  from: string;
  role: Role;
  /** Recipient; absent = every peer (or the host, from a phone). */
  to?: string;
  msg?: Message;
  rtc?: RtcData;
}

export const DEFAULT_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];

export interface NetOptions {
  room: Room;
  signal: Signal;
  /** ICE servers for WebRTC (STUN, TURN); false = relay only. */
  ice?: RTCIceServer[] | false;
  id?: string;
}

/** Phones say hello this often; it keeps them listed on the projector and refreshes their state. */
export const HEARTBEAT_MS = 10_000;
/** A phone not heard from for this long is dropped from the projector's list. */
export const PEER_TIMEOUT_MS = 35_000;
/** A projector not heard from for this long is "connecting" again on the phone. */
export const HOST_TIMEOUT_MS = 25_000;
/** A WebRTC attempt that has not opened by then is abandoned (and retried later). */
const RTC_CONNECT_MS = 8_000;
const RTC_RETRY_MIN = 2_000;
const RTC_RETRY_MAX = 30_000;

const randomId = () => Math.random().toString(36).slice(2, 12);

function isEnvelope(x: unknown): x is Envelope {
  const e = x as Envelope;
  return typeof e === "object" && e !== null && typeof e.from === "string" && (e.role === "host" || e.role === "peer");
}

/** One WebRTC connection with a single ordered data channel. */
class Link {
  private pc: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private pending: RTCIceCandidateInit[] = [];
  private haveRemote = false;
  closed = false;

  constructor(
    ice: RTCIceServer[],
    initiator: boolean,
    private out: (d: RtcData) => void,
    private onMessage: (m: Message) => void,
    private onChange: () => void,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ice });
    this.pc.onicecandidate = (e) => e.candidate && this.out({ ice: e.candidate.toJSON() });
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") this.close();
    };
    if (initiator) {
      this.attach(this.pc.createDataChannel("wavesol", { ordered: true }));
      this.pc
        .setLocalDescription()
        .then(() => this.out({ sdp: this.pc.localDescription!.toJSON() }))
        .catch(() => this.close());
    } else {
      this.pc.ondatachannel = (e) => this.attach(e.channel);
    }
  }

  get open(): boolean {
    return !this.closed && this.dc?.readyState === "open";
  }

  async handle(d: RtcData): Promise<void> {
    if (this.closed) return;
    try {
      if ("sdp" in d) {
        await this.pc.setRemoteDescription(d.sdp);
        this.haveRemote = true;
        for (const c of this.pending.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === "offer") {
          await this.pc.setLocalDescription();
          this.out({ sdp: this.pc.localDescription!.toJSON() });
        }
      } else if (this.haveRemote) await this.pc.addIceCandidate(d.ice).catch(() => {});
      else this.pending.push(d.ice);
    } catch {
      this.close();
    }
  }

  send(m: Message): void {
    this.dc!.send(JSON.stringify(m));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dc?.close();
    this.pc.close();
    this.onChange();
  }

  private attach(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => this.onChange();
    dc.onclose = () => this.close();
    dc.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)) as Message);
      } catch {
        // not ours
      }
    };
  }
}

abstract class NetNode {
  readonly id: string;
  private subs = new Set<(m: Message) => void>();
  private offSignal: () => void;

  constructor(
    private role: Role,
    protected opts: NetOptions,
  ) {
    this.id = opts.id ?? randomId();
    this.offSignal = opts.signal.subscribe((data) => {
      const env = open(opts.room, data);
      if (!isEnvelope(env) || env.from === this.id || env.role === this.role) return;
      if (env.to && env.to !== this.id) return;
      this.receive(env);
    });
  }

  subscribe(fn: (m: Message) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  close(): void {
    this.offSignal();
  }

  protected abstract receive(env: Envelope): void;

  protected publish(env: Omit<Envelope, "from" | "role">) {
    this.opts.signal.publish(seal(this.opts.room, { ...env, from: this.id, role: this.role }));
  }

  protected deliver(m: Message) {
    for (const fn of this.subs) fn(m);
  }

  protected get ice(): RTCIceServer[] | undefined {
    if (this.opts.ice === false || typeof RTCPeerConnection === "undefined") return undefined;
    return this.opts.ice ?? DEFAULT_ICE;
  }
}

/** Projector side: one entry per phone; messages go over each phone's data channel, else the relay. */
export class NetHost extends NetNode implements Transport {
  private peers = new Map<string, { seen: number; link?: Link }>();
  private remoteSubs = new Set<(r: Remote[]) => void>();
  private lastRemotes = "[]";
  private sweep = setInterval(() => this.expire(), 5_000);

  constructor(opts: NetOptions) {
    super("host", opts);
  }

  send(m: Message): void {
    // relay only when a phone has no open data channel; with no phones, nothing leaves the laptop
    let relay = false;
    for (const p of this.peers.values()) {
      if (p.link?.open) p.link.send(m);
      else relay = true;
    }
    if (relay) this.publish({ msg: m });
  }

  get remotes(): Remote[] {
    return [...this.peers].map(([id, p]) => ({ id, link: p.link?.open ? "p2p" : "relay" }));
  }

  onRemotes(fn: (r: Remote[]) => void): () => void {
    this.remoteSubs.add(fn);
    return () => this.remoteSubs.delete(fn);
  }

  override close(): void {
    clearInterval(this.sweep);
    for (const p of this.peers.values()) p.link?.close();
    super.close();
  }

  protected receive(env: Envelope) {
    let p = this.peers.get(env.from);
    if (!p) this.peers.set(env.from, (p = { seen: 0 }));
    p.seen = Date.now();
    if (env.rtc) this.onRtc(env.from, p, env.rtc);
    if (env.msg) this.deliver(env.msg);
    this.changed();
  }

  private onRtc(id: string, p: { seen: number; link?: Link }, d: RtcData) {
    const ice = this.ice;
    if (!ice) return;
    if ("sdp" in d && d.sdp.type === "offer") {
      p.link?.close();
      const link: Link = new Link(
        ice,
        false,
        (x) => this.publish({ to: id, rtc: x }),
        (m) => {
          p.seen = Date.now();
          this.deliver(m);
        },
        () => {
          if (link.closed && p.link === link) p.link = undefined;
          this.changed();
        },
      );
      p.link = link;
    }
    void p.link?.handle(d);
  }

  private expire() {
    const now = Date.now();
    for (const [id, p] of this.peers) {
      if (now - p.seen <= PEER_TIMEOUT_MS) continue;
      p.link?.close();
      this.peers.delete(id);
    }
    this.changed();
  }

  private changed() {
    const r = this.remotes;
    const json = JSON.stringify(r);
    if (json === this.lastRemotes) return;
    this.lastRemotes = json;
    for (const fn of this.remoteSubs) fn(r);
  }
}

export type PeerStatus = "offline" | "connecting" | "relay" | "p2p";

/** Phone side: talks to whichever projector last spoke in the room; upgrades to WebRTC when it can. */
export class NetPeer extends NetNode implements Transport {
  private host?: string;
  private lastHost = 0;
  private link?: Link;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = RTC_RETRY_MIN;
  private statusSubs = new Set<(s: PeerStatus) => void>();
  private lastStatus: PeerStatus = "offline";
  private heartbeat = setInterval(() => {
    this.send({ kind: "hello" });
    this.changed();
  }, HEARTBEAT_MS);
  private offStatus: () => void;

  constructor(opts: NetOptions) {
    super("peer", opts);
    // (re)connected to the relay: ask for a full snapshot
    this.offStatus = opts.signal.onStatus((up) => {
      if (up) this.send({ kind: "hello" });
      this.changed();
    });
    this.changed();
  }

  send(m: Message): void {
    if (this.link?.open) this.link.send(m);
    // no `to`: a reloaded projector (new id) must still hear the phone
    else this.publish({ msg: m });
  }

  get status(): PeerStatus {
    if (this.link?.open) return "p2p";
    if (!this.opts.signal.open) return "offline";
    if (!this.host || Date.now() - this.lastHost > HOST_TIMEOUT_MS) return "connecting";
    return "relay";
  }

  onStatus(fn: (s: PeerStatus) => void): () => void {
    this.statusSubs.add(fn);
    return () => this.statusSubs.delete(fn);
  }

  /** Test hook: drop the direct connection, as a network change would. */
  dropDirect(): void {
    this.link?.close();
  }

  override close(): void {
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
    this.offStatus();
    this.link?.close();
    super.close();
  }

  protected receive(env: Envelope) {
    if (env.from !== this.host) {
      // first contact, or the projector was reloaded: start over with the new one
      this.host = env.from;
      this.retryDelay = RTC_RETRY_MIN;
      this.restartRtc(0);
    }
    this.lastHost = Date.now();
    if (env.rtc) void this.link?.handle(env.rtc);
    if (env.msg) {
      this.deliver(env.msg);
      // the projector is going away (reload): ask the next one for its state as soon as it is up
      if (env.msg.kind === "bye") for (const ms of [1_000, 3_000]) setTimeout(() => this.send({ kind: "hello" }), ms);
    }
    this.changed();
  }

  private restartRtc(delay: number) {
    clearTimeout(this.retryTimer);
    this.link?.close();
    this.link = undefined;
    const ice = this.ice;
    if (!ice || !this.host) return;
    this.retryTimer = setTimeout(() => this.connectRtc(ice), delay);
  }

  private connectRtc(ice: RTCIceServer[]) {
    const host = this.host!;
    const link: Link = new Link(
      ice,
      true,
      (d) => this.publish({ to: host, rtc: d }),
      (m) => {
        this.lastHost = Date.now();
        this.deliver(m);
      },
      () => {
        if (link !== this.link) return;
        if (link.open) this.retryDelay = RTC_RETRY_MIN;
        else if (link.closed) {
          // dropped or failed: carry on over the relay and try again later
          this.link = undefined;
          this.restartRtc(this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, RTC_RETRY_MAX);
        }
        this.changed();
      },
    );
    this.link = link;
    this.retryTimer = setTimeout(() => !link.open && link.close(), RTC_CONNECT_MS);
  }

  private changed() {
    const s = this.status;
    if (s === this.lastStatus) return;
    this.lastStatus = s;
    for (const fn of this.statusSubs) fn(s);
  }
}
