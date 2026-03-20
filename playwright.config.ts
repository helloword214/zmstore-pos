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
      name: "auth-login-otp-session",
      testMatch: /auth\/auth-login-otp-session\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "auth-role-routing",
      testMatch: /auth\/auth-role-routing\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "cashier-shift-dispute-shortage-path",
      testMatch: /cashier\/cashier-shift-dispute-shortage-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "cashier-shift-open-close-happy-path",
      testMatch: /cashier\/cashier-shift-open-close-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "delivery-run-handoff-and-remit-access-happy-path",
      testMatch:
        /delivery\/delivery-run-handoff-and-remit-access-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "delivery-manager-remit-posting-happy-path",
      testMatch:
        /delivery\/delivery-manager-remit-posting-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "delivery-cashier-order-remit-posting-happy-path",
      testMatch:
        /delivery\/delivery-cashier-order-remit-posting-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "delivery-cashier-order-remit-shortage-path",
      testMatch:
        /delivery\/delivery-cashier-order-remit-shortage-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "employee-onboarding-create-happy-path",
      testMatch: /employee\/employee-onboarding-create-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "employee-onboarding-rider-happy-path",
      testMatch: /employee\/employee-onboarding-rider-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "employee-onboarding-store-manager-happy-path",
      testMatch: /employee\/employee-onboarding-store-manager-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "employee-account-management-happy-path",
      testMatch: /employee\/employee-account-management-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "employee-role-switch-happy-path",
      testMatch: /employee\/employee-role-switch-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "product-catalog-admin-happy-path",
      testMatch: /product\/product-catalog-admin-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "workforce-payroll-happy-path",
      testMatch: /workforce\/workforce-payroll-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "workforce-schedule-planner-publish-visibility-happy-path",
      testMatch:
        /workforce\/workforce-schedule-planner-publish-visibility-happy-path\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "manager-desktop",
      testMatch: /manager\..*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: skipAuthSetup ? undefined : managerState,
      },
    },
    {
      name: "manager-mobile",
      testMatch: /manager\..*\.spec\.ts/,
      use: {
        ...devices["iPhone 12"],
        storageState: skipAuthSetup ? undefined : managerState,
      },
    },
    {
      name: "rider-desktop",
      testMatch: /rider\..*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: skipAuthSetup ? undefined : riderState,
      },
    },
    {
      name: "rider-mobile",
      testMatch: /rider\..*\.spec\.ts/,
      use: {
        ...devices["iPhone 12"],
        storageState: skipAuthSetup ? undefined : riderState,
      },
    },
    {
      name: "cashier-desktop",
      testMatch: /cashier\..*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
        storageState: skipAuthSetup ? undefined : cashierState,
      },
    },
  ],
});
