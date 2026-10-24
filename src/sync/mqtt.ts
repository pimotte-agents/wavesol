// Minimal MQTT 3.1.1 over WebSocket for public brokers: CONNECT, SUBSCRIBE and PUBLISH at QoS 0, plus
// keep-alive pings. Enough to use a broker as a pub/sub relay; nothing is retained or persisted.
import { SocketSignal } from "./signal.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const KEEPALIVE_S = 30;

export const PacketType = {
  Connect: 1,
  ConnAck: 2,
  Publish: 3,
  Subscribe: 8,
  SubAck: 9,
  PingReq: 12,
  PingResp: 13,
  Disconnect: 14,
} as const;

export interface Packet {
  type: number;
  flags: number;
  body: Uint8Array;
}

function remainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function str(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 0xff, ...b];
}

function packet(first: number, body: ArrayLike<number>): Uint8Array {
  const len = remainingLength(body.length);
  const out = new Uint8Array(1 + len.length + body.length);
  out[0] = first;
  out.set(len, 1);
  out.set(body as ArrayLike<number>, 1 + len.length);
  return out;
}

export function encodeConnect(clientId: string, keepAlive = KEEPALIVE_S): Uint8Array {
  // protocol "MQTT", level 4 (3.1.1), flags: clean session
  return packet(PacketType.Connect << 4, [...str("MQTT"), 4, 0x02, keepAlive >> 8, keepAlive & 0xff, ...str(clientId)]);
}

export function encodeSubscribe(packetId: number, topic: string): Uint8Array {
  return packet((PacketType.Subscribe << 4) | 0x02, [packetId >> 8, packetId & 0xff, ...str(topic), 0]);
}

export function encodePublish(topic: string, payload: string): Uint8Array {
  const t = str(topic);
  const p = enc.encode(payload);
  const body = new Uint8Array(t.length + p.length);
  body.set(t);
  body.set(p, t.length);
  return packet(PacketType.Publish << 4, body);
}

export const PINGREQ = Uint8Array.of(PacketType.PingReq << 4, 0);
export const DISCONNECT = Uint8Array.of(PacketType.Disconnect << 4, 0);

/** Splits a byte stream into packets; WebSocket frames may hold several packets or part of one. */
export class PacketReader {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Packet[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    const out: Packet[] = [];
    for (;;) {
      if (this.buf.length < 2) break;
      let len = 0;
      let mult = 1;
      let i = 1;
      let complete = false;
      for (; i < this.buf.length && i <= 4; i++) {
        len += (this.buf[i]! & 0x7f) * mult;
        mult *= 128;
        if (!(this.buf[i]! & 0x80)) {
          complete = true;
          break;
        }
      }
      if (!complete) {
        if (i > 4) throw new Error("malformed remaining length");
        break;
      }
      const start = i + 1;
      if (this.buf.length < start + len) break;
      out.push({ type: this.buf[0]! >> 4, flags: this.buf[0]! & 0x0f, body: this.buf.slice(start, start + len) });
      this.buf = this.buf.slice(start + len);
    }
    return out;
  }
}

export function decodePublish(p: Packet): { topic: string; payload: string } {
  const tlen = (p.body[0]! << 8) | p.body[1]!;
  const topic = dec.decode(p.body.subarray(2, 2 + tlen));
  const qos = (p.flags >> 1) & 0x03;
  const payloadStart = 2 + tlen + (qos > 0 ? 2 : 0);
  return { topic, payload: dec.decode(p.body.subarray(payloadStart)) };
}

/** A public MQTT broker as a signal; the room topic becomes `wavesol/<topic>`. */
export class MqttSignal extends SocketSignal {
  private topic: string;
  private reader = new PacketReader();
  private ping?: ReturnType<typeof setInterval>;

  constructor(url: string, topic: string, WS?: new (url: string, protocols?: string | string[]) => WebSocket) {
    super(`mqtt ${url}`, url, "mqtt", WS);
    this.topic = `wavesol/${topic}`;
    this.start();
  }

  protected onOpen() {
    this.reader = new PacketReader();
    this.send(encodeConnect(`wavesol-${Math.random().toString(36).slice(2, 12)}`));
  }

  protected onData(data: string | ArrayBuffer) {
    if (typeof data === "string") return;
    let packets: Packet[];
    try {
      packets = this.reader.push(new Uint8Array(data));
    } catch {
      return this.reconnect();
    }
    for (const p of packets) {
      if (p.type === PacketType.ConnAck) {
        if (p.body[1] !== 0) return this.reconnect(); // refused
        this.send(encodeSubscribe(1, this.topic));
      } else if (p.type === PacketType.SubAck) {
        if (p.body[2] === 0x80) return this.reconnect(); // subscription refused
        clearInterval(this.ping);
        this.ping = setInterval(() => this.send(PINGREQ), (KEEPALIVE_S * 1000) / 2);
        this.markReady();
      } else if (p.type === PacketType.Publish) {
        const { topic, payload } = decodePublish(p);
        if (topic === this.topic) this.emit(payload);
      }
    }
  }

  protected deliver(data: string) {
    this.send(encodePublish(this.topic, data));
  }

  protected override onClose() {
    clearInterval(this.ping);
  }
}
