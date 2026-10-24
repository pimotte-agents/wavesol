# wavesol relay on Cloudflare

An optional, self-hosted relay for the phone controller. By default a phone finds the projector through
public MQTT brokers and Nostr relays; use this Worker instead when you want a relay you control, or
when a venue's firewall blocks the public brokers' ports (the Worker listens on 443).

It speaks the same protocol as the local relay of `wavesol serve`: a WebSocket at `/<room>`, and every
message is passed to the other sockets in that room. Messages are sealed end to end with the room
secret from the QR code, so the relay only ever forwards ciphertext. Each room is a Durable Object;
nothing is stored.

## Deploy

You need a free Cloudflare account. From this folder:

```sh
npx wrangler login
npx wrangler deploy
```

Wrangler prints the Worker's URL, e.g. `https://wavesol-relay.<you>.workers.dev`. The free plan
covers a talk comfortably (Durable Objects with SQLite storage are included; usage is a few messages
per click).

## Use it in a talk

In `talk.yaml`:

```yaml
sync:
  relays: ["room:wss://wavesol-relay.<you>.workers.dev"]
```

This replaces the public relays. To keep them as well (the phone uses whichever works), list them too:

```yaml
sync:
  relays:
    - "room:wss://wavesol-relay.<you>.workers.dev"
    - "mqtt:wss://broker.hivemq.com:8884/mqtt"
    - "nostr:wss://nos.lol"
```

## Check it

From the wavesol repository: `npx tsx scripts/smoke-relays.ts room:wss://wavesol-relay.<you>.workers.dev`
connects two clients and checks that each receives the other's message. Locally,
`npx wrangler dev` serves the Worker at `ws://localhost:8787` for the same check.
