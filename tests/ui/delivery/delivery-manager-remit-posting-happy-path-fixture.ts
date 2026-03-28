import "dotenv/config";

import { existsSync } from "node:fs";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryManagerRemitPostingHappyPathArtifacts,
  resetDeliveryManagerRemitPostingHappyPathState,
  resolveDeliveryManagerRemitPostingHappyPathScenarioContext,
} from "../../../scripts/qa/delivery/delivery-manager-remit-posting-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_MANAGER_REMIT_POSTING_HAPPY_PATH_ENABLE_ENV =
  "QA_DELIVERY_MANAGER_REMIT_POSTING_HAPPY_PATH_ENABLE";

export type DeliveryManagerRemitPostingHappyPathScenario =
  Awaited<
    ReturnType<typeof resolveDeliveryManagerRemitPostingHappyPathScenarioContext>
  >;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryManagerRemitPostingHappyPathEnabled() {
  return (
    process.env[DELIVERY_MANAGER_REMIT_POSTING_HAPPY_PATH_ENABLE_ENV] === "1"
  );
}

export async function cleanupDeliveryManagerRemitPostingHappyPathQaState() {
  return deleteDeliveryManagerRemitPostingHappyPathArtifacts();
}

export async function resetDeliveryManagerRemitPostingHappyPathQaState() {
  return resetDeliveryManagerRemitPostingHappyPathState();
}

export async function resolveDeliveryManagerRemitPostingHappyPathScenario() {
  return resolveDeliveryManagerRemitPostingHappyPathScenarioContext();
}

export async function createDeliveryManagerRemitPostingHappyPathManagerContext(
  browser: Browser,
) {
  const scenario = await resolveDeliveryManagerRemitPostingHappyPathScenario();
  const stateFilePath = scenario.managerStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing manager storage state for delivery manager-remit happy path: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

export async function openDeliveryManagerRemitPostingHappyPathManagerRemitPage(
  page: Page,
) {
  const scenario = await resolveDeliveryManagerRemitPostingHappyPathScenario();
  const route = scenario.checkedInRun.routes.managerRemit;

  if (!route) {
    throw new Error(
      "Missing checked-in manager remit route in the delivery manager-remit scenario.",
    );
  }

  const response = await page.goto(toAbsoluteUrl(route), {
    waitUntil: "domcontentloaded",
  });

  expect(response?.ok() ?? true, `Route unreachable: ${route}`).toBeTruthy();
  await page.waitForURL(
    (target) => target.pathname === `/runs/${scenario.checkedInRun.id}/remit`,
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /run remit — manager review/i }),
  ).toBeVisible();
}

export async function resolveDeliveryManagerRemitPostingHappyPathDbState() {
  const scenario = await resolveDeliveryManagerRemitPostingHappyPathScenario();

  const [checkedInRun, pendingClearanceCount, riderVarianceCount, riderChargeCount] =
    await Promise.all([
      db.deliveryRun.findUnique({
        where: { id: scenario.checkedInRun.id },
        select: {
          id: true,
          runCode: true,
          status: true,
          riderId: true,
          riderCheckinAt: true,
          closedAt: true,
        },
      }),
      db.clearanceCase.count({
        where: {
          runId: scenario.checkedInRun.id,
          status: "NEEDS_CLEARANCE",
        },
      }),
      db.riderRunVariance.count({
        where: { runId: scenario.checkedInRun.id },
      }),
      db.riderCharge.count({
        where: { runId: scenario.checkedInRun.id },
      }),
    ]);

  return {
    checkedInRun,
    pendingClearanceCount,
    riderVarianceCount,
    riderChargeCount,
  };
}

export function expectDeliveryManagerRemitPostingHappyPathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryManagerRemitPostingHappyPathDbState>
  >,
  scenario: DeliveryManagerRemitPostingHappyPathScenario,
) {
  expect(state.checkedInRun?.id).toBe(scenario.checkedInRun.id);
  expect(state.checkedInRun?.runCode).toBe(scenario.checkedInRun.runCode);
  expect(state.checkedInRun?.status).toBe("CHECKED_IN");
  expect(state.checkedInRun?.riderCheckinAt).not.toBeNull();
  expect(state.checkedInRun?.closedAt).toBeNull();
  expect(state.pendingClearanceCount).toBe(0);
  expect(state.riderVarianceCount).toBe(0);
  expect(state.riderChargeCount).toBe(0);
}

export function expectDeliveryManagerRemitPostingHappyPathPostedDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryManagerRemitPostingHappyPathDbState>
  >,
  scenario: DeliveryManagerRemitPostingHappyPathScenario,
) {
  expect(state.checkedInRun?.id).toBe(scenario.checkedInRun.id);
  expect(state.checkedInRun?.status).toBe("CLOSED");
  expect(state.pendingClearanceCount).toBe(0);
  expect(state.riderVarianceCount).toBe(0);
  expect(state.riderChargeCount).toBe(0);
}
