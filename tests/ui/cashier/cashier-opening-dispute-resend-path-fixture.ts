import "dotenv/config";

import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  resolveCashierOpeningDisputeResendPathScenarioContext,
  resetCashierOpeningDisputeResendPathState,
} from "../../../scripts/qa/cashier/cashier-opening-dispute-resend-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const CASHIER_OPENING_DISPUTE_RESEND_PATH_ENABLE_ENV =
  "QA_CASHIER_OPENING_DISPUTE_RESEND_PATH_ENABLE";

export type CashierOpeningDisputeResendPathScenario =
  Awaited<ReturnType<typeof resolveCashierOpeningDisputeResendPathScenarioContext>>;

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the cashier opening-dispute resend QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export function isCashierOpeningDisputeResendPathEnabled() {
  return process.env[CASHIER_OPENING_DISPUTE_RESEND_PATH_ENABLE_ENV] === "1";
}

export async function resolveCashierOpeningDisputeResendPathContext() {
  return resolveCashierOpeningDisputeResendPathScenarioContext();
}

export async function resetCashierOpeningDisputeResendPathQaState() {
  return resetCashierOpeningDisputeResendPathState();
}

export async function bootstrapCashierOpeningDisputeResendPathSession(
  context: BrowserContext,
  role: "manager" | "cashier",
) {
  const scenario = await resolveCashierOpeningDisputeResendPathContext();
  const user = role === "manager" ? scenario.manager : scenario.cashier;
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    user.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      `Cashier opening-dispute resend session bootstrap did not return a cookie for ${role}.`,
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

export async function openCashierOpeningDisputeResendPathManagerPage(page: Page) {
  const scenario = await resolveCashierOpeningDisputeResendPathContext();
  const url = new URL(scenario.managerRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/store/cashier-shifts", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /cashier shifts/i })).toBeVisible();
}

export async function openCashierOpeningDisputeResendPathCashierPage(page: Page) {
  const scenario = await resolveCashierOpeningDisputeResendPathContext();
  const url = new URL(scenario.cashierRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/cashier/shift", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /shift console/i })).toBeVisible();
}

export async function confirmCashierOpeningDisputeResendPathAction(
  page: Page,
  action: () => Promise<void>,
) {
  const dialogPromise = page.waitForEvent("dialog");
  const actionPromise = action();
  const dialog = await dialogPromise;
  await dialog.accept();
  await actionPromise;
}

export async function resolveCashierOpeningDisputeResendPathShiftState(
  shiftId: number,
) {
  const scenario = await resolveCashierOpeningDisputeResendPathContext();
  const [shift, taggedShiftCount] = await Promise.all([
    db.cashierShift.findUnique({
      where: { id: shiftId },
      select: {
        closedAt: true,
        closingTotal: true,
        deviceId: true,
        finalClosedById: true,
        id: true,
        openingCounted: true,
        openingDisputeNote: true,
        openingFloat: true,
        openingVerifiedAt: true,
        openingVerifiedById: true,
        status: true,
      },
    }),
    db.cashierShift.count({
      where: { deviceId: scenario.deviceId },
    }),
  ]);

  return {
    shift: shift
      ? {
          closedAt: shift.closedAt,
          closingTotal: shift.closingTotal == null ? null : Number(shift.closingTotal),
          deviceId: shift.deviceId ?? null,
          finalClosedById: shift.finalClosedById ?? null,
          id: shift.id,
          openingCounted: shift.openingCounted == null ? null : Number(shift.openingCounted),
          openingDisputeNote: shift.openingDisputeNote ?? null,
          openingFloat: shift.openingFloat == null ? null : Number(shift.openingFloat),
          openingVerifiedAt: shift.openingVerifiedAt,
          openingVerifiedById: shift.openingVerifiedById ?? null,
          status: String(shift.status ?? ""),
        }
      : null,
    taggedShiftCount,
  };
}

export function resolveCashierOpeningDisputeResendPathShiftId(url: string) {
  const parsed = new URL(url);
  const shiftId = Number(parsed.searchParams.get("shiftId") || 0);

  if (!Number.isInteger(shiftId) || shiftId <= 0) {
    throw new Error(`Unable to resolve the opened cashier shift id from URL: ${url}`);
  }

  return shiftId;
}

export function findCashierOpeningDisputeResendPathOpenForm(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: /^Open Shift$/i }) });
}

export function findCashierOpeningDisputeResendPathShiftRow(
  page: Page,
  shiftId: number,
) {
  return page.locator(`#open-shift-${shiftId}`);
}

export function findCashierOpeningDisputeResendPathResendForm(shiftRow: Locator) {
  return shiftRow;
}
