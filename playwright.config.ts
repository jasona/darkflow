import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3123",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: [
        /workspace-touch\.spec\.ts/,
        /production-artifact\.spec\.ts/,
        /transports\.spec\.ts/,
      ],
      use: devices["Desktop Chrome"],
    },
    {
      name: "firefox",
      testIgnore: [
        /workspace-touch\.spec\.ts/,
        /production-artifact\.spec\.ts/,
        /transports\.spec\.ts/,
      ],
      use: devices["Desktop Firefox"],
    },
    {
      name: "webkit",
      testIgnore: [
        /workspace-touch\.spec\.ts/,
        /production-artifact\.spec\.ts/,
        /transports\.spec\.ts/,
      ],
      use: devices["Desktop Safari"],
    },
    {
      name: "mobile-chromium",
      testMatch: /workspace-touch\.spec\.ts/,
      use: devices["Pixel 7"],
    },
  ],
  webServer: {
    command: "node server.js --dev",
    url: "http://127.0.0.1:3123/phase0/main.ts",
    env: { PORT: "3123", DARKFLOW_VITE_POLL: "1" },
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    timeout: 300_000,
  },
});
