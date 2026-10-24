// Signals: pub/sub on one room topic over some relay network. They carry WebRTC signaling and, until
// (or instead of) a direct connection, the sealed messages themselves. Payloads are opaque strings
// (already sealed); a signal only moves them. Each client reconnects on its own.

export interface Signal {
  readonly name: string;
  /** True while connected to the relay. */
  readonly open: boolean;
  publish(data: string): void;
  subscribe(fn: (data: string) => void): () => void;
  onStatus(fn: (open: boolean) => void): () => void;
  close(): void;
}

type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocket;

const MIN_RETRY = 500;
const MAX_RETRY = 15_000;
/** Messages published while (re)connecting are queued, up to this many. */
const QUEUE_LIMIT = 50;

/**
 * Shared WebSocket lifecycle: connect, reconnect with backoff, queue while down. Subclasses frame
 * messages for their relay protocol in `onOpen`, `onData` and `deliver`.
 */
export abstract class SocketSignal implements Signal {
  private ws?: WebSocket;
  private retry = MIN_RETRY;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private ready = false;
  private queue: string[] = [];
  private subs = new Set<(data: string) => void>();
  private statusSubs = new Set<(open: boolean) => void>();

  constructor(
    readonly name: string,
    private url: string,
    private protocols?: string | string[],
    private WS: WebSocketCtor = globalThis.WebSocket,
  ) {}

  /** Call once the subclass is fully constructed. */
  protected start() {
    this.connect();
  }

  get open(): boolean {
    return this.ready;
  }

  publish(data: string): void {
    if (this.ready) this.deliver(data);
    else if (!this.closed) {
      this.queue.push(data);
      if (this.queue.length > QUEUE_LIMIT) this.queue.shift();
    }
  }

  subscribe(fn: (data: string) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  onStatus(fn: (open: boolean) => void): () => void {
    this.statusSubs.add(fn);
    return () => this.statusSubs.delete(fn);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.onClose();
    this.ws?.close();
    this.setReady(false);
  }

  /** Socket is open: send the protocol's handshake; call `markReady()` once messages can flow. */
  protected abstract onOpen(): void;
  /** A frame arrived from the relay. */
  protected abstract onData(data: string | ArrayBuffer): void;
  /** Sends one published message, framed for the relay. */
  protected abstract deliver(data: string): void;
  /** Hook for timers etc. when the socket goes away. */
  protected onClose(): void {}

  protected send(frame: string | Uint8Array) {
    if (this.ws?.readyState === 1) this.ws.send(frame as string);
  }

  protected emit(data: string) {
    for (const fn of this.subs) fn(data);
  }

  protected markReady() {
    this.retry = MIN_RETRY;
    this.setReady(true);
    const queued = this.queue.splice(0);
    for (const d of queued) this.deliver(d);
  }

  /** Drops the connection and reconnects (e.g. after a protocol error). */
  protected reconnect() {
    this.ws?.close();
  }

  private setReady(on: boolean) {
    if (on === this.ready) return;
    this.ready = on;
    for (const fn of this.statusSubs) fn(on);
  }

  private connect() {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new this.WS(this.url, this.protocols);
    } catch {
      return this.scheduleRetry();
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => this.onOpen();
    ws.onmessage = (e) => this.onData(e.data as string | ArrayBuffer);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.onClose();
      this.setReady(false);
      this.scheduleRetry();
    };
    // an error is always followed by close, which reconnects; closing here can recurse while connecting
    ws.onerror = () => {};
  }

  private scheduleRetry() {
    if (this.closed) return;
    const wait = this.retry * (0.75 + Math.random() / 2);
    this.retry = Math.min(this.retry * 2, MAX_RETRY);
    this.timer = setTimeout(() => this.connect(), wait);
  }
}

/**
 * The plain room protocol: a WebSocket at `<base>/<topic>`; every text frame is passed to the other
 * sockets in the room. Spoken by the local relay of `wavesol serve`/`dev`, the self-hosted Cloudflare
 * Worker and the test stub.
 */
export class RoomSignal extends SocketSignal {
  constructor(base: string, topic: string, WS?: WebSocketCtor) {
    super(`room ${base}`, `${base.replace(/\/+$/, "")}/${topic}`, undefined, WS);
    this.start();
  }
  protected onOpen() {
    this.markReady();
  }
  protected onData(data: string | ArrayBuffer) {
    if (typeof data === "string") this.emit(data);
  }
  protected deliver(data: string) {
    this.send(data);
  }
}

const SEEN_LIMIT = 2000;

/** Several signals as one: publishes on all, delivers each distinct message once. */
export class MultiSignal implements Signal {
  readonly name: string;
  private seen = new Set<string>();
  private subs = new Set<(data: string) => void>();
  private statusSubs = new Set<(open: boolean) => void>();
  private wasOpen = false;

  constructor(readonly signals: Signal[]) {
    this.name = signals.map((s) => s.name).join(", ");
    for (const s of signals) {
      s.subscribe((d) => {
        // the same sealed message arrives once per network (and our own publishes may echo back)
        if (this.seen.has(d)) return;
        this.seen.add(d);
        if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value!);
        for (const fn of this.subs) fn(d);
      });
      s.onStatus(() => {
        if (this.open === this.wasOpen) return;
        this.wasOpen = this.open;
        for (const fn of this.statusSubs) fn(this.wasOpen);
      });
    }
  }

  get open(): boolean {
    return this.signals.some((s) => s.open);
  }

  publish(data: string): void {
    this.seen.add(data); // don't deliver our own message when a relay echoes it
    for (const s of this.signals) s.publish(data);
  }

  subscribe(fn: (data: string) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  onStatus(fn: (open: boolean) => void): () => void {
    this.statusSubs.add(fn);
    return () => this.statusSubs.delete(fn);
  }

  close(): void {
    for (const s of this.signals) s.close();
  }
}

/** In-memory relay network for tests: signals created from one bus share a room. */
export function memorySignalBus() {
  const members = new Set<MemorySignal>();
  class MemorySignal implements Signal {
    readonly name = "memory";
    open = true;
    private subs = new Set<(data: string) => void>();
    private statusSubs = new Set<(open: boolean) => void>();
    constructor() {
      members.add(this);
    }
    publish(data: string) {
      if (!this.open) return;
      for (const m of members) if (m !== this && m.open) for (const fn of m.subs) fn(data);
    }
    subscribe(fn: (data: string) => void) {
      this.subs.add(fn);
      return () => this.subs.delete(fn);
    }
    onStatus(fn: (open: boolean) => void) {
      this.statusSubs.add(fn);
      return () => this.statusSubs.delete(fn);
    }
    /** Test hook: simulate the relay connection dropping or coming back. */
    setOpen(on: boolean) {
      this.open = on;
      for (const fn of this.statusSubs) fn(on);
    }
    close() {
      this.setOpen(false);
      members.delete(this);
    }
  }
  return () => new MemorySignal();
}
