import { defineConfig, devices } from "@playwright/test";

const host = process.env.UI_HOST ?? "127.0.0.1";
const port = Number(process.env.UI_PORT ?? 4173);
const localBaseURL = `http://${host}:${port}`;
const baseURL = process.env.UI_BASE_URL ?? localBaseURL;
const shouldStartDevServer =
  process.env.UI_SKIP_DEV_SERVER !== "1" && baseURL === localBaseURL;

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
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 12"],
      },
    },
  ],
});

