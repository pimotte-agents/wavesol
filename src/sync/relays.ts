// Relay configuration: `talk.yaml` lists relays as `<protocol>:<url>`; these turn into signals.
import { MqttSignal } from "./mqtt.ts";
import { NostrSignal } from "./nostr.ts";
import { MultiSignal, RoomSignal, type Signal } from "./signal.ts";

/**
 * Public relays used when talk.yaml lists none: two independent networks, so one being down or
 * blocked doesn't stop the phone. Nostr relays listen on 443, which strict networks rarely block.
 */
export const DEFAULT_RELAYS = [
  "mqtt:wss://broker.hivemq.com:8884/mqtt",
  "mqtt:wss://broker.emqx.io:8084/mqtt",
  "mqtt:wss://test.mosquitto.org:8081/mqtt",
  "nostr:wss://nos.lol",
  "nostr:wss://nostr.mom",
  "nostr:wss://relay.snort.social",
];

export const RELAY_PROTOCOLS = ["mqtt", "nostr", "room"] as const;

export function parseRelay(spec: string): { protocol: (typeof RELAY_PROTOCOLS)[number]; url: string } | undefined {
  const m = spec.match(/^(mqtt|nostr|room):(wss?:\/\/.+)$/);
  return m ? { protocol: m[1] as "mqtt", url: m[2]! } : undefined;
}

export function signalFor(spec: string, topic: string): Signal {
  const r = parseRelay(spec);
  if (!r) throw new Error(`bad relay "${spec}": expected mqtt:, nostr: or room: followed by a ws(s):// URL`);
  if (r.protocol === "mqtt") return new MqttSignal(r.url, topic);
  if (r.protocol === "nostr") return new NostrSignal(r.url, topic);
  return new RoomSignal(r.url, topic);
}

export function signalForAll(specs: string[], topic: string): Signal {
  return new MultiSignal(specs.map((s) => signalFor(s, topic)));
}
