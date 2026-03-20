import "dotenv/config";

import { existsSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryRiderAcceptancePathArtifacts,
  resetDeliveryRiderAcceptancePathState,
  resolveDeliveryRiderAcceptancePathScenarioContext,
} from "../../../scripts/qa/delivery/delivery-rider-acceptance-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_RIDER_ACCEPTANCE_PATH_ENABLE_ENV =
  "QA_DELIVERY_RIDER_ACCEPTANCE_PATH_ENABLE";

export type DeliveryRiderAcceptancePathScenario =
  Awaited<ReturnType<typeof resolveDeliveryRiderAcceptancePathScenarioContext>>;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryRiderAcceptancePathEnabled() {
  return process.env[DELIVERY_RIDER_ACCEPTANCE_PATH_ENABLE_ENV] === "1";
}

export async function cleanupDeliveryRiderAcceptancePathQaState() {
  return deleteDeliveryRiderAcceptancePathArtifacts();
}

export async function resetDeliveryRiderAcceptancePathQaState() {
  return resetDeliveryRiderAcceptancePathState();
}

export async function resolveDeliveryRiderAcceptancePathScenario() {
  return resolveDeliveryRiderAcceptancePathScenarioContext();
}

export async function createDeliveryRiderAcceptancePathRiderContext(
  browser: Browser,
) {
  const scenario = await resolveDeliveryRiderAcceptancePathScenario();
  const stateFilePath = scenario.riderStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing rider storage state for delivery rider-acceptance path: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

export async function openDeliveryRiderAcceptancePathPage(page: Page) {
  const scenario = await resolveDeliveryRiderAcceptancePathScenario();

  const response = await page.goto(toAbsoluteUrl(scenario.riderAcceptanceRoute), {
    waitUntil: "domcontentloaded",
  });

  expect(
    response?.ok() ?? true,
    `Route unreachable: ${scenario.riderAcceptanceRoute}`,
  ).toBeTruthy();
  await page.waitForURL(
    (target) => target.pathname === `/rider/variance/${scenario.varianceId}`,
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: new RegExp(`Variance #${scenario.varianceId}`, "i") }),
  ).toBeVisible();
}

export async function resolveDeliveryRiderAcceptancePathDbState() {
  const scenario = await resolveDeliveryRiderAcceptancePathScenario();

  const [variance, riderCharge] = await Promise.all([
    db.riderRunVariance.findUnique({
      where: { id: scenario.varianceId },
      select: {
        id: true,
        runId: true,
        riderId: true,
        status: true,
        resolution: true,
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
      },
    }),
  ]);

  const duplicateChargeCount = await db.riderCharge.count({
    where: { varianceId: scenario.varianceId },
  });

  return {
    duplicateChargeCount,
    riderCharge,
    variance,
  };
}

export function expectDeliveryRiderAcceptancePathInitialDbState(
  state: Awaited<ReturnType<typeof resolveDeliveryRiderAcceptancePathDbState>>,
  scenario: DeliveryRiderAcceptancePathScenario,
) {
  expect(state.variance?.id).toBe(scenario.varianceId);
  expect(state.variance?.status).toBe("MANAGER_APPROVED");
  expect(state.variance?.resolution).toBe("CHARGE_RIDER");
  expect(state.variance?.managerApprovedAt).not.toBeNull();
  expect(state.variance?.managerApprovedById).toBe(scenario.manager.id);
  expect(state.variance?.riderAcceptedAt).toBeNull();
  expect(state.variance?.riderAcceptedById).toBeNull();
  expect(state.variance?.note).toBe(scenario.decisionNote);
  expect(state.riderCharge?.varianceId).toBe(scenario.varianceId);
  expect(state.riderCharge?.status).toBe("OPEN");
  expect(state.riderCharge?.createdById).toBe(scenario.manager.id);
  expect(state.duplicateChargeCount).toBe(1);
}

export function expectDeliveryRiderAcceptancePathPostedDbState(
  state: Awaited<ReturnType<typeof resolveDeliveryRiderAcceptancePathDbState>>,
  scenario: DeliveryRiderAcceptancePathScenario,
) {
  expect(state.variance?.id).toBe(scenario.varianceId);
  expect(state.variance?.status).toBe("RIDER_ACCEPTED");
  expect(state.variance?.resolution).toBe("CHARGE_RIDER");
  expect(state.variance?.managerApprovedAt).not.toBeNull();
  expect(state.variance?.managerApprovedById).toBe(scenario.manager.id);
  expect(state.variance?.riderAcceptedAt).not.toBeNull();
  expect(state.variance?.riderAcceptedById).toBe(scenario.rider.id);
  expect(state.riderCharge?.varianceId).toBe(scenario.varianceId);
  expect(state.riderCharge?.status).toBe("OPEN");
  expect(state.duplicateChargeCount).toBe(1);
}
