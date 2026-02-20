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
  testDir: "./tests/ui",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results/ui/artifacts",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "test-results/ui/html-report" }],
  ],
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
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
      testMatch: /auth\.manager\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "setup-rider-auth",
      testMatch: /auth\.rider\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "setup-cashier-auth",
      testMatch: /auth\.cashier\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "manager-desktop",
      testMatch: /manager\..*\.spec\.ts/,
      dependencies: skipAuthSetup ? [] : ["setup-manager-auth"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: skipAuthSetup ? undefined : managerState,
      },
    },
    {
      name: "manager-mobile",
      testMatch: /manager\..*\.spec\.ts/,
      dependencies: skipAuthSetup ? [] : ["setup-manager-auth"],
      use: {
        ...devices["iPhone 12"],
        storageState: skipAuthSetup ? undefined : managerState,
      },
    },
    {
      name: "rider-desktop",
      testMatch: /rider\..*\.spec\.ts/,
      dependencies: skipAuthSetup ? [] : ["setup-rider-auth"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: skipAuthSetup ? undefined : riderState,
      },
    },
    {
      name: "rider-mobile",
      testMatch: /rider\..*\.spec\.ts/,
      dependencies: skipAuthSetup ? [] : ["setup-rider-auth"],
      use: {
        ...devices["iPhone 12"],
        storageState: skipAuthSetup ? undefined : riderState,
      },
    },
    {
      name: "cashier-desktop",
      testMatch: /cashier\..*\.spec\.ts/,
      dependencies: skipAuthSetup ? [] : ["setup-cashier-auth"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: skipAuthSetup ? undefined : cashierState,
      },
    },
  ],
});
