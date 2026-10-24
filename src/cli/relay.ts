// Local relay for `wavesol serve` / `dev`: the room protocol (WebSocket at <prefix>__wavesol/relay/<topic>,
// text frames passed to the other sockets in the room), so a phone on the same network needs no
// internet. Also serves <prefix>__wavesol/serve.json, which tells the page it can use this relay and
// which LAN addresses a phone can reach. Messages are sealed end to end; the relay only forwards them.
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

export const RELAY_PATH = "__wavesol/relay";
export const SERVE_INFO_PATH = "__wavesol/serve.json";
const MAX_MESSAGE = 64 * 1024;
const MAX_PER_ROOM = 64;

export interface ServeInfo {
  /** Relay base, relative to the page. */
  relay: string;
  /** Origins a phone on the LAN can load the talk from (empty when listening on localhost only). */
  lan: string[];
}

export interface Relay {
  /** Takes over a WebSocket upgrade for the relay path; false if the request is not for the relay. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /** Answers serve.json; false if the request is not for it. */
  handleRequest(req: IncomingMessage, res: ServerResponse): boolean;
  /** Disconnects every client (they reconnect); for tests. */
  dropAll(): void;
  close(): void;
}

export function lanOrigins(port: number): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i!.address}:${port}`);
}

/** `prefix` is the URL path the talk is served under ("/" or e.g. "/talk/"). */
export function createRelay(prefix: string, info: () => Omit<ServeInfo, "relay">): Relay {
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  const rooms = new Map<string, Set<WebSocket>>();
  const path = (req: IncomingMessage) => new URL(req.url ?? "/", "http://x").pathname;

  return {
    handleUpgrade(req, socket, head) {
      const p = path(req);
      if (!p.startsWith(`${base}${RELAY_PATH}/`)) return false;
      const topic = p.slice(`${base}${RELAY_PATH}/`.length);
      const members = rooms.get(topic) ?? new Set();
      if (!/^[0-9a-f]{8,64}$/.test(topic) || members.size >= MAX_PER_ROOM) {
        socket.destroy();
        return true;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        rooms.set(topic, members.add(ws));
        ws.on("message", (data, isBinary) => {
          if (isBinary) return;
          const text = data.toString();
          for (const other of members) if (other !== ws && other.readyState === 1) other.send(text);
        });
        ws.on("close", () => {
          members.delete(ws);
          if (!members.size) rooms.delete(topic);
        });
      });
      return true;
    },
    handleRequest(req, res) {
      if (req.method !== "GET" || path(req) !== `${base}${SERVE_INFO_PATH}`) return false;
      const body: ServeInfo = { relay: RELAY_PATH, ...info() };
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(body));
      return true;
    },
    dropAll() {
      for (const ws of wss.clients) ws.terminate();
    },
    close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}

/** Attaches the relay to a plain HTTP server that has no other WebSocket endpoints. */
export function attachRelay(server: Server, relay: Relay): void {
  server.on("upgrade", (req, socket, head) => {
    if (!relay.handleUpgrade(req, socket, head)) socket.destroy();
  });
}
