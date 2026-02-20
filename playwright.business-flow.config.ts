import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const host = process.env.UI_HOST ?? "127.0.0.1";
const port = Number(process.env.UI_PORT ?? 4173);
const localBaseURL = `http://${host}:${port}`;
const baseURL = process.env.UI_BASE_URL ?? localBaseURL;
const shouldStartDevServer =
  process.env.UI_SKIP_DEV_SERVER !== "1" && baseURL === localBaseURL;
const skipAuthSetup = process.env.UI_SKIP_AUTH_SETUP === "1";

const authDir = path.resolve("test-results/ui/auth");
const managerState =
  process.env.UI_MANAGER_STATE_FILE ?? path.join(authDir, "manager.json");
const riderState =
  process.env.UI_RIDER_STATE_FILE ?? path.join(authDir, "rider.json");
const cashierState =
  process.env.UI_CASHIER_STATE_FILE ?? path.join(authDir, "cashier.json");

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results/automation/business-flow/artifacts",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "test-results/automation/business-flow/html-report" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: shouldStartDevServer
    ? {
        command: `npm run dev -- --host ${host} --port ${port}`,
        url: localBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    {
      name: "setup-manager-auth",
      testMatch: /tests\/ui\/auth\.manager\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "setup-rider-auth",
      testMatch: /tests\/ui\/auth\.rider\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "setup-cashier-auth",
      testMatch: /tests\/ui\/auth\.cashier\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "manager-flow-desktop",
      testMatch: /tests\/automation\/business-flow\/manager\.flow\.smoke\.spec\.ts/,
      dependencies: skipAuthSetup ? [] : ["setup-manager-auth"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: managerState,
      },
    },
    {
      name: "rider-flow-desktop",
      testMatch: /tests\/automation\/business-flow\/rider\.flow\.smoke\.spec\.ts/,
      dependencies: skipAuthSetup ? [] : ["setup-rider-auth"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: riderState,
      },
    },
    {
      name: "cashier-flow-desktop",
      testMatch: /tests\/automation\/business-flow\/cashier\.flow\.smoke\.spec\.ts/,
      dependencies: skipAuthSetup ? [] : ["setup-cashier-auth"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: cashierState,
      },
    },
  ],
});
