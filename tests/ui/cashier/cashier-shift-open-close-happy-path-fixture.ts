import "dotenv/config";

import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  resolveCashierShiftOpenCloseHappyPathScenarioContext,
  resetCashierShiftOpenCloseHappyPathState,
} from "../../../scripts/qa/cashier/cashier-shift-open-close-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_ENABLE_ENV =
  "QA_CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_ENABLE";

export type CashierShiftOpenCloseHappyPathScenario =
  Awaited<ReturnType<typeof resolveCashierShiftOpenCloseHappyPathScenarioContext>>;

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error("Invalid auth cookie returned while creating the cashier QA session.");
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export function isCashierShiftOpenCloseHappyPathEnabled() {
  return process.env[CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_ENABLE_ENV] === "1";
}

export async function resolveCashierShiftOpenCloseHappyPathContext() {
  return resolveCashierShiftOpenCloseHappyPathScenarioContext();
}

export async function resetCashierShiftOpenCloseHappyPathQaState() {
  return resetCashierShiftOpenCloseHappyPathState();
}

export async function bootstrapCashierShiftOpenCloseHappyPathSession(
  context: BrowserContext,
  role: "manager" | "cashier",
) {
  const scenario = await resolveCashierShiftOpenCloseHappyPathContext();
  const user = role === "manager" ? scenario.manager : scenario.cashier;
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    user.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      `Cashier happy-path session bootstrap did not return a cookie for ${role}.`,
    );
  }

  const cookie = parseCookiePair(setCookieHeader);
  await context.clearCookies();
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: baseUrl.hostname,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
      httpOnly: true,
      secure: baseUrl.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

export async function openCashierShiftOpenCloseHappyPathManagerPage(page: Page) {
  const scenario = await resolveCashierShiftOpenCloseHappyPathContext();
  const url = new URL(scenario.managerRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/store/cashier-shifts", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /cashier shifts/i })).toBeVisible();
}

export async function openCashierShiftOpenCloseHappyPathCashierPage(page: Page) {
  const scenario = await resolveCashierShiftOpenCloseHappyPathContext();
  const url = new URL(scenario.cashierRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/cashier/shift", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /shift console/i })).toBeVisible();
}

export async function confirmCashierShiftOpenCloseHappyPathAction(
  page: Page,
  action: () => Promise<void>,
) {
  const dialogPromise = page.waitForEvent("dialog");
  await action();
  const dialog = await dialogPromise;
  await dialog.accept();
}

export async function resolveCashierShiftOpenCloseHappyPathShiftState(shiftId: number) {
  const shift = await db.cashierShift.findUnique({
    where: { id: shiftId },
    select: {
      closedAt: true,
      closingTotal: true,
      deviceId: true,
      id: true,
      openingFloat: true,
      status: true,
    },
  });

  if (!shift) return null;

  return {
    closedAt: shift.closedAt,
    closingTotal: shift.closingTotal == null ? null : Number(shift.closingTotal),
    deviceId: shift.deviceId ?? null,
    id: shift.id,
    openingFloat: shift.openingFloat == null ? null : Number(shift.openingFloat),
    status: String(shift.status ?? ""),
  };
}

export function resolveCashierShiftOpenCloseHappyPathShiftId(url: string) {
  const parsed = new URL(url);
  const shiftId = Number(parsed.searchParams.get("shiftId") || 0);

  if (!Number.isInteger(shiftId) || shiftId <= 0) {
    throw new Error(`Unable to resolve the opened cashier shift id from URL: ${url}`);
  }

  return shiftId;
}

export function findCashierShiftOpenCloseHappyPathOpenForm(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: /^Open Shift$/i }) });
}

export function findCashierShiftOpenCloseHappyPathCloseForm(shiftRow: Locator) {
  return shiftRow
    .locator("form")
    .filter({ has: shiftRow.getByRole("button", { name: /^Final close shift$/i }) });
}
