import { expect, test } from "@playwright/test";
import { bootstrapSession, resolveBaseURL } from "./helpers/session";

type RouteTarget = {
  id: "manager-dashboard" | "rider-checkin" | "manager-remit";
  explicitEnv: "UI_ROUTE_MANAGER_DASHBOARD" | "UI_ROUTE_CHECKIN" | "UI_ROUTE_REMIT";
  fromRunId?: (runId: string) => string;
  fallbackPath?: string;
};

const targets: RouteTarget[] = [
  {
    id: "manager-dashboard",
    explicitEnv: "UI_ROUTE_MANAGER_DASHBOARD",
    fallbackPath: "/store",
  },
  {
    id: "rider-checkin",
    explicitEnv: "UI_ROUTE_CHECKIN",
    fromRunId: (runId) => `/runs/${runId}/rider-checkin`,
  },
  {
    id: "manager-remit",
    explicitEnv: "UI_ROUTE_REMIT",
    fromRunId: (runId) => `/runs/${runId}/remit`,
  },
];

function resolveRoutePath(target: RouteTarget) {
  const explicit = process.env[target.explicitEnv];
  if (explicit) return explicit;

  const runId = process.env.UI_RUN_ID;
  if (runId && target.fromRunId) return target.fromRunId(runId);

  if (target.fallbackPath) return target.fallbackPath;

  return null;
}

for (const target of targets) {
  test(`${target.id}: shell + visual baseline`, async ({ page, context }) => {
    const routePath = resolveRoutePath(target);
    test.skip(
      !routePath,
      `Missing route. Set ${target.explicitEnv} or UI_RUN_ID.`,
    );

    await bootstrapSession(page, context);

    const url = new URL(routePath ?? "/", resolveBaseURL()).toString();
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `Route unreachable: ${url}`).toBeTruthy();

    const main = page.locator("main").first();
    await expect(main).toBeVisible();

    const mainClass = (await main.getAttribute("class")) ?? "";
    expect(mainClass).toContain("min-h-screen");

    await expect(page.locator(".rounded-2xl").first()).toBeVisible();

    const noteCount = await page.getByText(/note:/i).count();
    expect(noteCount).toBeLessThanOrEqual(25);

    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot(`${target.id}.png`, { fullPage: true });
  });
}
