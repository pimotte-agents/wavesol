// Audience polls. The audience has its own room (secret and topic), separate from the phone
// controller's: its QR code is shown to everyone, so in this room the projector only accepts votes.
// The projector (PollHost) tells phones which poll is on screen and counts one vote per voter;
// phones (Voter) show the poll and their own vote. Transport-agnostic: the network transport carries
// these messages in the audience room.
import type { Transport } from "./protocol.ts";

export interface PollView {
  /** The poll node's id. */
  id: string;
  /** Question and options as HTML (from the build). */
  question: string;
  options: string[];
}

export type AudienceMessage =
  /** phone → projector: what is on? (`voter`: and what did I vote?) */
  | { kind: "hello"; voter?: string }
  | { kind: "vote"; voter: string; poll: string; option: number }
  /** projector → phones: the poll on screen, if any */
  | { kind: "poll"; poll?: PollView }
  /** projector → phones: a voter's recorded vote (each phone keeps its own) */
  | { kind: "voted"; voter: string; poll: string; option: number };

export interface Results {
  counts: number[];
  total: number;
}

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const STORE_KEY = "wavesol:poll-votes";

/** Projector side. */
export class PollHost {
  private current?: PollView;
  private options = new Map<string, number>();
  /** poll id → voter → option */
  private votes = new Map<string, Map<string, number>>();
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;

  constructor(
    private transport: Transport<AudienceMessage>,
    private store?: KeyValueStore,
  ) {
    try {
      const saved = JSON.parse(store?.get(STORE_KEY) ?? "{}") as { votes?: Record<string, Record<string, number>>; options?: Record<string, number> };
      for (const [poll, byVoter] of Object.entries(saved.votes ?? {})) this.votes.set(poll, new Map(Object.entries(byVoter)));
      for (const [poll, n] of Object.entries(saved.options ?? {})) this.options.set(poll, n);
    } catch {
      // start without
    }
    this.unsubscribe = transport.subscribe((m) => this.receive(m));
  }

  /** The poll now on screen (undefined: none); phones follow. */
  open(poll: PollView | undefined): void {
    if (poll?.id === this.current?.id) return;
    this.current = poll;
    if (poll) this.options.set(poll.id, poll.options.length);
    this.transport.send({ kind: "poll", ...(poll ? { poll } : {}) });
    this.emit();
  }

  results(poll: string): Results {
    const n = this.options.get(poll) ?? 0;
    const counts = Array.from({ length: n }, () => 0);
    for (const option of this.votes.get(poll)?.values() ?? []) if (option < n) counts[option]!++;
    return { counts, total: counts.reduce((a, b) => a + b, 0) };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.unsubscribe();
    this.transport.close();
  }

  private receive(m: AudienceMessage) {
    if (m.kind === "hello") {
      this.transport.send({ kind: "poll", ...(this.current ? { poll: this.current } : {}) });
      const poll = this.current?.id;
      const mine = poll !== undefined && m.voter ? this.votes.get(poll)?.get(m.voter) : undefined;
      if (poll !== undefined && mine !== undefined) this.transport.send({ kind: "voted", voter: m.voter!, poll, option: mine });
    } else if (m.kind === "vote") {
      const poll = this.current;
      // only the poll on screen, only its options, only with a voter id
      if (!poll || m.poll !== poll.id || typeof m.voter !== "string" || !m.voter) return;
      if (!Number.isInteger(m.option) || m.option < 0 || m.option >= poll.options.length) return;
      let byVoter = this.votes.get(poll.id);
      if (!byVoter) this.votes.set(poll.id, (byVoter = new Map()));
      byVoter.set(m.voter, m.option);
      this.save();
      this.transport.send({ kind: "voted", voter: m.voter, poll: poll.id, option: m.option });
      this.emit();
    }
  }

  private save() {
    const votes: Record<string, Record<string, number>> = {};
    for (const [poll, byVoter] of this.votes) votes[poll] = Object.fromEntries(byVoter);
    try {
      this.store?.set(STORE_KEY, JSON.stringify({ votes, options: Object.fromEntries(this.options) }));
    } catch {
      // not kept across a reload
    }
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export interface VoterView {
  poll?: PollView;
  /** This phone's vote in the open poll. */
  mine?: number;
}

/** Phone side. `voterId` should stay the same across reloads (one vote per phone). */
export class Voter {
  private view: VoterView = {};
  private mine = new Map<string, number>();
  private listeners = new Set<(v: VoterView) => void>();
  private unsubscribe: () => void;

  constructor(
    private transport: Transport<AudienceMessage>,
    readonly voterId: string,
  ) {
    this.unsubscribe = transport.subscribe((m) => this.receive(m));
    transport.send({ kind: "hello", voter: voterId });
  }

  get current(): VoterView {
    return this.view;
  }

  vote(option: number): void {
    const poll = this.view.poll;
    if (!poll) return;
    this.transport.send({ kind: "vote", voter: this.voterId, poll: poll.id, option });
  }

  subscribe(fn: (v: VoterView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.unsubscribe();
    this.transport.close();
  }

  private receive(m: AudienceMessage) {
    if (m.kind === "poll") this.set({ poll: m.poll, mine: m.poll ? this.mine.get(m.poll.id) : undefined });
    else if (m.kind === "voted" && m.voter === this.voterId) {
      this.mine.set(m.poll, m.option);
      if (this.view.poll?.id === m.poll) this.set({ ...this.view, mine: m.option });
    }
  }

  private set(v: VoterView) {
    this.view = v;
    for (const fn of this.listeners) fn(v);
  }
}
