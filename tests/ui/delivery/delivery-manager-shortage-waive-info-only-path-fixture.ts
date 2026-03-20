import "dotenv/config";

import { existsSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryManagerShortageWaiveInfoOnlyPathArtifacts,
  resetDeliveryManagerShortageWaiveInfoOnlyPathState,
  resolveDeliveryManagerShortageWaiveInfoOnlyPathScenarioContext,
} from "../../../scripts/qa/delivery/delivery-manager-shortage-waive-info-only-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_MANAGER_SHORTAGE_WAIVE_INFO_ONLY_PATH_ENABLE_ENV =
  "QA_DELIVERY_MANAGER_SHORTAGE_WAIVE_INFO_ONLY_PATH_ENABLE";

export type DeliveryManagerShortageWaiveInfoOnlyResolution =
  | "INFO_ONLY"
  | "WAIVE";

export type DeliveryManagerShortageWaiveInfoOnlyPathScenario =
  Awaited<
    ReturnType<
      typeof resolveDeliveryManagerShortageWaiveInfoOnlyPathScenarioContext
    >
  >;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryManagerShortageWaiveInfoOnlyPathEnabled() {
  return (
    process.env[DELIVERY_MANAGER_SHORTAGE_WAIVE_INFO_ONLY_PATH_ENABLE_ENV] ===
    "1"
  );
}

export async function cleanupDeliveryManagerShortageWaiveInfoOnlyPathQaState() {
  return deleteDeliveryManagerShortageWaiveInfoOnlyPathArtifacts();
}

export async function resetDeliveryManagerShortageWaiveInfoOnlyPathQaState() {
  return resetDeliveryManagerShortageWaiveInfoOnlyPathState();
}

export async function resolveDeliveryManagerShortageWaiveInfoOnlyPathScenario() {
  return resolveDeliveryManagerShortageWaiveInfoOnlyPathScenarioContext();
}

export async function createDeliveryManagerShortageWaiveInfoOnlyPathManagerContext(
  browser: Browser,
) {
  const scenario =
    await resolveDeliveryManagerShortageWaiveInfoOnlyPathScenario();
  const stateFilePath = scenario.managerStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing manager storage state for delivery manager-shortage waive/info-only path: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

export async function openDeliveryManagerShortageWaiveInfoOnlyPathReviewPage(
  page: Page,
) {
  const scenario =
    await resolveDeliveryManagerShortageWaiveInfoOnlyPathScenario();

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

export async function resolveDeliveryManagerShortageWaiveInfoOnlyPathDbState() {
  const scenario =
    await resolveDeliveryManagerShortageWaiveInfoOnlyPathScenario();

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
        riderAcceptedById: true,
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

export function expectDeliveryManagerShortageWaiveInfoOnlyPathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryManagerShortageWaiveInfoOnlyPathDbState>
  >,
  scenario: DeliveryManagerShortageWaiveInfoOnlyPathScenario,
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
  expect(state.variance?.riderAcceptedById).toBeNull();
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

export function expectDeliveryManagerShortageWaiveInfoOnlyPathPostedDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryManagerShortageWaiveInfoOnlyPathDbState>
  >,
  scenario: DeliveryManagerShortageWaiveInfoOnlyPathScenario,
  resolution: DeliveryManagerShortageWaiveInfoOnlyResolution,
) {
  expect(state.order?.id).toBe(scenario.remitOrder.id);
  expect(state.order?.status).toBe("PAID");
  expect(state.shortageBridgePayments).toHaveLength(1);
  expect(Number(state.shortageBridgePayments[0]?.amount ?? 0).toFixed(2)).toBe(
    scenario.shortageAmountInput,
  );
  expect(state.variance?.id).toBe(scenario.varianceId);
  expect(state.variance?.managerApprovedAt).not.toBeNull();
  expect(state.variance?.managerApprovedById).toBe(scenario.manager.id);
  expect(state.variance?.riderAcceptedAt).toBeNull();
  expect(state.variance?.riderAcceptedById).toBeNull();
  expect(state.riderCharge).toBeNull();

  if (resolution === "INFO_ONLY") {
    expect(state.variance?.status).toBe("MANAGER_APPROVED");
    expect(state.variance?.resolution).toBe("INFO_ONLY");
    expect(state.variance?.note).toBe(scenario.infoOnlyDecisionNote);
    return;
  }

  expect(state.variance?.status).toBe("WAIVED");
  expect(state.variance?.resolution).toBe("WAIVE");
  expect(state.variance?.note).toBe(scenario.waiveDecisionNote);
}
