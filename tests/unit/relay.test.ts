// The local relay of `wavesol serve`/`dev`, driven by the same RoomSignal client the browser uses.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { attachRelay, createRelay, type Relay } from "../../src/cli/relay.ts";
import { RoomSignal, type Signal } from "../../src/sync/signal.ts";

let server: Server;
let relay: Relay;
let origin: string;

beforeAll(async () => {
  relay = createRelay("/talk/", () => ({ lan: ["http://192.0.2.1:4173"] }));
  server = createServer((req, res) => {
    if (!relay.handleRequest(req, res)) res.writeHead(404).end();
  });
  attachRelay(server, relay);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  relay.close();
  server.close();
});

const ready = (s: Signal) => new Promise<void>((r) => (s.open ? r() : s.onStatus((o) => o && r())));
const next = (s: Signal) => new Promise<string>((r) => s.subscribe(r));
const base = () => `ws://${origin}/talk/__wavesol/relay`;

describe("local relay", () => {
  it("passes messages to the other members of a room only", async () => {
    const a = new RoomSignal(base(), "aaaa1111");
    const b = new RoomSignal(base(), "aaaa1111");
    const c = new RoomSignal(base(), "bbbb2222");
    await Promise.all([a, b, c].map(ready));
    const gotA: string[] = [];
    const gotC: string[] = [];
    a.subscribe((d) => gotA.push(d));
    c.subscribe((d) => gotC.push(d));
    const atB = next(b);
    a.publish("hello");
    expect(await atB).toBe("hello");
    await new Promise((r) => setTimeout(r, 50));
    expect(gotA).toEqual([]); // not echoed to the sender
    expect(gotC).toEqual([]); // other rooms see nothing
    [a, b, c].forEach((s) => s.close());
  });

  it("clients reconnect after the relay drops them, and messages flow again", async () => {
    const a = new RoomSignal(base(), "cccc3333");
    const b = new RoomSignal(base(), "cccc3333");
    await Promise.all([a, b].map(ready));
    const down = [a, b].map((s) => new Promise<void>((r) => s.onStatus((o) => !o && r())));
    relay.dropAll();
    await Promise.all(down);
    await Promise.all([a, b].map(ready));
    const atB = next(b);
    a.publish("again");
    expect(await atB).toBe("again");
    [a, b].forEach((s) => s.close());
  });

  it("serves serve.json under the talk's prefix", async () => {
    const res = await fetch(`http://${origin}/talk/__wavesol/serve.json`);
    expect(await res.json()).toEqual({ relay: "__wavesol/relay", lan: ["http://192.0.2.1:4173"] });
    expect((await fetch(`http://${origin}/other/__wavesol/serve.json`)).status).toBe(404);
  });

  it("refuses malformed room names", async () => {
    const s = new RoomSignal(`ws://${origin}/talk/__wavesol/relay`, "../etc");
    await new Promise((r) => setTimeout(r, 300));
    expect(s.open).toBe(false);
    s.close();
  });
});
