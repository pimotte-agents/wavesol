import { describe, expect, it } from "vitest";
import { memoryBus, type Transport } from "./protocol.ts";
import { PollHost, Voter, type AudienceMessage, type PollView } from "./audience.ts";

const poll = (id: string, n = 3): PollView => ({ id, question: `<p>${id}?</p>`, options: Array.from({ length: n }, (_, i) => `option ${i}`) });

function setup(store?: Map<string, string>) {
  const bus = memoryBus() as unknown as () => Transport<AudienceMessage>;
  const host = new PollHost(bus(), store && { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) });
  return { bus, host };
}

describe("audience polls", () => {
  it("a voter sees the open poll, votes, and the projector counts it", () => {
    const { bus, host } = setup();
    host.open(poll("p"));
    const v = new Voter(bus(), "v1");
    expect(v.current.poll?.id).toBe("p");
    v.vote(2);
    expect(host.results("p")).toEqual({ counts: [0, 0, 1], total: 1 });
    expect(v.current.mine).toBe(2);
  });

  it("one vote per voter; voting again moves it", () => {
    const { bus, host } = setup();
    host.open(poll("p"));
    const a = new Voter(bus(), "a");
    const b = new Voter(bus(), "b");
    a.vote(0);
    b.vote(0);
    a.vote(1);
    expect(host.results("p")).toEqual({ counts: [1, 1, 0], total: 2 });
  });

  it("votes count only for the poll on screen, and only valid options", () => {
    const { bus, host } = setup();
    const raw = bus();
    host.open(poll("p"));
    raw.send({ kind: "vote", voter: "x", poll: "other", option: 0 });
    raw.send({ kind: "vote", voter: "x", poll: "p", option: 7 });
    raw.send({ kind: "vote", voter: "x", poll: "p", option: -1 });
    raw.send({ kind: "vote", voter: "", poll: "p", option: 0 });
    expect(host.results("p").total).toBe(0);
    host.open(undefined); // the projector moved on
    raw.send({ kind: "vote", voter: "x", poll: "p", option: 0 });
    expect(host.results("p").total).toBe(0);
  });

  it("voters see the poll close and reopen; their vote is remembered", () => {
    const { bus, host } = setup();
    host.open(poll("p"));
    const v = new Voter(bus(), "v");
    v.vote(1);
    host.open(undefined);
    expect(v.current.poll).toBeUndefined();
    host.open(poll("p"));
    expect(v.current).toMatchObject({ poll: { id: "p" }, mine: 1 });
  });

  it("a reloaded phone (same voter id) gets its vote back", () => {
    const { bus, host } = setup();
    host.open(poll("p"));
    new Voter(bus(), "v").vote(2);
    const again = new Voter(bus(), "v");
    expect(again.current.mine).toBe(2);
    expect(host.results("p").total).toBe(1);
  });

  it("votes survive a projector reload", () => {
    const store = new Map<string, string>();
    const first = setup(store);
    first.host.open(poll("p"));
    new Voter(first.bus(), "v").vote(0);
    const second = setup(store);
    expect(second.host.results("p")).toEqual({ counts: [1, 0, 0], total: 1 });
  });

  it("reports changes to listeners", () => {
    const { bus, host } = setup();
    const seen: number[] = [];
    host.onChange(() => seen.push(host.results("p").total));
    host.open(poll("p"));
    new Voter(bus(), "v").vote(0);
    expect(seen.at(-1)).toBe(1);
  });
});
