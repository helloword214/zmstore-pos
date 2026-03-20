import "dotenv/config";

import { existsSync } from "node:fs";
import { CashierShiftStatus, UserRole } from "@prisma/client";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryRunHandoffAndRemitAccessHappyPathArtifacts,
  resetDeliveryRunHandoffAndRemitAccessHappyPathState,
  resolveDeliveryRunHandoffAndRemitAccessHappyPathScenarioContext,
} from "../../../scripts/qa/delivery/delivery-run-handoff-and-remit-access-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_ENABLE_ENV =
  "QA_DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_ENABLE";

export type DeliveryRunHandoffAndRemitAccessHappyPathScenario =
  Awaited<
    ReturnType<typeof resolveDeliveryRunHandoffAndRemitAccessHappyPathScenarioContext>
  >;

export type DeliveryRunHandoffAndRemitAccessHappyPathRole =
  | "manager"
  | "rider"
  | "cashier";

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryRunHandoffAndRemitAccessHappyPathEnabled() {
  return (
    process.env[DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_ENABLE_ENV] ===
    "1"
  );
}

export async function cleanupDeliveryRunHandoffAndRemitAccessHappyPathQaState() {
  return deleteDeliveryRunHandoffAndRemitAccessHappyPathArtifacts();
}

export async function resetDeliveryRunHandoffAndRemitAccessHappyPathQaState() {
  return resetDeliveryRunHandoffAndRemitAccessHappyPathState();
}

export async function resolveDeliveryRunHandoffAndRemitAccessHappyPathScenario() {
  return resolveDeliveryRunHandoffAndRemitAccessHappyPathScenarioContext();
}

export async function createDeliveryRunHandoffAndRemitAccessHappyPathRoleContext(
  browser: Browser,
  role: DeliveryRunHandoffAndRemitAccessHappyPathRole,
) {
  const scenario = await resolveDeliveryRunHandoffAndRemitAccessHappyPathScenario();
  const stateFilePath =
    role === "manager"
      ? scenario.managerStateFilePath
      : role === "rider"
        ? scenario.riderStateFilePath
        : scenario.cashierStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing ${role} storage state for delivery handoff/remit happy path: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

async function openDeliveryRunHandoffAndRemitAccessHappyPathRoute(args: {
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
    {
      timeout: 10_000,
    },
  );
}

export async function openDeliveryRunHandoffAndRemitAccessHappyPathManagerRemitPage(
  page: Page,
) {
  const scenario = await resolveDeliveryRunHandoffAndRemitAccessHappyPathScenario();
  const route = scenario.checkedInRun.routes.managerRemit;

  if (!route) {
    throw new Error("Missing checked-in manager remit route in the delivery scenario.");
  }

  await openDeliveryRunHandoffAndRemitAccessHappyPathRoute({
    page,
    route,
    expectedPathname: `/runs/${scenario.checkedInRun.id}/remit`,
  });
  await expect(
    page.getByRole("heading", { name: /run remit — manager review/i }),
  ).toBeVisible();
}

export async function openDeliveryRunHandoffAndRemitAccessHappyPathRiderCheckinPage(
  page: Page,
) {
  const scenario = await resolveDeliveryRunHandoffAndRemitAccessHappyPathScenario();
  const route = scenario.checkedInRun.routes.riderCheckin;

  if (!route) {
    throw new Error("Missing checked-in rider check-in route in the delivery scenario.");
  }

  await openDeliveryRunHandoffAndRemitAccessHappyPathRoute({
    page,
    route,
    expectedPathname: `/runs/${scenario.checkedInRun.id}/rider-checkin`,
  });
  await expect(
    page.getByRole("heading", { name: /rider check-in/i }),
  ).toBeVisible();
}

export async function openDeliveryRunHandoffAndRemitAccessHappyPathCashierRunRemitPage(
  page: Page,
) {
  const scenario = await resolveDeliveryRunHandoffAndRemitAccessHappyPathScenario();
  const route = scenario.closedRun.routes.cashierRunRemit;

  if (!route) {
    throw new Error("Missing closed cashier remit route in the delivery scenario.");
  }

  await openDeliveryRunHandoffAndRemitAccessHappyPathRoute({
    page,
    route,
    expectedPathname: `/cashier/delivery/${scenario.closedRun.id}`,
  });
  await expect(
    page.getByRole("heading", { name: /delivery run remit/i }),
  ).toBeVisible();
}

export async function expectDeliveryRunHandoffAndRemitAccessHappyPathManagerRedirectAwayFromRiderCheckin(
  page: Page,
) {
  const scenario = await resolveDeliveryRunHandoffAndRemitAccessHappyPathScenario();
  const route = scenario.checkedInRun.routes.riderCheckin;

  if (!route) {
    throw new Error("Missing checked-in rider check-in route in the delivery scenario.");
  }

  await page.goto(toAbsoluteUrl(route), {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL((target) => target.pathname === "/store", {
    timeout: 10_000,
  });

  expect(new URL(page.url()).pathname).toBe("/store");
}

export async function resolveDeliveryRunHandoffAndRemitAccessHappyPathDbState() {
  const scenario = await resolveDeliveryRunHandoffAndRemitAccessHappyPathScenario();

  const [checkedInRun, closedRun, taggedShift] = await Promise.all([
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
    db.deliveryRun.findUnique({
      where: { id: scenario.closedRun.id },
      select: {
        id: true,
        runCode: true,
        status: true,
        riderId: true,
        riderCheckinAt: true,
        closedAt: true,
      },
    }),
    db.cashierShift.findFirst({
      where: {
        cashierId: scenario.cashier.id,
        closedAt: null,
        deviceId: scenario.cashierShiftDeviceId,
      },
      select: {
        id: true,
        cashierId: true,
        branchId: true,
        deviceId: true,
        status: true,
        openedAt: true,
        closedAt: true,
      },
      orderBy: { openedAt: "desc" },
    }),
  ]);

  return {
    checkedInRun,
    closedRun,
    taggedShift,
  };
}

export function expectDeliveryRunHandoffAndRemitAccessHappyPathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryRunHandoffAndRemitAccessHappyPathDbState>
  >,
  scenario: DeliveryRunHandoffAndRemitAccessHappyPathScenario,
) {
  expect(state.checkedInRun?.id).toBe(scenario.checkedInRun.id);
  expect(state.checkedInRun?.runCode).toBe(scenario.checkedInRun.runCode);
  expect(state.checkedInRun?.status).toBe("CHECKED_IN");
  expect(state.checkedInRun?.riderId).toBe(scenario.rider.employee?.id ?? null);
  expect(state.checkedInRun?.riderCheckinAt).not.toBeNull();
  expect(state.checkedInRun?.closedAt).toBeNull();

  expect(state.closedRun?.id).toBe(scenario.closedRun.id);
  expect(state.closedRun?.runCode).toBe(scenario.closedRun.runCode);
  expect(state.closedRun?.status).toBe("CLOSED");
  expect(state.closedRun?.riderId).toBe(scenario.rider.employee?.id ?? null);
  expect(state.closedRun?.riderCheckinAt).not.toBeNull();
  expect(state.closedRun?.closedAt).not.toBeNull();

  expect(state.taggedShift?.cashierId).toBe(scenario.cashier.id);
  expect(state.taggedShift?.deviceId).toBe(scenario.cashierShiftDeviceId);
  expect(state.taggedShift?.status).toBe(CashierShiftStatus.OPEN);
  expect(state.taggedShift?.closedAt).toBeNull();

  expect(scenario.manager.role).toBe(UserRole.STORE_MANAGER);
  expect(scenario.rider.role).toBe(UserRole.EMPLOYEE);
  expect(scenario.cashier.role).toBe(UserRole.CASHIER);
}
