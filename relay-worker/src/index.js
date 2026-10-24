// wavesol relay on Cloudflare Workers: the room protocol of `wavesol serve`'s local relay. A phone and
// the projector open a WebSocket at /<topic>; every text message is passed to the other sockets in the
// same room. One Durable Object per room. Messages are sealed end to end with the room secret, so the
// relay never sees what it forwards. Deploy guide: README.md next to this folder's wrangler.toml.
/* global WebSocketPair -- provided by the Workers runtime */

const MAX_MESSAGE = 64 * 1024;
const MAX_PER_ROOM = 64;

export default {
  async fetch(request, env) {
    const topic = new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "";
    if (request.headers.get("Upgrade") !== "websocket") return new Response("wavesol relay\n");
    if (!/^[0-9a-f]{8,64}$/.test(topic)) return new Response("bad room\n", { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(topic)).fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch() {
    if (this.state.getWebSockets().length >= MAX_PER_ROOM) return new Response("room full\n", { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    // hibernation API: the object can sleep between messages without dropping the sockets
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MESSAGE) return;
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      try {
        other.send(message);
      } catch {
        // closing; the runtime cleans it up
      }
    }
  }

  webSocketClose(ws, code) {
    try {
      ws.close(code === 1005 ? 1000 : code);
    } catch {
      // already closed
    }
  }
}
