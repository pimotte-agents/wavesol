// Manual smoke test of the public relays (not run in CI): for each relay, two clients join a fresh
// room and must receive each other's message. Usage: npx tsx scripts/smoke-relays.ts [relay ...]
// Relays are given as in talk.yaml (`mqtt:wss://…`, `nostr:wss://…`, `room:wss://…`); default: the
// built-in list.
import { DEFAULT_RELAYS, signalFor } from "../src/sync/relays.ts";
import { newSecret, room } from "../src/sync/crypto.ts";

const relays = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_RELAYS;
const TIMEOUT = 10_000;

async function check(relay: string): Promise<string> {
  const { topic } = room(newSecret());
  const a = signalFor(relay, topic);
  const b = signalFor(relay, topic);
  const t0 = Date.now();
  try {
    const got = (s: typeof a, expect: string) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT);
        s.subscribe((d) => d === expect && (clearTimeout(timer), resolve()));
      });
    const ready = (s: typeof a) => new Promise<void>((r) => (s.open ? r() : s.onStatus((o) => o && r())));
    await Promise.race([Promise.all([ready(a), ready(b)]), new Promise((_, rej) => setTimeout(() => rej(new Error("connect timeout")), TIMEOUT))]);
    // subscriptions can take a moment to become active on the relay
    await new Promise((r) => setTimeout(r, 500));
    const ab = got(b, "ping-from-a");
    const ba = got(a, "ping-from-b");
    a.publish("ping-from-a");
    b.publish("ping-from-b");
    await Promise.all([ab, ba]);
    return `ok   ${relay} (${Date.now() - t0} ms)`;
  } catch (e) {
    process.exitCode = 1;
    return `FAIL ${relay}: ${(e as Error).message}`;
  } finally {
    a.close();
    b.close();
  }
}

for (const line of await Promise.all(relays.map(check))) console.log(line);
