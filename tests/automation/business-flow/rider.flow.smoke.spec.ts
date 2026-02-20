import { expect, test } from "@playwright/test";
import { loadBusinessFlowContext } from "../shared/businessFlowContext";

const context = loadBusinessFlowContext();

test("rider can open checked-in rider check-in route", async ({ page }) => {
  const route = context.runs.checkedIn.routes.riderCheckin;
  test.skip(!route, "Missing checked-in rider-checkin route in context.");

  const response = await page.goto(route!, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `Route unreachable: ${route}`).toBeTruthy();

  const pathname = new URL(page.url()).pathname;
  expect(pathname).not.toBe("/login");
  await expect(page.locator("main").first()).toBeVisible();
});

test("rider can open rider variance list route", async ({ page }) => {
  const route = context.routes.riderList || "/rider/variances";
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `Route unreachable: ${route}`).toBeTruthy();

  const pathname = new URL(page.url()).pathname;
  expect(pathname).not.toBe("/login");
  await expect(page.locator("main").first()).toBeVisible();
});
