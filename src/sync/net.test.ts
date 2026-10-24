// The network transport over an in-memory relay. Node has no WebRTC, so this covers the relay path;
// the direct path is covered end to end in tests/e2e/phone.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSecret, room, seal } from "./crypto.ts";
import { HEARTBEAT_MS, HOST_TIMEOUT_MS, NetHost, NetPeer, PEER_TIMEOUT_MS, type PeerStatus } from "./net.ts";
import { SyncHost, SyncPeer, type Snapshot, type SyncIntent } from "./protocol.ts";
import { memorySignalBus } from "./signal.ts";

const snap = (node: string): Snapshot => ({ node, step: 0, history: [], overview: false, outgoing: [] });

function projector(bus: ReturnType<typeof memorySignalBus>, secret: string) {
  const signal = bus();
  const net = new NetHost({ room: room(secret), signal });
  const applied: SyncIntent[] = [];
  const host = new SyncHost(net, (i) => applied.push(i));
  return { signal, net, host, applied };
}

function phone(bus: ReturnType<typeof memorySignalBus>, secret: string) {
  const signal = bus();
  const net = new NetPeer({ room: room(secret), signal });
  const statuses: PeerStatus[] = [];
  net.onStatus((s) => statuses.push(s));
  const peer = new SyncPeer(net);
  return { signal, net, peer, statuses };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("network transport (relay path)", () => {
  it("a paired phone gets the state and drives the projector", () => {
    const bus = memorySignalBus();
    const secret = newSecret();
    const p = projector(bus, secret);
    p.host.publish(snap("a"));
    const ph = phone(bus, secret);
    expect(ph.peer.current).toMatchObject({ connected: true, state: { node: "a" } });
    expect(ph.net.status).toBe("relay");
    ph.peer.send({ type: "step" });
    ph.peer.send({ type: "pointer", at: [0.5, 0.25] });
    expect(p.applied).toEqual([{ type: "step" }, { type: "pointer", at: [0.5, 0.25] }]);
    p.host.publish(snap("b"));
    expect(ph.peer.current.state?.node).toBe("b");
    expect(p.net.remotes).toEqual([{ id: ph.net.id, link: "relay" }]);
  });

  it("a phone without the room secret gets nothing and cannot drive the projector", () => {
    const bus = memorySignalBus();
    const p = projector(bus, newSecret());
    p.host.publish(snap("a"));
    const intruder = phone(bus, newSecret());
    intruder.peer.send({ type: "step" });
    expect(intruder.peer.current.connected).toBe(false);
    expect(p.applied).toEqual([]);
    expect(p.net.remotes).toEqual([]);

    // nor can someone who forges messages without the key, even knowing the protocol
    const raw = bus();
    raw.publish(JSON.stringify({ from: "x", role: "peer", msg: { kind: "intent", id: "x:0", session: p.host.session, version: 1, intent: { type: "step" } } }));
    raw.publish(seal(room(newSecret()), { from: "x", role: "peer", msg: { kind: "intent", id: "x:1", session: p.host.session, version: 1, intent: { type: "step" } } }));
    expect(p.applied).toEqual([]);
  });

  it("drops replayed intents, also after a reconnect and against a reloaded projector", () => {
    const bus = memorySignalBus();
    const secret = newSecret();
    const p = projector(bus, secret);
    p.host.publish(snap("a"));
    // an eavesdropper on the relay records every sealed message
    const tap = bus();
    const recorded: string[] = [];
    tap.subscribe((d) => recorded.push(d));
    const ph = phone(bus, secret);
    ph.peer.send({ type: "step" });
    expect(p.applied).toHaveLength(1);

    // the projector's relay connection drops and comes back; the recording is replayed
    p.signal.setOpen(false);
    p.signal.setOpen(true);
    for (const d of recorded) tap.publish(d);
    expect(p.applied).toHaveLength(1);

    // a reloaded projector (new session) ignores intents issued against the old one
    p.net.close();
    const p2 = projector(bus, secret);
    p2.host.publish(snap("a"));
    for (const d of recorded) tap.publish(d);
    expect(p2.applied).toEqual([]);
  });

  it("nothing is published while no phone is connected", () => {
    const bus = memorySignalBus();
    const tap = bus();
    const seen: string[] = [];
    tap.subscribe((d) => seen.push(d));
    const p = projector(bus, newSecret());
    p.host.publish(snap("a"));
    p.host.publish(snap("b"));
    expect(seen).toEqual([]);
  });

  it("phones send heartbeats; silent phones are dropped from the projector's list", () => {
    const bus = memorySignalBus();
    const secret = newSecret();
    const p = projector(bus, secret);
    p.host.publish(snap("a"));
    const ph = phone(bus, secret);
    vi.advanceTimersByTime(PEER_TIMEOUT_MS + 5_000);
    expect(p.net.remotes).toHaveLength(1); // heartbeats kept it

    ph.signal.setOpen(false); // the phone loses its connection
    vi.advanceTimersByTime(PEER_TIMEOUT_MS + 10_000);
    expect(p.net.remotes).toEqual([]);
    expect(ph.net.status).toBe("offline");
  });

  it("phone status: offline → relay; connecting again when the projector goes quiet", () => {
    const bus = memorySignalBus();
    const secret = newSecret();
    const ph = phone(bus, secret);
    expect(ph.net.status).toBe("connecting"); // relay up, no projector yet
    ph.signal.setOpen(false);
    expect(ph.net.status).toBe("offline");
    ph.signal.setOpen(true);

    const p = projector(bus, secret);
    p.host.publish(snap("a"));
    vi.advanceTimersByTime(HEARTBEAT_MS); // the phone's heartbeat reaches the projector, which answers
    expect(ph.net.status).toBe("relay");
    expect(ph.peer.current.state?.node).toBe("a");

    p.net.close();
    vi.advanceTimersByTime(HOST_TIMEOUT_MS + HEARTBEAT_MS);
    expect(ph.net.status).toBe("connecting");
    expect(ph.statuses).toEqual(["offline", "connecting", "relay", "connecting"]); // subscribed after the initial "connecting"
  });

  it("follows a reloaded projector", () => {
    const bus = memorySignalBus();
    const secret = newSecret();
    const p = projector(bus, secret);
    p.host.publish(snap("a"));
    const ph = phone(bus, secret);
    p.host.close(); // sends bye
    p.net.close();
    expect(ph.peer.current.connected).toBe(false);

    const p2 = projector(bus, secret);
    p2.host.publish(snap("b"));
    vi.advanceTimersByTime(1_000); // the phone re-says hello after a bye
    expect(ph.peer.current).toMatchObject({ connected: true, session: p2.host.session, state: { node: "b" } });
    ph.peer.send({ type: "step" });
    expect(p2.applied).toEqual([{ type: "step" }]);
  });
});
