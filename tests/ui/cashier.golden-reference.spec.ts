import { expect, test } from "@playwright/test";
import { resolveBaseURL } from "./helpers/session";

const routeShift = process.env.UI_ROUTE_CASHIER_SHIFT ?? "/cashier/shift";

test("cashier shift console: shell + visual baseline", async ({ page }) => {
  const url = new URL(routeShift, resolveBaseURL()).toString();
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `Route unreachable: ${url}`).toBeTruthy();

  const main = page.locator("main").first();
  await expect(main).toBeVisible();

  const mainClass = (await main.getAttribute("class")) ?? "";
  expect(mainClass).toContain("min-h-screen");

  await expect(page.getByText(/shift console/i)).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("cashier-shift-console.png", {
    fullPage: true,
  });
});

