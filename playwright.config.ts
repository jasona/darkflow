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
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "firefox", use: devices["Desktop Firefox"] },
    { name: "webkit", use: devices["Desktop Safari"] },
  ],
  webServer: {
    command: "node server.js --dev",
    url: "http://127.0.0.1:3123/ping",
    env: { PORT: "3123", DARKFLOW_VITE_POLL: "1" },
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    timeout: 120_000,
  },
});
