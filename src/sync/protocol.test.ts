import { describe, expect, it } from "vitest";
import { SyncHost, SyncPeer, memoryBus, type Snapshot, type SyncIntent } from "./protocol.ts";

const snap = (node: string, step = 0): Snapshot => ({ node, step, history: [], overview: false, outgoing: [] });

function setup() {
  const bus = memoryBus();
  const applied: SyncIntent[] = [];
  const host = new SyncHost(bus(), (i) => applied.push(i));
  return { bus, host, applied };
}

describe("sync protocol", () => {
  it("a peer that joins late gets the current state on hello", () => {
    const { bus, host } = setup();
    host.publish(snap("a", 1));
    const peer = new SyncPeer(bus());
    expect(peer.current).toMatchObject({ connected: true, session: host.session, version: 1, state: { node: "a", step: 1 } });
  });

  it("a peer that joins first gets the state when the projector publishes", () => {
    const bus = memoryBus();
    const peer = new SyncPeer(bus());
    expect(peer.current.connected).toBe(false);
    expect(peer.send({ type: "step" })).toBe(false);
    const host = new SyncHost(bus(), () => {});
    host.publish(snap("a"));
    expect(peer.current).toMatchObject({ connected: true, state: { node: "a" } });
  });

  it("publishes only changes, each with a new version", () => {
    const { bus, host } = setup();
    const peer = new SyncPeer(bus());
    const seen: number[] = [];
    peer.subscribe((v) => seen.push(v.version));
    host.publish(snap("a"));
    host.publish(snap("a"));
    host.publish(snap("b"));
    expect(seen).toEqual([1, 2]);
    expect(host.currentVersion).toBe(2);
  });

  it("applies intents issued against the current state", () => {
    const { bus, host, applied } = setup();
    host.publish(snap("a"));
    const peer = new SyncPeer(bus());
    expect(peer.send({ type: "edge", index: 1 })).toBe(true);
    expect(applied).toEqual([{ type: "edge", index: 1 }]);
  });

  it("drops edge intents issued against an older state, but not steps", () => {
    const { bus, host, applied } = setup();
    host.publish(snap("a"));
    const t = bus();
    t.send({ kind: "intent", id: "p:0", session: host.session, version: 1, intent: { type: "step" } });
    host.publish(snap("b"));
    // both issued while the peer still showed version 1
    t.send({ kind: "intent", id: "p:1", session: host.session, version: 1, intent: { type: "step" } });
    t.send({ kind: "intent", id: "p:2", session: host.session, version: 1, intent: { type: "edge", index: 0 } });
    expect(applied).toEqual([{ type: "step" }, { type: "step" }]);
  });

  it("drops replayed intents", () => {
    const { bus, host, applied } = setup();
    host.publish(snap("a"));
    const t = bus();
    const msg = { kind: "intent", id: "p:0", session: host.session, version: 1, intent: { type: "step" } } as const;
    t.send(msg);
    t.send(msg);
    expect(applied).toEqual([{ type: "step" }]);
  });

  it("drops intents from an earlier projector session, without an id, or of unknown type", () => {
    const { bus, host, applied } = setup();
    host.publish(snap("a"));
    const t = bus();
    t.send({ kind: "intent", id: "p:0", session: "old", version: 1, intent: { type: "step" } });
    t.send({ kind: "intent", session: host.session, version: 1, intent: { type: "step" } } as never);
    t.send({ kind: "intent", id: "p:1", session: host.session, version: 1, intent: { type: "explode" } as unknown as SyncIntent });
    expect(applied).toEqual([]);
  });

  it("a reloaded projector (new session) takes over; bye disconnects", () => {
    const bus = memoryBus();
    const first = new SyncHost(bus(), () => {});
    first.publish(snap("a"));
    first.publish(snap("b"));
    const peer = new SyncPeer(bus());
    first.close();
    expect(peer.current.connected).toBe(false);
    const second = new SyncHost(bus(), () => {});
    second.publish(snap("c")); // version 1 again, but a new session
    expect(peer.current).toMatchObject({ connected: true, session: second.session, version: 1, state: { node: "c" } });
  });
});
