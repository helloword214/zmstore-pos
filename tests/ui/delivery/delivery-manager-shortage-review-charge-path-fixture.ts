import "dotenv/config";

import { existsSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryManagerShortageReviewChargePathArtifacts,
  resetDeliveryManagerShortageReviewChargePathState,
  resolveDeliveryManagerShortageReviewChargePathScenarioContext,
} from "../../../scripts/qa/delivery/delivery-manager-shortage-review-charge-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_MANAGER_SHORTAGE_REVIEW_CHARGE_PATH_ENABLE_ENV =
  "QA_DELIVERY_MANAGER_SHORTAGE_REVIEW_CHARGE_PATH_ENABLE";

export type DeliveryManagerShortageReviewChargePathScenario =
  Awaited<
    ReturnType<typeof resolveDeliveryManagerShortageReviewChargePathScenarioContext>
  >;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryManagerShortageReviewChargePathEnabled() {
  return (
    process.env[DELIVERY_MANAGER_SHORTAGE_REVIEW_CHARGE_PATH_ENABLE_ENV] === "1"
  );
}

export async function cleanupDeliveryManagerShortageReviewChargePathQaState() {
  return deleteDeliveryManagerShortageReviewChargePathArtifacts();
}

export async function resetDeliveryManagerShortageReviewChargePathQaState() {
  return resetDeliveryManagerShortageReviewChargePathState();
}

export async function resolveDeliveryManagerShortageReviewChargePathScenario() {
  return resolveDeliveryManagerShortageReviewChargePathScenarioContext();
}

export async function createDeliveryManagerShortageReviewChargePathManagerContext(
  browser: Browser,
) {
  const scenario = await resolveDeliveryManagerShortageReviewChargePathScenario();
  const stateFilePath = scenario.managerStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing manager storage state for delivery manager shortage-review charge path: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

export async function openDeliveryManagerShortageReviewChargePathReviewPage(
  page: Page,
) {
  const scenario = await resolveDeliveryManagerShortageReviewChargePathScenario();

  const response = await page.goto(toAbsoluteUrl(scenario.reviewRoute), {
    waitUntil: "domcontentloaded",
  });

  expect(
    response?.ok() ?? true,
    `Route unreachable: ${scenario.reviewRoute}`,
  ).toBeTruthy();
  await page.waitForURL(
    (target) =>
      target.pathname === "/store/rider-variances" &&
      target.searchParams.get("tab") === "open",
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /rider variances/i }),
  ).toBeVisible();
}

export async function resolveDeliveryManagerShortageReviewChargePathDbState() {
  const scenario = await resolveDeliveryManagerShortageReviewChargePathScenario();

  const [variance, riderCharge, order] = await Promise.all([
    db.riderRunVariance.findUnique({
      where: { id: scenario.varianceId },
      select: {
        id: true,
        runId: true,
        riderId: true,
        shiftId: true,
        receiptId: true,
        status: true,
        resolution: true,
        expected: true,
        actual: true,
        variance: true,
        note: true,
        managerApprovedAt: true,
        managerApprovedById: true,
        riderAcceptedAt: true,
      },
    }),
    db.riderCharge.findUnique({
      where: { varianceId: scenario.varianceId },
      select: {
        id: true,
        varianceId: true,
        runId: true,
        riderId: true,
        amount: true,
        status: true,
        note: true,
        createdById: true,
        settledAt: true,
      },
    }),
    db.order.findUnique({
      where: { id: scenario.remitOrder.id },
      select: {
        id: true,
        status: true,
        payments: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            method: true,
            amount: true,
            refNo: true,
            shiftId: true,
            cashierId: true,
          },
        },
      },
    }),
  ]);

  const shortageBridgePayments =
    order?.payments.filter(
      (payment) =>
        payment.method === "INTERNAL_CREDIT" &&
        String(payment.refNo ?? "").startsWith("RIDER-SHORTAGE:"),
    ) ?? [];

  return {
    order,
    riderCharge,
    shortageBridgePayments,
    variance,
  };
}

export function expectDeliveryManagerShortageReviewChargePathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryManagerShortageReviewChargePathDbState>
  >,
  scenario: DeliveryManagerShortageReviewChargePathScenario,
) {
  expect(state.order?.id).toBe(scenario.remitOrder.id);
  expect(state.order?.status).toBe("PAID");
  expect(state.shortageBridgePayments).toHaveLength(1);
  expect(Number(state.shortageBridgePayments[0]?.amount ?? 0).toFixed(2)).toBe(
    scenario.shortageAmountInput,
  );
  expect(state.variance?.id).toBe(scenario.varianceId);
  expect(state.variance?.status).toBe("OPEN");
  expect(state.variance?.resolution).toBeNull();
  expect(state.variance?.managerApprovedAt).toBeNull();
  expect(state.variance?.managerApprovedById).toBeNull();
  expect(state.variance?.riderAcceptedAt).toBeNull();
  expect(Number(state.variance?.expected ?? 0).toFixed(2)).toBe(
    scenario.exactCashInput,
  );
  expect(Number(state.variance?.actual ?? 0).toFixed(2)).toBe(
    scenario.shortageCashInput,
  );
  expect(Number(state.variance?.variance ?? 0).toFixed(2)).toBe(
    (
      Number(scenario.shortageCashInput) - Number(scenario.exactCashInput)
    ).toFixed(2),
  );
  expect(state.riderCharge).toBeNull();
}

export function expectDeliveryManagerShortageReviewChargePathPostedDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryManagerShortageReviewChargePathDbState>
  >,
  scenario: DeliveryManagerShortageReviewChargePathScenario,
) {
  expect(state.order?.id).toBe(scenario.remitOrder.id);
  expect(state.order?.status).toBe("PAID");
  expect(state.shortageBridgePayments).toHaveLength(1);
  expect(Number(state.shortageBridgePayments[0]?.amount ?? 0).toFixed(2)).toBe(
    scenario.shortageAmountInput,
  );
  expect(state.variance?.id).toBe(scenario.varianceId);
  expect(state.variance?.status).toBe("MANAGER_APPROVED");
  expect(state.variance?.resolution).toBe("CHARGE_RIDER");
  expect(state.variance?.managerApprovedAt).not.toBeNull();
  expect(state.variance?.managerApprovedById).toBe(scenario.manager.id);
  expect(state.variance?.riderAcceptedAt).toBeNull();
  expect(state.variance?.note).toBe(scenario.decisionNote);
  expect(state.riderCharge?.varianceId).toBe(scenario.varianceId);
  expect(state.riderCharge?.runId).toBe(scenario.closedRun.id);
  expect(state.riderCharge?.riderId).toBe(state.variance?.riderId ?? null);
  expect(Number(state.riderCharge?.amount ?? 0).toFixed(2)).toBe(
    scenario.shortageAmountInput,
  );
  expect(state.riderCharge?.status).toBe("OPEN");
  expect(state.riderCharge?.note).toBe(scenario.decisionNote);
  expect(state.riderCharge?.createdById).toBe(scenario.manager.id);
  expect(state.riderCharge?.settledAt).toBeNull();
}
