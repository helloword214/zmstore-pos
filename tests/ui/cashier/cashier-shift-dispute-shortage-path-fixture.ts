import "dotenv/config";

import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DECISION,
  resolveCashierShiftDisputeShortagePathScenarioContext,
  resetCashierShiftDisputeShortagePathState,
} from "../../../scripts/qa/cashier/cashier-shift-dispute-shortage-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_ENABLE_ENV =
  "QA_CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_ENABLE";

export type CashierShiftDisputeShortagePathScenario =
  Awaited<ReturnType<typeof resolveCashierShiftDisputeShortagePathScenarioContext>>;

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error("Invalid auth cookie returned while creating the cashier shortage QA session.");
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export function isCashierShiftDisputeShortagePathEnabled() {
  return process.env[CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_ENABLE_ENV] === "1";
}

export function resolveCashierShiftDisputeShortagePathDecision() {
  return CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DECISION;
}

export async function resolveCashierShiftDisputeShortagePathContext() {
  return resolveCashierShiftDisputeShortagePathScenarioContext();
}

export async function resetCashierShiftDisputeShortagePathQaState() {
  return resetCashierShiftDisputeShortagePathState();
}

export async function bootstrapCashierShiftDisputeShortagePathSession(
  context: BrowserContext,
  role: "manager" | "cashier",
) {
  const scenario = await resolveCashierShiftDisputeShortagePathContext();
  const user = role === "manager" ? scenario.manager : scenario.cashier;
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    user.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      `Cashier shortage session bootstrap did not return a cookie for ${role}.`,
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

export async function openCashierShiftDisputeShortagePathManagerPage(page: Page) {
  const scenario = await resolveCashierShiftDisputeShortagePathContext();
  const url = new URL(scenario.managerRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/store/cashier-shifts", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /cashier shifts/i })).toBeVisible();
}

export async function openCashierShiftDisputeShortagePathCashierPage(page: Page) {
  const scenario = await resolveCashierShiftDisputeShortagePathContext();
  const url = new URL(scenario.cashierRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/cashier/shift", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /shift console/i })).toBeVisible();
}

export async function confirmCashierShiftDisputeShortagePathAction(
  page: Page,
  action: () => Promise<void>,
) {
  const dialogPromise = page.waitForEvent("dialog");
  await action();
  const dialog = await dialogPromise;
  await dialog.accept();
}

export async function resolveCashierShiftDisputeShortagePathOutcome(shiftId: number) {
  const [shift, variance, charge] = await Promise.all([
    db.cashierShift.findUnique({
      where: { id: shiftId },
      select: {
        closedAt: true,
        closingTotal: true,
        deviceId: true,
        id: true,
        notes: true,
        openingFloat: true,
        status: true,
      },
    }),
    db.cashierShiftVariance.findUnique({
      where: { shiftId },
      select: {
        counted: true,
        expected: true,
        id: true,
        managerApprovedAt: true,
        note: true,
        resolution: true,
        status: true,
        variance: true,
      },
    }),
    db.cashierCharge.findFirst({
      where: { shiftId },
      select: {
        amount: true,
        cashierId: true,
        id: true,
        note: true,
        payments: {
          select: { id: true },
        },
        settledAt: true,
        shiftId: true,
        status: true,
        varianceId: true,
      },
    }),
  ]);

  return {
    charge: charge
      ? {
          amount: Number(charge.amount),
          cashierId: charge.cashierId,
          id: charge.id,
          note: charge.note ?? null,
          paymentsCount: charge.payments.length,
          settledAt: charge.settledAt,
          shiftId: charge.shiftId ?? null,
          status: String(charge.status ?? ""),
          varianceId: charge.varianceId ?? null,
        }
      : null,
    shift: shift
      ? {
          closedAt: shift.closedAt,
          closingTotal: shift.closingTotal == null ? null : Number(shift.closingTotal),
          deviceId: shift.deviceId ?? null,
          id: shift.id,
          notes: shift.notes ?? null,
          openingFloat: shift.openingFloat == null ? null : Number(shift.openingFloat),
          status: String(shift.status ?? ""),
        }
      : null,
    variance: variance
      ? {
          counted: Number(variance.counted),
          expected: Number(variance.expected),
          id: variance.id,
          managerApprovedAt: variance.managerApprovedAt,
          note: variance.note ?? null,
          resolution: variance.resolution ? String(variance.resolution) : null,
          status: String(variance.status ?? ""),
          variance: Number(variance.variance),
        }
      : null,
  };
}

export function resolveCashierShiftDisputeShortagePathShiftId(url: string) {
  const parsed = new URL(url);
  const shiftId = Number(parsed.searchParams.get("shiftId") || 0);

  if (!Number.isInteger(shiftId) || shiftId <= 0) {
    throw new Error(`Unable to resolve the opened cashier shift id from URL: ${url}`);
  }

  return shiftId;
}

export function findCashierShiftDisputeShortagePathOpenForm(page: Page) {
  return page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: /^Open Shift$/i }) });
}

export function findCashierShiftDisputeShortagePathCloseForm(shiftRow: Locator) {
  return shiftRow
    .locator("form")
    .filter({ has: shiftRow.getByRole("button", { name: /^Final close shift$/i }) });
}
