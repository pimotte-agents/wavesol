// talk.yaml's `head`: wavesol build adds the file to the page's <head>, here from a file shared
// with other talks (outside the talk directory).
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "../../bin/wavesol.js");
const TALK = resolve(import.meta.dirname, "../fixtures/head-talk/talk");

describe("head", () => {
  it("is added to the <head> of the built page", () => {
    const out = mkdtempSync(join(tmpdir(), "wavesol-head-"));
    try {
      const r = spawnSync("node", [CLI, "build", TALK, "--out", out], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      const html = readFileSync(join(out, "index.html"), "utf8");
      expect(html).toMatch(/<meta name="wavesol-test" content="head">\s*<\/head>/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
