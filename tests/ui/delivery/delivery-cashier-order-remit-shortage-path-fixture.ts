import "dotenv/config";

import { existsSync } from "node:fs";
import { CashierShiftStatus } from "@prisma/client";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryCashierOrderRemitShortagePathArtifacts,
  resetDeliveryCashierOrderRemitShortagePathState,
  resolveDeliveryCashierOrderRemitShortagePathScenarioContext,
} from "../../../scripts/qa/delivery/delivery-cashier-order-remit-shortage-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_CASHIER_ORDER_REMIT_SHORTAGE_PATH_ENABLE_ENV =
  "QA_DELIVERY_CASHIER_ORDER_REMIT_SHORTAGE_PATH_ENABLE";

export type DeliveryCashierOrderRemitShortagePathScenario =
  Awaited<
    ReturnType<typeof resolveDeliveryCashierOrderRemitShortagePathScenarioContext>
  >;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryCashierOrderRemitShortagePathEnabled() {
  return (
    process.env[DELIVERY_CASHIER_ORDER_REMIT_SHORTAGE_PATH_ENABLE_ENV] === "1"
  );
}

export async function cleanupDeliveryCashierOrderRemitShortagePathQaState() {
  return deleteDeliveryCashierOrderRemitShortagePathArtifacts();
}

export async function resetDeliveryCashierOrderRemitShortagePathQaState() {
  return resetDeliveryCashierOrderRemitShortagePathState();
}

export async function resolveDeliveryCashierOrderRemitShortagePathScenario() {
  return resolveDeliveryCashierOrderRemitShortagePathScenarioContext();
}

export async function createDeliveryCashierOrderRemitShortagePathCashierContext(
  browser: Browser,
) {
  const scenario = await resolveDeliveryCashierOrderRemitShortagePathScenario();
  const stateFilePath = scenario.cashierStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing cashier storage state for delivery cashier-remit shortage path: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

export async function openDeliveryCashierOrderRemitShortagePathOrderRemitPage(
  page: Page,
) {
  const scenario = await resolveDeliveryCashierOrderRemitShortagePathScenario();

  await page.goto(toAbsoluteUrl(scenario.remitOrder.remitRoute), {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(
    (target) => target.pathname === `/delivery-remit/${scenario.remitOrder.id}`,
    { timeout: 10_000 },
  );
  await expect(
    page.getByRole("heading", { name: /delivery payment remit/i }),
  ).toBeVisible();
}

export async function describeDeliveryCashierOrderRemitShortagePathPage(
  page: Page,
) {
  const currentUrl = new URL(page.url());
  const headings = await page.getByRole("heading").allTextContents();
  const bodyText = ((await page.locator("body").textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const bodySnippet = bodyText.slice(0, 500);

  return {
    url: page.url(),
    pathname: currentUrl.pathname,
    heading: headings[0] ?? null,
    bodySnippet,
  };
}

export async function resolveDeliveryCashierOrderRemitShortagePathDbState() {
  const scenario = await resolveDeliveryCashierOrderRemitShortagePathScenario();

  const [closedRun, order, taggedShift, riderChargeCount] = await Promise.all([
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
          orderBy: { id: "asc" },
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
    db.riderCharge.count({
      where: { runId: scenario.closedRun.id },
    }),
  ]);

  const parentReceiptId = order?.runReceipts[0]?.id ?? null;
  const riderVariance = parentReceiptId
    ? await db.riderRunVariance.findUnique({
        where: { receiptId: parentReceiptId },
        select: {
          id: true,
          runId: true,
          shiftId: true,
          receiptId: true,
          expected: true,
          actual: true,
          variance: true,
          status: true,
        },
      })
    : null;

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
    riderVariance,
    shortageBridgePayments,
    taggedShift,
  };
}

export function expectDeliveryCashierOrderRemitShortagePathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryCashierOrderRemitShortagePathDbState>
  >,
  scenario: DeliveryCashierOrderRemitShortagePathScenario,
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
    scenario.exactCashInput,
  );
  expect(state.taggedShift?.cashierId).toBe(scenario.cashier.id);
  expect(state.taggedShift?.deviceId).toBe(scenario.cashierShiftDeviceId);
  expect(state.taggedShift?.status).toBe(CashierShiftStatus.OPEN);
  expect(state.taggedShift?.closedAt).toBeNull();
  expect(state.riderVariance).toBeNull();
  expect(state.riderChargeCount).toBe(0);
  expect(state.shortageBridgePayments).toHaveLength(0);
  expect(state.cashPayments).toHaveLength(0);
}

export function expectDeliveryCashierOrderRemitShortagePathPostedDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryCashierOrderRemitShortagePathDbState>
  >,
  scenario: DeliveryCashierOrderRemitShortagePathScenario,
) {
  expect(state.closedRun?.id).toBe(scenario.closedRun.id);
  expect(state.closedRun?.status).toBe("CLOSED");
  expect(state.order?.id).toBe(scenario.remitOrder.id);
  expect(state.order?.status).toBe("PAID");
  expect(state.order?.paidAt).not.toBeNull();
  expect(state.order?.receiptNo).not.toBeNull();
  expect(state.order?.payments).toHaveLength(2);
  expect(state.cashPayments).toHaveLength(1);
  expect(state.cashPayments[0]?.method).toBe("CASH");
  expect(String(state.cashPayments[0]?.refNo ?? "")).toBe("MAIN-DELIVERY");
  expect(Number(state.cashPayments[0]?.amount ?? 0).toFixed(2)).toBe(
    scenario.shortageCashInput,
  );
  expect(state.cashPayments[0]?.shiftId).toBe(state.taggedShift?.id ?? null);
  expect(state.cashPayments[0]?.cashierId).toBe(scenario.cashier.id);
  expect(state.shortageBridgePayments).toHaveLength(1);
  expect(String(state.shortageBridgePayments[0]?.refNo ?? "")).toMatch(
    /^RIDER-SHORTAGE:/,
  );
  expect(Number(state.shortageBridgePayments[0]?.amount ?? 0).toFixed(2)).toBe(
    scenario.shortageAmountInput,
  );
  expect(state.shortageBridgePayments[0]?.shiftId).toBe(
    state.taggedShift?.id ?? null,
  );
  expect(state.shortageBridgePayments[0]?.cashierId).toBe(scenario.cashier.id);
  expect(state.riderVariance?.runId).toBe(scenario.closedRun.id);
  expect(state.riderVariance?.shiftId).toBe(state.taggedShift?.id ?? null);
  expect(state.riderVariance?.receiptId).toBe(
    state.order?.runReceipts[0]?.id ?? null,
  );
  expect(Number(state.riderVariance?.expected ?? 0).toFixed(2)).toBe(
    scenario.exactCashInput,
  );
  expect(Number(state.riderVariance?.actual ?? 0).toFixed(2)).toBe(
    scenario.shortageCashInput,
  );
  expect(
    Number(state.riderVariance?.variance ?? 0).toFixed(2),
  ).toBe(
    (
      Number(scenario.shortageCashInput) - Number(scenario.exactCashInput)
    ).toFixed(2),
  );
  expect(state.riderVariance?.status).toBe("OPEN");
  expect(state.riderChargeCount).toBe(0);
}
