// Each directory in tests/fixtures/check is a talk; expected.txt lists its diagnostics, one per line.
// Regenerate with UPDATE=1 npx vitest run tests/unit/check.test.ts (and review the diff).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileTalk } from "../../src/build/compile.ts";
import { formatDiagnostic } from "../../src/model/compiled.ts";

const root = join(import.meta.dirname, "../fixtures/check");

describe("check diagnostics", () => {
  for (const name of readdirSync(root)) {
    it(name, async () => {
      const dir = join(root, name);
      const { diagnostics } = await compileTalk(dir);
      const actual = diagnostics.map(formatDiagnostic).join("\n") + "\n";
      const expectedFile = join(dir, "expected.txt");
      if (process.env.UPDATE || !existsSync(expectedFile)) writeFileSync(expectedFile, actual);
      expect(actual).toBe(readFileSync(expectedFile, "utf8"));
    });
  }
});
