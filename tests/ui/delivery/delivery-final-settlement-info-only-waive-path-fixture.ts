import "dotenv/config";

import { existsSync } from "node:fs";
import { CashierShiftStatus } from "@prisma/client";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  type DeliveryFinalSettlementInfoOnlyWaiveResolution,
  deleteDeliveryFinalSettlementInfoOnlyWaivePathArtifacts,
  resetDeliveryFinalSettlementInfoOnlyWaivePathState,
  resolveDeliveryFinalSettlementInfoOnlyWaivePathScenarioContext,
} from "../../../scripts/qa/delivery/delivery-final-settlement-info-only-waive-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_FINAL_SETTLEMENT_INFO_ONLY_WAIVE_PATH_ENABLE_ENV =
  "QA_DELIVERY_FINAL_SETTLEMENT_INFO_ONLY_WAIVE_PATH_ENABLE";

export type DeliveryFinalSettlementInfoOnlyWaivePathScenario = Awaited<
  ReturnType<typeof resolveDeliveryFinalSettlementInfoOnlyWaivePathScenarioContext>
>;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryFinalSettlementInfoOnlyWaivePathEnabled() {
  return (
    process.env[
      DELIVERY_FINAL_SETTLEMENT_INFO_ONLY_WAIVE_PATH_ENABLE_ENV
    ] === "1"
  );
}

export async function cleanupDeliveryFinalSettlementInfoOnlyWaivePathQaState() {
  return deleteDeliveryFinalSettlementInfoOnlyWaivePathArtifacts();
}

export async function resetDeliveryFinalSettlementInfoOnlyWaivePathQaState(
  resolution: DeliveryFinalSettlementInfoOnlyWaiveResolution,
) {
  return resetDeliveryFinalSettlementInfoOnlyWaivePathState(resolution);
}

export async function resolveDeliveryFinalSettlementInfoOnlyWaivePathScenario() {
  return resolveDeliveryFinalSettlementInfoOnlyWaivePathScenarioContext();
}

export async function createDeliveryFinalSettlementInfoOnlyWaivePathCashierContext(
  browser: Browser,
) {
  const scenario =
    await resolveDeliveryFinalSettlementInfoOnlyWaivePathScenario();
  const stateFilePath = scenario.cashierStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing cashier storage state for delivery final-settlement info-only/waive path: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

export async function openDeliveryFinalSettlementInfoOnlyWaivePathRunHubPage(
  page: Page,
) {
  const scenario =
    await resolveDeliveryFinalSettlementInfoOnlyWaivePathScenario();

  const response = await page.goto(toAbsoluteUrl(scenario.settlementRoute), {
    waitUntil: "domcontentloaded",
  });

  expect(
    response?.ok() ?? true,
    `Route unreachable: ${scenario.settlementRoute}`,
  ).toBeTruthy();
  await page.waitForURL(
    (target) => target.pathname === `/cashier/delivery/${scenario.closedRun.id}`,
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /delivery run remit/i }),
  ).toBeVisible();
}

export async function resolveDeliveryFinalSettlementInfoOnlyWaivePathDbState() {
  const scenario =
    await resolveDeliveryFinalSettlementInfoOnlyWaivePathScenario();

  const [closedRun, taggedShift, varianceCount, riderChargeCount, order] =
    await Promise.all([
      db.deliveryRun.findUnique({
        where: { id: scenario.closedRun.id },
        select: {
          id: true,
          runCode: true,
          status: true,
          closedAt: true,
        },
      }),
      db.cashierShift.findFirst({
        where: {
          deviceId: scenario.cashierShiftDeviceId,
          cashierId: scenario.cashier.id,
          closedAt: null,
        },
        select: {
          id: true,
          cashierId: true,
          deviceId: true,
          status: true,
          closedAt: true,
        },
        orderBy: { openedAt: "desc" },
      }),
      db.riderRunVariance.count({
        where: { runId: scenario.closedRun.id },
      }),
      db.riderCharge.count({
        where: { runId: scenario.closedRun.id },
      }),
      db.order.findUnique({
        where: { id: scenario.remitOrder.id },
        select: {
          id: true,
          status: true,
          paidAt: true,
          receiptNo: true,
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

  const variance = await db.riderRunVariance.findUnique({
    where: { id: scenario.varianceId },
    select: {
      id: true,
      runId: true,
      riderId: true,
      shiftId: true,
      status: true,
      resolution: true,
      note: true,
      managerApprovedAt: true,
      managerApprovedById: true,
      riderAcceptedAt: true,
      riderAcceptedById: true,
      resolvedAt: true,
    },
  });

  const riderCharge = await db.riderCharge.findUnique({
    where: { varianceId: scenario.varianceId },
    select: {
      id: true,
      runId: true,
      riderId: true,
      varianceId: true,
      status: true,
      amount: true,
      note: true,
      settledAt: true,
      createdById: true,
    },
  });

  const cashPayments =
    order?.payments.filter((payment) => payment.method === "CASH") ?? [];
  const shortageBridgePayments =
    order?.payments.filter(
      (payment) =>
        payment.method === "INTERNAL_CREDIT" &&
        String(payment.refNo ?? "").startsWith("RIDER-SHORTAGE:"),
    ) ?? [];

  return {
    cashPayments,
    closedRun,
    order,
    riderCharge,
    riderChargeCount,
    shortageBridgePayments,
    taggedShift,
    variance,
    varianceCount,
  };
}

export function expectDeliveryFinalSettlementInfoOnlyWaivePathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryFinalSettlementInfoOnlyWaivePathDbState>
  >,
  scenario: DeliveryFinalSettlementInfoOnlyWaivePathScenario,
  resolution: DeliveryFinalSettlementInfoOnlyWaiveResolution,
) {
  expect(state.closedRun?.id).toBe(scenario.closedRun.id);
  expect(state.closedRun?.status).toBe("CLOSED");
  expect(state.taggedShift?.cashierId).toBe(scenario.cashier.id);
  expect(state.taggedShift?.deviceId).toBe(scenario.cashierShiftDeviceId);
  expect(state.taggedShift?.status).toBe(CashierShiftStatus.OPEN);
  expect(state.taggedShift?.closedAt).toBeNull();
  expect(state.order?.id).toBe(scenario.remitOrder.id);
  expect(state.order?.status).toBe("PAID");
  expect(state.order?.paidAt).not.toBeNull();
  expect(state.order?.receiptNo).not.toBeNull();
  expect(state.order?.payments).toHaveLength(2);
  expect(state.cashPayments).toHaveLength(1);
  expect(state.shortageBridgePayments).toHaveLength(1);
  expect(state.varianceCount).toBe(1);
  expect(state.variance?.id).toBe(scenario.varianceId);
  expect(state.variance?.resolution).toBe(resolution);
  expect(state.variance?.managerApprovedAt).not.toBeNull();
  expect(state.variance?.managerApprovedById).toBe(scenario.manager.id);
  expect(state.variance?.riderAcceptedAt).toBeNull();
  expect(state.variance?.riderAcceptedById).toBeNull();
  expect(state.variance?.resolvedAt).toBeNull();
  expect(state.variance?.shiftId).toBe(state.taggedShift?.id ?? null);
  expect(state.riderChargeCount).toBe(0);
  expect(state.riderCharge).toBeNull();

  if (resolution === "INFO_ONLY") {
    expect(state.variance?.status).toBe("MANAGER_APPROVED");
    expect(state.variance?.note).toBe(scenario.infoOnlyDecisionNote);
    return;
  }

  expect(state.variance?.status).toBe("WAIVED");
  expect(state.variance?.note).toBe(scenario.waiveDecisionNote);
}

export function expectDeliveryFinalSettlementInfoOnlyWaivePathPostedDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryFinalSettlementInfoOnlyWaivePathDbState>
  >,
  scenario: DeliveryFinalSettlementInfoOnlyWaivePathScenario,
  resolution: DeliveryFinalSettlementInfoOnlyWaiveResolution,
) {
  expect(state.closedRun?.id).toBe(scenario.closedRun.id);
  expect(state.closedRun?.status).toBe("SETTLED");
  expect(state.taggedShift?.cashierId).toBe(scenario.cashier.id);
  expect(state.taggedShift?.status).toBe(CashierShiftStatus.OPEN);
  expect(state.order?.id).toBe(scenario.remitOrder.id);
  expect(state.order?.status).toBe("PAID");
  expect(state.order?.payments).toHaveLength(2);
  expect(state.cashPayments).toHaveLength(1);
  expect(state.shortageBridgePayments).toHaveLength(1);
  expect(state.varianceCount).toBe(1);
  expect(state.variance?.id).toBe(scenario.varianceId);
  expect(state.variance?.status).toBe("CLOSED");
  expect(state.variance?.resolution).toBe(resolution);
  expect(state.variance?.managerApprovedAt).not.toBeNull();
  expect(state.variance?.managerApprovedById).toBe(scenario.manager.id);
  expect(state.variance?.riderAcceptedAt).toBeNull();
  expect(state.variance?.riderAcceptedById).toBeNull();
  expect(state.variance?.resolvedAt).not.toBeNull();
  expect(state.variance?.shiftId).toBe(state.taggedShift?.id ?? null);
  expect(state.riderChargeCount).toBe(0);
  expect(state.riderCharge).toBeNull();

  if (resolution === "INFO_ONLY") {
    expect(state.variance?.note).toBe(scenario.infoOnlyDecisionNote);
    return;
  }

  expect(state.variance?.note).toBe(scenario.waiveDecisionNote);
}
