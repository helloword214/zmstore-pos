import { expect, test } from "@playwright/test";
import { resolveBaseURL } from "./helpers/session";

const routeList = process.env.UI_ROUTE_RIDER_LIST ?? "/rider/variances";
const routeDetail = process.env.UI_ROUTE_RIDER_DETAIL ?? "";

test("rider list: shell + visual baseline", async ({ page }) => {
  const url = new URL(routeList, resolveBaseURL()).toString();
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `Route unreachable: ${url}`).toBeTruthy();

  const main = page.locator("main").first();
  await expect(main).toBeVisible();

  const mainClass = (await main.getAttribute("class")) ?? "";
  expect(mainClass).toContain("min-h-screen");

  await expect(page.locator(".rounded-2xl").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("rider-list.png", { fullPage: true });
});

test("rider detail: shell + visual baseline", async ({ page }) => {
  test.skip(!routeDetail, "Set UI_ROUTE_RIDER_DETAIL to enable this check.");

  const url = new URL(routeDetail || "/", resolveBaseURL()).toString();
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `Route unreachable: ${url}`).toBeTruthy();

  const main = page.locator("main").first();
  await expect(main).toBeVisible();
  await expect(page).toHaveScreenshot("rider-detail.png", { fullPage: true });
});

