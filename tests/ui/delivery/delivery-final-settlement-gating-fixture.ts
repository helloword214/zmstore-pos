import "dotenv/config";

import { existsSync } from "node:fs";
import { CashierShiftStatus } from "@prisma/client";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryFinalSettlementGatingArtifacts,
  resetDeliveryFinalSettlementGatingState,
  resolveDeliveryFinalSettlementGatingScenarioContext,
} from "../../../scripts/qa/delivery/delivery-final-settlement-gating-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_FINAL_SETTLEMENT_GATING_ENABLE_ENV =
  "QA_DELIVERY_FINAL_SETTLEMENT_GATING_ENABLE";

export type DeliveryFinalSettlementGatingScenario = Awaited<
  ReturnType<typeof resolveDeliveryFinalSettlementGatingScenarioContext>
>;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryFinalSettlementGatingEnabled() {
  return process.env[DELIVERY_FINAL_SETTLEMENT_GATING_ENABLE_ENV] === "1";
}

export async function cleanupDeliveryFinalSettlementGatingQaState() {
  return deleteDeliveryFinalSettlementGatingArtifacts();
}

export async function resetDeliveryFinalSettlementGatingQaState() {
  return resetDeliveryFinalSettlementGatingState();
}

export async function resolveDeliveryFinalSettlementGatingScenario() {
  return resolveDeliveryFinalSettlementGatingScenarioContext();
}

export async function createDeliveryFinalSettlementGatingCashierContext(
  browser: Browser,
) {
  const scenario = await resolveDeliveryFinalSettlementGatingScenario();
  const stateFilePath = scenario.cashierStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing cashier storage state for delivery final-settlement gating: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

export async function openDeliveryFinalSettlementGatingRunHubPage(page: Page) {
  const scenario = await resolveDeliveryFinalSettlementGatingScenario();

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

export async function resolveDeliveryFinalSettlementGatingDbState() {
  const scenario = await resolveDeliveryFinalSettlementGatingScenario();

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

export function expectDeliveryFinalSettlementGatingInitialDbState(
  state: Awaited<ReturnType<typeof resolveDeliveryFinalSettlementGatingDbState>>,
  scenario: DeliveryFinalSettlementGatingScenario,
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
  expect(state.variance?.status).toBe("RIDER_ACCEPTED");
  expect(state.variance?.resolution).toBe("CHARGE_RIDER");
  expect(state.variance?.managerApprovedAt).not.toBeNull();
  expect(state.variance?.managerApprovedById).toBe(scenario.manager.id);
  expect(state.variance?.riderAcceptedAt).not.toBeNull();
  expect(state.variance?.riderAcceptedById).toBe(scenario.rider.id);
  expect(state.variance?.resolvedAt).toBeNull();
  expect(state.variance?.shiftId).toBe(state.taggedShift?.id ?? null);
  expect(state.riderChargeCount).toBe(1);
  expect(state.riderCharge?.varianceId).toBe(scenario.varianceId);
  expect(state.riderCharge?.runId).toBe(scenario.closedRun.id);
  expect(state.riderCharge?.status).toBe("OPEN");
  expect(state.riderCharge?.createdById).toBe(scenario.manager.id);
  expect(state.riderCharge?.settledAt).toBeNull();
}

export function expectDeliveryFinalSettlementGatingPostedDbState(
  state: Awaited<ReturnType<typeof resolveDeliveryFinalSettlementGatingDbState>>,
  scenario: DeliveryFinalSettlementGatingScenario,
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
  expect(state.variance?.resolution).toBe("CHARGE_RIDER");
  expect(state.variance?.managerApprovedAt).not.toBeNull();
  expect(state.variance?.managerApprovedById).toBe(scenario.manager.id);
  expect(state.variance?.riderAcceptedAt).not.toBeNull();
  expect(state.variance?.riderAcceptedById).toBe(scenario.rider.id);
  expect(state.variance?.resolvedAt).not.toBeNull();
  expect(state.variance?.shiftId).toBe(state.taggedShift?.id ?? null);
  expect(state.riderChargeCount).toBe(1);
  expect(state.riderCharge?.varianceId).toBe(scenario.varianceId);
  expect(state.riderCharge?.runId).toBe(scenario.closedRun.id);
  expect(state.riderCharge?.status).toBe("OPEN");
  expect(state.riderCharge?.createdById).toBe(scenario.manager.id);
  expect(state.riderCharge?.settledAt).toBeNull();
}
