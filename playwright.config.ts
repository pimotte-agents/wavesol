import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  webServer: {
    command: "npx vite spikes/camera --port 5179 --strictPort",
    port: 5179,
    reuseExistingServer: true,
  },
});
