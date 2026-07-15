import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: "rm -rf .tmp/e2e-data .tmp/e2e-adb-calls.jsonl && npm run build && npm start",
    url: "http://127.0.0.1:4319/api/health",
    reuseExistingServer: false,
    env: {
      PATH: `${process.cwd()}/tests/fixtures/fake-sdk:${process.env["PATH"] ?? ""}`,
      DROID_CRASH_LAB_DATA_ROOT: `${process.cwd()}/.tmp/e2e-data`,
      FAKE_ADB_CALLS: `${process.cwd()}/.tmp/e2e-adb-calls.jsonl`,
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4319",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
