// Nostr relay as a signal: ephemeral events (kinds 20000–29999 are forwarded to live subscribers and
// never stored), tagged with the room topic and signed with a throwaway key, as relays require valid
// signatures. The content is the sealed message; the signature only satisfies the relay.
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { SocketSignal } from "./signal.ts";

export const EVENT_KIND = 25871;
const TAG = "x";

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Builds and signs an event (NIP-01: id = sha256 of the serialized event, BIP-340 signature). */
export function signEvent(secretKey: Uint8Array, kind: number, tags: string[][], content: string, createdAt = Math.floor(Date.now() / 1000)): NostrEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
  const id = sha256(utf8ToBytes(JSON.stringify([0, pubkey, createdAt, kind, tags, content])));
  return { id: bytesToHex(id), pubkey, created_at: createdAt, kind, tags, content, sig: bytesToHex(schnorr.sign(id, secretKey)) };
}

/** Seconds the clock offset moves per rejection; relays accept roughly ±60 s for ephemeral events. */
const SKEW_STEP = 45;
const MAX_TRIES = 12;

export class NostrSignal extends SocketSignal {
  private key = schnorr.utils.randomSecretKey();
  private sub = `ws${Math.random().toString(36).slice(2, 10)}`;
  /**
   * Correction for this device's clock. Relays reject ephemeral events whose timestamp is too far from
   * their clock ("expired"/"future"), so a device a few minutes off would never get through; on such a
   * rejection the offset moves a step and the event is resent.
   */
  private offset = 0;
  private pending = new Map<string, { content: string; tries: number }>();

  constructor(
    url: string,
    private topic: string,
    WS?: new (url: string, protocols?: string | string[]) => WebSocket,
  ) {
    super(`nostr ${url}`, url, undefined, WS);
    this.start();
  }

  protected onOpen() {
    // no `since`: ephemeral events are never stored, and a skewed clock would filter out live ones
    this.send(JSON.stringify(["REQ", this.sub, { kinds: [EVENT_KIND], [`#${TAG}`]: [this.topic] }]));
    this.markReady();
  }

  protected onData(data: string | ArrayBuffer) {
    if (typeof data !== "string") return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) return;
    if (msg[0] === "OK") return this.onOk(String(msg[1]), msg[2] === true, String(msg[3] ?? ""));
    if (msg[0] !== "EVENT" || msg[1] !== this.sub) return;
    const ev = msg[2] as Partial<NostrEvent> | undefined;
    if (ev?.kind !== EVENT_KIND || typeof ev.content !== "string") return;
    if (!ev.tags?.some((t) => t[0] === TAG && t[1] === this.topic)) return;
    this.emit(ev.content);
  }

  protected deliver(data: string, tries = 0) {
    const ev = signEvent(this.key, EVENT_KIND, [[TAG, this.topic]], data, Math.floor(Date.now() / 1000) + this.offset);
    this.pending.set(ev.id, { content: data, tries });
    if (this.pending.size > 100) this.pending.delete(this.pending.keys().next().value!);
    this.send(JSON.stringify(["EVENT", ev]));
  }

  private onOk(id: string, accepted: boolean, reason: string) {
    const p = this.pending.get(id);
    this.pending.delete(id);
    if (accepted || !p || p.tries >= MAX_TRIES) return;
    if (/future|ahead/i.test(reason)) this.offset -= SKEW_STEP;
    else if (/expired|too old|past|created_at/i.test(reason)) this.offset += SKEW_STEP;
    else return; // rejected for another reason (rate limit, policy): don't retry
    this.deliver(p.content, p.tries + 1);
  }
}
