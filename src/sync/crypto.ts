// Room secret and end-to-end encryption for the network transports (phone controller). Everything a
// phone and the projector exchange through a relay is sealed with a key derived from the room secret
// (from the QR code), so relays see only ciphertext and only secret holders can send accepted messages.
// Pure JS (noble) rather than Web Crypto: a phone on `wavesol serve` loads the page over plain HTTP,
// where crypto.subtle does not exist.
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export interface Room {
  secret: string;
  key: Uint8Array;
  /** Public name of the room on relays: derived from the secret, reveals nothing about it. */
  topic: string;
}

const SECRET_BYTES = 16;

export function newSecret(): string {
  return toBase64Url(randomBytes(SECRET_BYTES));
}

/** Derives the room from a secret; throws if the secret is malformed. */
export function room(secret: string): Room {
  const raw = fromBase64Url(secret);
  if (raw.length < SECRET_BYTES) throw new Error("room secret too short");
  return {
    secret,
    key: hkdf(sha256, raw, undefined, utf8ToBytes("wavesol/key/v1"), 32),
    topic: bytesToHex(hkdf(sha256, raw, undefined, utf8ToBytes("wavesol/topic/v1"), 16)),
  };
}

/** Encrypts and authenticates a JSON value: base64url(iv ‖ ciphertext ‖ tag). */
export function seal(r: Room, value: unknown): string {
  const iv = randomBytes(12);
  const ct = gcm(r.key, iv).encrypt(utf8ToBytes(JSON.stringify(value)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toBase64Url(out);
}

/** Decrypts a sealed value; undefined if it was not sealed with this room's key or was tampered with. */
export function open(r: Room, sealed: string): unknown {
  try {
    const raw = fromBase64Url(sealed);
    if (raw.length < 12 + 16) return undefined;
    const pt = gcm(r.key, raw.subarray(0, 12)).decrypt(raw.subarray(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return undefined;
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
