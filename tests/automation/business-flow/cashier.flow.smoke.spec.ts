import { expect, test } from "@playwright/test";
import { loadBusinessFlowContext } from "../shared/businessFlowContext";

const context = loadBusinessFlowContext();

test("cashier can open shift console", async ({ page }) => {
  const route = context.routes.cashierShift || "/cashier/shift";
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `Route unreachable: ${route}`).toBeTruthy();

  const pathname = new URL(page.url()).pathname;
  expect(pathname).not.toBe("/login");
  await expect(page.locator("main").first()).toBeVisible();
});

test("cashier can open closed run remit hub", async ({ page }) => {
  const route = context.runs.closed.routes.cashierRunRemit;
  test.skip(!route, "Missing closed run remit route in context.");

  const response = await page.goto(route!, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `Route unreachable: ${route}`).toBeTruthy();

  const pathname = new URL(page.url()).pathname;
  expect(pathname).not.toBe("/login");
  await expect(page.locator("main").first()).toBeVisible();
});
