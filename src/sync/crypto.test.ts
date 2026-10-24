import { describe, expect, it } from "vitest";
import { fromBase64Url, newSecret, open, room, seal, toBase64Url } from "./crypto.ts";

describe("room crypto", () => {
  it("seals and opens with the same secret", () => {
    const r = room(newSecret());
    const msg = { kind: "intent", intent: { type: "step" } };
    expect(open(r, seal(r, msg))).toEqual(msg);
  });

  it("each seal is different (random IV)", () => {
    const r = room(newSecret());
    expect(seal(r, 1)).not.toBe(seal(r, 1));
  });

  it("a different secret cannot open it", () => {
    const sealed = seal(room(newSecret()), { a: 1 });
    expect(open(room(newSecret()), sealed)).toBeUndefined();
  });

  it("rejects tampered and garbage input", () => {
    const r = room(newSecret());
    const sealed = seal(r, { a: 1 });
    const flipped = sealed.slice(0, 20) + (sealed[20] === "A" ? "B" : "A") + sealed.slice(21);
    expect(open(r, flipped)).toBeUndefined();
    expect(open(r, "not base64!")).toBeUndefined();
    expect(open(r, "")).toBeUndefined();
  });

  it("derives a stable topic that differs per secret and does not contain it", () => {
    const s = newSecret();
    expect(room(s).topic).toBe(room(s).topic);
    expect(room(s).topic).not.toBe(room(newSecret()).topic);
    expect(room(s).topic).toMatch(/^[0-9a-f]{32}$/);
    expect(room(s).topic).not.toContain(s);
  });

  it("refuses short or malformed secrets", () => {
    expect(() => room("abc")).toThrow();
    expect(() => room("not/base64url")).toThrow();
  });

  it("base64url round-trips all byte values", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});
