import "dotenv/config";

import { existsSync } from "node:fs";
import { CashierShiftStatus } from "@prisma/client";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryCashierOrderRemitPostingHappyPathArtifacts,
  resetDeliveryCashierOrderRemitPostingHappyPathState,
  resolveDeliveryCashierOrderRemitPostingHappyPathScenarioContext,
} from "../../../scripts/qa/delivery/delivery-cashier-order-remit-posting-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_CASHIER_ORDER_REMIT_POSTING_HAPPY_PATH_ENABLE_ENV =
  "QA_DELIVERY_CASHIER_ORDER_REMIT_POSTING_HAPPY_PATH_ENABLE";

export type DeliveryCashierOrderRemitPostingHappyPathScenario =
  Awaited<
    ReturnType<typeof resolveDeliveryCashierOrderRemitPostingHappyPathScenarioContext>
  >;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryCashierOrderRemitPostingHappyPathEnabled() {
  return (
    process.env[
      DELIVERY_CASHIER_ORDER_REMIT_POSTING_HAPPY_PATH_ENABLE_ENV
    ] === "1"
  );
}

export async function cleanupDeliveryCashierOrderRemitPostingHappyPathQaState() {
  return deleteDeliveryCashierOrderRemitPostingHappyPathArtifacts();
}

export async function resetDeliveryCashierOrderRemitPostingHappyPathQaState() {
  return resetDeliveryCashierOrderRemitPostingHappyPathState();
}

export async function resolveDeliveryCashierOrderRemitPostingHappyPathScenario() {
  return resolveDeliveryCashierOrderRemitPostingHappyPathScenarioContext();
}

export async function createDeliveryCashierOrderRemitPostingHappyPathCashierContext(
  browser: Browser,
) {
  const scenario =
    await resolveDeliveryCashierOrderRemitPostingHappyPathScenario();
  const stateFilePath = scenario.cashierStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing cashier storage state for delivery cashier-remit happy path: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

export async function openDeliveryCashierOrderRemitPostingHappyPathOrderRemitPage(
  page: Page,
) {
  const scenario =
    await resolveDeliveryCashierOrderRemitPostingHappyPathScenario();

  const response = await page.goto(toAbsoluteUrl(scenario.remitOrder.remitRoute), {
    waitUntil: "domcontentloaded",
  });

  expect(
    response?.ok() ?? true,
    `Route unreachable: ${scenario.remitOrder.remitRoute}`,
  ).toBeTruthy();
  await page.waitForURL(
    (target) => target.pathname === `/delivery-remit/${scenario.remitOrder.id}`,
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /delivery payment remit/i }),
  ).toBeVisible();
}

export async function resolveDeliveryCashierOrderRemitPostingHappyPathDbState() {
  const scenario =
    await resolveDeliveryCashierOrderRemitPostingHappyPathScenario();

  const [closedRun, order, taggedShift, riderVarianceCount, riderChargeCount] =
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
      db.order.findUnique({
        where: { id: scenario.remitOrder.id },
        select: {
          id: true,
          orderCode: true,
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
          runReceipts: {
            select: {
              id: true,
              kind: true,
              receiptKey: true,
              cashCollected: true,
            },
          },
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
        where: {
          runId: scenario.closedRun.id,
        },
      }),
      db.riderCharge.count({
        where: {
          runId: scenario.closedRun.id,
        },
      }),
    ]);

  const shortageBridgePayments =
    order?.payments.filter(
      (payment) =>
        payment.method === "INTERNAL_CREDIT" &&
        String(payment.refNo ?? "").startsWith("RIDER-SHORTAGE:"),
    ) ?? [];
  const cashPayments =
    order?.payments.filter((payment) => payment.method === "CASH") ?? [];

  return {
    cashPayments,
    closedRun,
    order,
    riderChargeCount,
    riderVarianceCount,
    shortageBridgePayments,
    taggedShift,
  };
}

export function expectDeliveryCashierOrderRemitPostingHappyPathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryCashierOrderRemitPostingHappyPathDbState>
  >,
  scenario: DeliveryCashierOrderRemitPostingHappyPathScenario,
) {
  expect(state.closedRun?.id).toBe(scenario.closedRun.id);
  expect(state.closedRun?.status).toBe("CLOSED");
  expect(state.order?.id).toBe(scenario.remitOrder.id);
  expect(state.order?.orderCode).toBe(scenario.remitOrder.orderCode);
  expect(state.order?.status).toBe("UNPAID");
  expect(state.order?.payments).toHaveLength(0);
  expect(state.order?.runReceipts).toHaveLength(1);
  expect(state.order?.runReceipts[0]?.kind).toBe("PARENT");
  expect(state.order?.runReceipts[0]?.receiptKey).toBe(
    `PARENT:${scenario.remitOrder.id}`,
  );
  expect(Number(state.order?.runReceipts[0]?.cashCollected ?? 0).toFixed(2)).toBe(
    scenario.cashGivenInput,
  );
  expect(state.taggedShift?.cashierId).toBe(scenario.cashier.id);
  expect(state.taggedShift?.deviceId).toBe(scenario.cashierShiftDeviceId);
  expect(state.taggedShift?.status).toBe(CashierShiftStatus.OPEN);
  expect(state.taggedShift?.closedAt).toBeNull();
  expect(state.riderVarianceCount).toBe(0);
  expect(state.riderChargeCount).toBe(0);
  expect(state.shortageBridgePayments).toHaveLength(0);
  expect(state.cashPayments).toHaveLength(0);
}

export function expectDeliveryCashierOrderRemitPostingHappyPathPostedDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryCashierOrderRemitPostingHappyPathDbState>
  >,
  scenario: DeliveryCashierOrderRemitPostingHappyPathScenario,
) {
  expect(state.closedRun?.id).toBe(scenario.closedRun.id);
  expect(state.closedRun?.status).toBe("SETTLED");
  expect(state.order?.id).toBe(scenario.remitOrder.id);
  expect(state.order?.status).toBe("PAID");
  expect(state.order?.paidAt).not.toBeNull();
  expect(state.order?.receiptNo).not.toBeNull();
  expect(state.cashPayments).toHaveLength(1);
  expect(state.cashPayments[0]?.method).toBe("CASH");
  expect(String(state.cashPayments[0]?.refNo ?? "")).toBe("MAIN-DELIVERY");
  expect(Number(state.cashPayments[0]?.amount ?? 0).toFixed(2)).toBe(
    scenario.cashGivenInput,
  );
  expect(state.cashPayments[0]?.shiftId).toBe(state.taggedShift?.id ?? null);
  expect(state.cashPayments[0]?.cashierId).toBe(scenario.cashier.id);
  expect(state.shortageBridgePayments).toHaveLength(0);
  expect(state.riderVarianceCount).toBe(0);
  expect(state.riderChargeCount).toBe(0);
}
