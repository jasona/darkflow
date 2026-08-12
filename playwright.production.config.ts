import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch:
    /(?:phase2-shell|phase2-workspace|production-artifact|session-disposal|transports)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3124",
  },
  projects: [
    {
      name: "chromium",
      testMatch: /(?:phase2-shell|phase2-workspace|production-artifact|session-disposal)\.spec\.ts/,
      use: devices["Desktop Chrome"],
    },
    {
      name: "transports",
      testMatch: /transports\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ignoreHTTPSErrors: true,
      },
    },
  ],
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:3124/ping",
    env: { PORT: "3124", MCP_ENABLED: "0", MUD_HOST: "" },
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 300_000,
  },
});
