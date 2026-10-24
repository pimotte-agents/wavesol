// Lean nodes through the real build: a temporary talk whose lean/ is the fixture project
// (tests/fixtures/lean/project), so lake and SubVerso really run. Needs elan; skipped without it
// unless REQUIRE_LEAN=1 (CI), where a missing Lean is a failure.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileTalk } from "../../src/build/compile.ts";
import { formatDiagnostic } from "../../src/model/compiled.ts";
import type { LeanData } from "../../src/plugins/lean/build.ts";

const PROJECT = resolve(import.meta.dirname, "../fixtures/lean/project");

function hasLake(): boolean {
  for (const cmd of [join(homedir(), ".elan", "bin", "lake"), "lake"]) {
    try {
      // in the project: elan's lake needs a lean-toolchain (CI installs elan without a default)
      execFileSync(cmd, ["--version"], { stdio: "ignore", cwd: PROJECT });
      return true;
    } catch {
      // try the next
    }
  }
  return false;
}
const lake = hasLake();
if (!lake && process.env.REQUIRE_LEAN) throw new Error("REQUIRE_LEAN is set but lake was not found: install elan");

let dir: string;

/** A talk with the given Lean nodes (frontmatter fields per node). */
function talk(nodes: Record<string, Record<string, unknown>>) {
  rmSync(join(dir, "nodes"), { recursive: true, force: true });
  mkdirSync(join(dir, "nodes"));
  const ids = Object.keys(nodes);
  const edges = ids.length > 1 ? `edges:\n  - ${ids.join(" -> ")}\n` : "";
  writeFileSync(join(dir, "talk.yaml"), `title: Lean\nnodes:\n${ids.map((id) => `  ${id}: {}`).join("\n")}\n${edges}`);
  for (const [id, fm] of Object.entries(nodes)) {
    const yaml = Object.entries({ type: "lean", ...fm }).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
    writeFileSync(join(dir, "nodes", `${id}.md`), `---\n${yaml}\n---\n`);
  }
  return compileTalk(dir);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wavesol-lean-"));
  symlinkSync(PROJECT, join(dir, "lean"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!lake)("Lean nodes (with lake)", { timeout: 600_000 }, () => {
  it("builds a node: steps follow the innermost tactics", async () => {
    const r = await talk({ a: { source: "Fixture.lean", anchor: "haveBlock" } });
    expect(r.diagnostics.map(formatDiagnostic)).toEqual([]);
    const node = r.talk!.nodes.find((n) => n.id === "a")!;
    const data = node.data as LeanData;
    // have (parent of rw, parent of the rule h) → the rule h, then exact h'
    expect(data.steps.map((i) => data.tactics[i]!.text)).toEqual(["h", "exact h'"]);
    expect(node.steps).toBe(2);
    expect(node.title).toBe("haveBlock");
  });

  it("logs each lake run: what it builds, and when it is done", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // the first use of this module in the process, so lake runs
      await talk({ a: { source: "Fixture/Broken.lean", decl: "broken" } });
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines).toContainEqual(expect.stringMatching(/^lean: building Fixture\.Broken \(lake build \+Fixture\.Broken:highlighted in \/.*\/lean\)( - a first build can take a few minutes)?$/));
      expect(lines).toContainEqual(expect.stringMatching(/^lean: Fixture\.Broken failed after \d+(\.\d)? s$/));
    } finally {
      log.mockRestore();
    }
  });

  it("named proof states as steps", async () => {
    const r = await talk({ a: { source: "Fixture.lean", decl: "bullets", steps: ["left"] } });
    expect(r.diagnostics).toEqual([]);
    const data = r.talk!.nodes[0]!.data as LeanData;
    expect(data.stepNames).toEqual(["left"]);
    expect(data.tactics[data.steps[0]!]!.text).toBe("exact hp");
  });

  it("reports missing sources, anchors and proof states at the node", async () => {
    const r = await talk({
      a: { source: "Missing.lean", decl: "x" },
      b: { source: "Fixture.lean", anchor: "nope" },
      c: { source: "Fixture.lean", decl: "bullets", steps: ["nope"] },
    });
    expect(r.diagnostics.map(formatDiagnostic)).toEqual([
      "nodes/a.md: error: Lean source lean/Missing.lean not found",
      'nodes/b.md: error: anchor "nope" not found (expected a line "-- ANCHOR: nope") in lean/Fixture.lean',
      'nodes/c.md: error: no "-- ^ PROOF_STATE: nope" comment in the selected Lean code',
    ]);
  });

  it("reports Lean's own errors in the Lean file, also when lake's result is reused", async () => {
    // twice: the second compile reuses the cached lake run (as `dev` does on every reload)
    for (let i = 0; i < 2; i++) {
      const r = await talk({ a: { source: "Fixture/Broken.lean", decl: "broken" } });
      const lines = r.diagnostics.map(formatDiagnostic);
      expect(lines[0]).toMatch(/^lean\/Fixture\/Broken\.lean:3:3: error: Tactic `rfl` failed/);
      expect(lines.at(-1)).toBe("nodes/a.md: error: lake build of Fixture.Broken failed (errors above)");
    }
  });
});
