import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  snapshotPathTemplate: "tests/e2e/__screenshots__/{testFilePath}/{arg}{ext}",
  webServer: [
    {
      command: "npx vite spikes/camera --port 5179 --strictPort",
      port: 5179,
      reuseExistingServer: true,
    },
    {
      // the docs talk, built and served from a subpath like a GitHub Pages project site
      command: "node bin/wavesol.js build docs --out test-results/docs-dist && npx tsx scripts/serve-subpath.ts test-results/docs-dist /wavesol/ 4180",
      url: "http://localhost:4180/wavesol/",
      reuseExistingServer: false,
      // a cold build includes Lean (toolchain + SubVerso for docs/lean): about a minute on CI
      timeout: 300_000,
    },
  ],
});
