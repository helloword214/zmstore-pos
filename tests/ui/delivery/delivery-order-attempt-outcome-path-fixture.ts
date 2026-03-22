import "dotenv/config";

import { existsSync } from "node:fs";
import { CashierShiftStatus } from "@prisma/client";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryOrderAttemptOutcomePathArtifacts,
  resetDeliveryOrderAttemptOutcomePathState,
  resolveDeliveryOrderAttemptOutcomePathScenarioContext,
} from "../../../scripts/qa/delivery/delivery-order-attempt-outcome-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_ENABLE_ENV =
  "QA_DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_ENABLE";

export type DeliveryOrderAttemptOutcome =
  | "NO_RELEASE_REATTEMPT"
  | "NO_RELEASE_CANCELLED";

export type DeliveryOrderAttemptOutcomePathScenario =
  Awaited<ReturnType<typeof resolveDeliveryOrderAttemptOutcomePathScenarioContext>>;

export type DeliveryOrderAttemptOutcomePathRole =
  | "manager"
  | "rider"
  | "cashier";

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryOrderAttemptOutcomePathEnabled() {
  return process.env[DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_ENABLE_ENV] === "1";
}

export async function cleanupDeliveryOrderAttemptOutcomePathQaState() {
  return deleteDeliveryOrderAttemptOutcomePathArtifacts();
}

export async function resetDeliveryOrderAttemptOutcomePathQaState() {
  return resetDeliveryOrderAttemptOutcomePathState();
}

export async function resolveDeliveryOrderAttemptOutcomePathScenario() {
  return resolveDeliveryOrderAttemptOutcomePathScenarioContext();
}

export async function createDeliveryOrderAttemptOutcomePathRoleContext(
  browser: Browser,
  role: DeliveryOrderAttemptOutcomePathRole,
) {
  const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
  const stateFilePath =
    role === "manager"
      ? scenario.managerStateFilePath
      : role === "rider"
        ? scenario.riderStateFilePath
        : scenario.cashierStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing ${role} storage state for delivery order-attempt-outcome path: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

async function openDeliveryOrderAttemptOutcomePathRoute(args: {
  page: Page;
  route: string;
  expectedPathname: string;
}) {
  const response = await args.page.goto(toAbsoluteUrl(args.route), {
    waitUntil: "domcontentloaded",
  });

  expect(response?.ok() ?? true, `Route unreachable: ${args.route}`).toBeTruthy();
  await args.page.waitForURL(
    (target) => target.pathname === args.expectedPathname,
    { timeout: 10_000 },
  );
}

export async function openDeliveryOrderAttemptOutcomePathRiderCheckinPage(
  page: Page,
) {
  const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
  const route = scenario.activeRun.routes.riderCheckin;

  if (!route) {
    throw new Error("Missing active rider check-in route in the delivery scenario.");
  }

  await openDeliveryOrderAttemptOutcomePathRoute({
    page,
    route,
    expectedPathname: `/runs/${scenario.activeRun.id}/rider-checkin`,
  });
  await expect(
    page.getByRole("heading", { name: /rider check-in/i }),
  ).toBeVisible();
}

export async function openDeliveryOrderAttemptOutcomePathManagerRemitPage(
  page: Page,
) {
  const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
  const route = scenario.activeRun.routes.managerRemit;

  if (!route) {
    throw new Error("Missing active manager remit route in the delivery scenario.");
  }

  await openDeliveryOrderAttemptOutcomePathRoute({
    page,
    route,
    expectedPathname: `/runs/${scenario.activeRun.id}/remit`,
  });
  await expect(
    page.getByRole("heading", { name: /run remit — manager review/i }),
  ).toBeVisible();
}

export async function openDeliveryOrderAttemptOutcomePathDispatchPage(
  page: Page,
) {
  const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
  await openDeliveryOrderAttemptOutcomePathRoute({
    page,
    route: scenario.dispatchRoute,
    expectedPathname: "/store/dispatch",
  });
}

export async function openDeliveryOrderAttemptOutcomePathCashierRunRemitPage(
  page: Page,
) {
  const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();

  await openDeliveryOrderAttemptOutcomePathRoute({
    page,
    route: scenario.cashierRunRemitRoute,
    expectedPathname: `/cashier/delivery/${scenario.activeRun.id}`,
  });
  await expect(
    page.getByRole("heading", { name: /delivery run remit/i }),
  ).toBeVisible();
}

async function resolveAttemptNoteInput(page: Page) {
  const placeholderNote = page.getByPlaceholder(
    "Reason / note for manager (optional)",
  );
  if ((await placeholderNote.count()) > 0) {
    return placeholderNote.first();
  }

  const labelledInput = page
    .locator("label")
    .filter({ hasText: "Message to manager (required)" })
    .locator("input[type='text']");

  if ((await labelledInput.count()) > 0) {
    return labelledInput.first();
  }

  return page.locator("textarea").first();
}

export async function submitDeliveryOrderAttemptOutcomeRiderCheckin(args: {
  page: Page;
  scenario: DeliveryOrderAttemptOutcomePathScenario;
  outcome: DeliveryOrderAttemptOutcome;
  note: string;
}) {
  const targetLabel =
    args.outcome === "NO_RELEASE_REATTEMPT"
      ? /^Return to dispatch$/
      : /^Cancel before release$/;
  const attemptLabel = args.page
    .locator("label")
    .filter({ hasText: targetLabel })
    .first();
  const cashInput = args.page.getByRole("textbox", {
    name: "Cash received:",
  });

  await expect(attemptLabel).toBeVisible();
  await attemptLabel.click();

  await expect(
    args.page.locator('input[name="parentAttemptJson"]'),
  ).toHaveValue(new RegExp(args.outcome));
  await expect(cashInput).toBeDisabled();

  const attemptRadios = args.page.locator(
    `input[name="attempt-ui-${args.scenario.activeOrder.id}"]`,
  );
  await expect(attemptRadios).toHaveCount(3);

  const noteInput = await resolveAttemptNoteInput(args.page);
  await noteInput.fill(args.note);

  const submitButton = args.page.getByRole("button", {
    name: /submit check-in/i,
  });
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await args.page.waitForURL(
    (target) =>
      target.pathname === `/runs/${args.scenario.activeRun.id}/summary` &&
      target.searchParams.get("checkin") === "1",
    { timeout: 10_000 },
  );
}

export async function finalizeDeliveryOrderAttemptOutcomeOnManagerRemit(args: {
  page: Page;
  scenario: DeliveryOrderAttemptOutcomePathScenario;
  outcome: DeliveryOrderAttemptOutcome;
  markMissing: boolean;
}) {
  await expect(
    args.page.locator(`input[name="attemptOutcome_${args.scenario.activeOrder.id}"]`),
  ).toHaveValue(args.outcome);

  if (args.markMissing) {
    const verifyRadios = args.page.locator(
      `input[name="verify_ui_${args.scenario.productId}"]`,
    );
    await expect(verifyRadios).toHaveCount(2);
    await verifyRadios.nth(1).check({ force: true });
    await expect(
      args.page.locator(`input[name="verify_${args.scenario.productId}"]`),
    ).toHaveValue("missing");

    args.page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await args.page
      .getByRole("button", {
        name: /charge rider \(missing stocks\) & close run/i,
      })
      .click();
  } else {
    await expect(
      args.page.locator(`input[name="verify_${args.scenario.productId}"]`),
    ).toHaveValue("present");
    await args.page
      .getByRole("button", { name: /approve remit & close run/i })
      .click();
  }

  await args.page.waitForURL(
    (target) =>
      target.pathname === `/runs/${args.scenario.activeRun.id}/summary` &&
      target.searchParams.get("posted") === "1",
    { timeout: 10_000 },
  );
}

export async function resolveDeliveryOrderAttemptOutcomePathDbState() {
  const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();

  const [activeRun, activeOrder, runLink, parentReceipt, clearances, riderVariance] =
    await Promise.all([
      db.deliveryRun.findUnique({
        where: { id: scenario.activeRun.id },
        select: {
          id: true,
          status: true,
          riderId: true,
          riderCheckinAt: true,
          riderCheckinSnapshot: true,
          closedAt: true,
        },
      }),
      db.order.findUnique({
        where: { id: scenario.activeOrder.id },
        select: {
          id: true,
          orderCode: true,
          status: true,
          fulfillmentStatus: true,
          dispatchedAt: true,
          deliveredAt: true,
        },
      }),
      db.deliveryRunOrder.findUnique({
        where: {
          runId_orderId: {
            runId: scenario.activeRun.id,
            orderId: scenario.activeOrder.id,
          },
        },
        select: {
          runId: true,
          orderId: true,
          attemptOutcome: true,
          attemptNote: true,
          attemptReportedAt: true,
          attemptFinalizedAt: true,
          attemptFinalizedById: true,
        },
      }),
      db.runReceipt.findFirst({
        where: {
          runId: scenario.activeRun.id,
          parentOrderId: scenario.activeOrder.id,
        },
        select: {
          id: true,
          receiptKey: true,
          cashCollected: true,
        },
      }),
      db.clearanceCase.findMany({
        where: { runId: scenario.activeRun.id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          receiptKey: true,
          status: true,
        },
      }),
      db.riderRunVariance.findFirst({
        where: { runId: scenario.activeRun.id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          runId: true,
          riderId: true,
          status: true,
          resolution: true,
          expected: true,
          actual: true,
          variance: true,
          note: true,
          managerApprovedAt: true,
          managerApprovedById: true,
        },
      }),
    ]);

  const riderCharge = riderVariance
    ? await db.riderCharge.findUnique({
        where: { varianceId: riderVariance.id },
        select: {
          id: true,
          varianceId: true,
          runId: true,
          riderId: true,
          amount: true,
          status: true,
          note: true,
          createdById: true,
        },
      })
    : null;

  const dispatchEligibleOrderCount = await db.order.count({
    where: {
      id: scenario.activeOrder.id,
      channel: "DELIVERY",
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dispatchedAt: null,
    },
  });

  const taggedShift = await db.cashierShift.findFirst({
    where: {
      cashierId: scenario.cashier.id,
      closedAt: null,
      deviceId: scenario.cashierShiftDeviceId,
    },
    orderBy: { openedAt: "desc" },
    select: {
      id: true,
      status: true,
      closedAt: true,
      deviceId: true,
    },
  });

  return {
    activeOrder,
    activeRun,
    clearances,
    dispatchEligibleOrderCount,
    parentReceipt,
    riderCharge,
    riderVariance,
    runLink,
    taggedShift,
  };
}

export function expectDeliveryOrderAttemptOutcomePathInitialDbState(
  state: Awaited<ReturnType<typeof resolveDeliveryOrderAttemptOutcomePathDbState>>,
  scenario: DeliveryOrderAttemptOutcomePathScenario,
) {
  expect(state.activeRun?.id).toBe(scenario.activeRun.id);
  expect(state.activeRun?.status).toBe("DISPATCHED");
  expect(state.activeRun?.riderId).toBe(scenario.rider.employee?.id ?? null);
  expect(state.activeRun?.riderCheckinAt).toBeNull();
  expect(state.activeRun?.closedAt).toBeNull();

  expect(state.activeOrder?.id).toBe(scenario.activeOrder.id);
  expect(state.activeOrder?.orderCode).toBe(scenario.activeOrder.orderCode);
  expect(state.activeOrder?.status).toBe("UNPAID");
  expect(state.activeOrder?.fulfillmentStatus).toBe("DISPATCHED");
  expect(state.activeOrder?.dispatchedAt).not.toBeNull();
  expect(state.activeOrder?.deliveredAt).toBeNull();

  expect(state.runLink?.attemptOutcome).toBeNull();
  expect(state.runLink?.attemptNote).toBeNull();
  expect(state.runLink?.attemptReportedAt).toBeNull();
  expect(state.runLink?.attemptFinalizedAt).toBeNull();
  expect(state.runLink?.attemptFinalizedById).toBeNull();

  expect(state.parentReceipt).toBeNull();
  expect(state.clearances).toHaveLength(0);
  expect(state.dispatchEligibleOrderCount).toBe(0);
  expect(state.riderVariance).toBeNull();
  expect(state.riderCharge).toBeNull();

  expect(state.taggedShift?.status).toBe(CashierShiftStatus.OPEN);
  expect(state.taggedShift?.closedAt).toBeNull();
  expect(state.taggedShift?.deviceId).toBe(scenario.cashierShiftDeviceId);
}

export function expectDeliveryOrderAttemptOutcomePathReattemptDbState(args: {
  note: string;
  scenario: DeliveryOrderAttemptOutcomePathScenario;
  state: Awaited<ReturnType<typeof resolveDeliveryOrderAttemptOutcomePathDbState>>;
}) {
  expect(args.state.activeRun?.status).toBe("CLOSED");
  expect(args.state.activeOrder?.status).toBe("UNPAID");
  expect(args.state.activeOrder?.fulfillmentStatus).toBe("ON_HOLD");
  expect(args.state.activeOrder?.dispatchedAt).toBeNull();
  expect(args.state.activeOrder?.deliveredAt).toBeNull();

  expect(args.state.runLink?.attemptOutcome).toBe("NO_RELEASE_REATTEMPT");
  expect(args.state.runLink?.attemptNote).toBe(args.note);
  expect(args.state.runLink?.attemptReportedAt).not.toBeNull();
  expect(args.state.runLink?.attemptFinalizedAt).not.toBeNull();
  expect(args.state.runLink?.attemptFinalizedById).toBe(args.scenario.manager.id);

  expect(args.state.parentReceipt?.receiptKey).toBe(
    `PARENT:${args.scenario.activeOrder.id}`,
  );
  expect(Number(args.state.parentReceipt?.cashCollected ?? 0).toFixed(2)).toBe(
    "0.00",
  );
  expect(args.state.clearances).toHaveLength(0);
  expect(args.state.dispatchEligibleOrderCount).toBe(1);
  expect(args.state.riderVariance).toBeNull();
  expect(args.state.riderCharge).toBeNull();
}

export function expectDeliveryOrderAttemptOutcomePathCancelledDbState(args: {
  note: string;
  scenario: DeliveryOrderAttemptOutcomePathScenario;
  state: Awaited<ReturnType<typeof resolveDeliveryOrderAttemptOutcomePathDbState>>;
}) {
  expect(args.state.activeRun?.status).toBe("CLOSED");
  expect(args.state.activeOrder?.status).toBe("CANCELLED");
  expect(args.state.activeOrder?.fulfillmentStatus).toBe("ON_HOLD");
  expect(args.state.activeOrder?.dispatchedAt).toBeNull();
  expect(args.state.activeOrder?.deliveredAt).toBeNull();

  expect(args.state.runLink?.attemptOutcome).toBe("NO_RELEASE_CANCELLED");
  expect(args.state.runLink?.attemptNote).toBe(args.note);
  expect(args.state.runLink?.attemptReportedAt).not.toBeNull();
  expect(args.state.runLink?.attemptFinalizedAt).not.toBeNull();
  expect(args.state.runLink?.attemptFinalizedById).toBe(args.scenario.manager.id);

  expect(args.state.parentReceipt?.receiptKey).toBe(
    `PARENT:${args.scenario.activeOrder.id}`,
  );
  expect(Number(args.state.parentReceipt?.cashCollected ?? 0).toFixed(2)).toBe(
    "0.00",
  );
  expect(args.state.clearances).toHaveLength(0);
  expect(args.state.dispatchEligibleOrderCount).toBe(0);
  expect(args.state.riderVariance).toBeNull();
  expect(args.state.riderCharge).toBeNull();
}

export function expectDeliveryOrderAttemptOutcomePathMissingChargeDbState(args: {
  note: string;
  scenario: DeliveryOrderAttemptOutcomePathScenario;
  state: Awaited<ReturnType<typeof resolveDeliveryOrderAttemptOutcomePathDbState>>;
}) {
  expect(args.state.activeRun?.status).toBe("CLOSED");
  expect(args.state.activeOrder?.status).toBe("UNPAID");
  expect(args.state.activeOrder?.fulfillmentStatus).toBe("ON_HOLD");
  expect(args.state.activeOrder?.dispatchedAt).toBeNull();

  expect(args.state.runLink?.attemptOutcome).toBe("NO_RELEASE_REATTEMPT");
  expect(args.state.runLink?.attemptNote).toBe(args.note);
  expect(args.state.runLink?.attemptReportedAt).not.toBeNull();
  expect(args.state.runLink?.attemptFinalizedAt).not.toBeNull();
  expect(args.state.runLink?.attemptFinalizedById).toBe(args.scenario.manager.id);

  expect(args.state.parentReceipt?.receiptKey).toBe(
    `PARENT:${args.scenario.activeOrder.id}`,
  );
  expect(Number(args.state.parentReceipt?.cashCollected ?? 0).toFixed(2)).toBe(
    "0.00",
  );
  expect(args.state.clearances).toHaveLength(0);
  expect(args.state.dispatchEligibleOrderCount).toBe(1);

  expect(args.state.riderVariance?.status).toBe("MANAGER_APPROVED");
  expect(args.state.riderVariance?.resolution).toBe("CHARGE_RIDER");
  expect(args.state.riderVariance?.managerApprovedAt).not.toBeNull();
  expect(args.state.riderVariance?.managerApprovedById).toBe(
    args.scenario.manager.id,
  );
  expect(Number(args.state.riderVariance?.expected ?? 0)).toBeGreaterThan(0);
  expect(Number(args.state.riderVariance?.variance ?? 0)).toBeLessThan(0);
  expect(String(args.state.riderVariance?.note ?? "")).toContain(
    "AUTO: remit stock shortage charge",
  );

  expect(args.state.riderCharge?.status).toBe("OPEN");
  expect(args.state.riderCharge?.createdById).toBe(args.scenario.manager.id);
  expect(Number(args.state.riderCharge?.amount ?? 0)).toBeGreaterThan(0);
  expect(String(args.state.riderCharge?.note ?? "")).toContain(
    "AUTO: remit stock shortage charge",
  );
}
