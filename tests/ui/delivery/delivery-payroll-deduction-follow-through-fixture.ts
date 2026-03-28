import "dotenv/config";

import { existsSync } from "node:fs";
import { RiderChargePaymentMethod } from "@prisma/client";
import { expect, type Browser, type Page } from "@playwright/test";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryPayrollDeductionFollowThroughArtifacts,
  resetDeliveryPayrollDeductionFollowThroughState,
  resolveDeliveryPayrollDeductionFollowThroughScenarioContext,
} from "../../../scripts/qa/delivery/delivery-payroll-deduction-follow-through-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_ENABLE_ENV =
  "QA_DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_ENABLE";

export type DeliveryPayrollDeductionFollowThroughScenario = Awaited<
  ReturnType<typeof resolveDeliveryPayrollDeductionFollowThroughScenarioContext>
>;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function toAbsoluteUrl(route: string) {
  return new URL(route, resolveBaseUrl()).toString();
}

export function isDeliveryPayrollDeductionFollowThroughEnabled() {
  return (
    process.env[DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_ENABLE_ENV] === "1"
  );
}

export async function cleanupDeliveryPayrollDeductionFollowThroughQaState() {
  return deleteDeliveryPayrollDeductionFollowThroughArtifacts();
}

export async function resetDeliveryPayrollDeductionFollowThroughQaState() {
  return resetDeliveryPayrollDeductionFollowThroughState();
}

export async function resolveDeliveryPayrollDeductionFollowThroughScenario() {
  return resolveDeliveryPayrollDeductionFollowThroughScenarioContext();
}

export async function createDeliveryPayrollDeductionFollowThroughManagerContext(
  browser: Browser,
) {
  const scenario =
    await resolveDeliveryPayrollDeductionFollowThroughScenario();
  const stateFilePath = scenario.managerStateFilePath;

  if (!existsSync(stateFilePath)) {
    throw new Error(
      `Missing manager storage state for delivery payroll deduction follow-through: ${stateFilePath}`,
    );
  }

  return browser.newContext({
    storageState: stateFilePath,
  });
}

export async function openDeliveryPayrollDeductionFollowThroughPage(page: Page) {
  const scenario =
    await resolveDeliveryPayrollDeductionFollowThroughScenario();

  const response = await page.goto(toAbsoluteUrl(scenario.payrollRoute), {
    waitUntil: "domcontentloaded",
  });

  expect(
    response?.ok() ?? true,
    `Route unreachable: ${scenario.payrollRoute}`,
  ).toBeTruthy();
  await page.waitForURL((target) => target.pathname === "/store/payroll", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: /payroll runs/i }),
  ).toBeVisible();
}

export async function resolveDeliveryPayrollDeductionFollowThroughDbState() {
  const scenario =
    await resolveDeliveryPayrollDeductionFollowThroughScenario();

  const [payrollRun, riderCharge, variance, deductionPayments] =
    await Promise.all([
      db.payrollRun.findFirst({
        where: {
          note: scenario.payrollRunNote,
        },
        orderBy: { id: "desc" },
        select: {
          id: true,
          status: true,
          note: true,
          payrollRunLines: {
            where: {
              employeeId: scenario.employeeId,
            },
            select: {
              id: true,
              employeeId: true,
              chargeDeductionAmount: true,
              totalDeductions: true,
              netPay: true,
            },
          },
        },
      }),
      db.riderCharge.findUnique({
        where: { id: scenario.riderChargeId },
        select: {
          id: true,
          varianceId: true,
          runId: true,
          riderId: true,
          amount: true,
          status: true,
          note: true,
          settledAt: true,
        },
      }),
      db.riderRunVariance.findUnique({
        where: { id: scenario.varianceId },
        select: {
          id: true,
          runId: true,
          riderId: true,
          status: true,
          resolution: true,
          resolvedAt: true,
        },
      }),
      db.riderChargePayment.findMany({
        where: {
          chargeId: scenario.riderChargeId,
          method: RiderChargePaymentMethod.PAYROLL_DEDUCTION,
        },
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          chargeId: true,
          amount: true,
          method: true,
          note: true,
          refNo: true,
          shiftId: true,
          cashierId: true,
        },
      }),
    ]);

  return {
    deductionPayments,
    payrollRun,
    payrollRunLine: payrollRun?.payrollRunLines[0] ?? null,
    riderCharge,
    variance,
  };
}

export function expectDeliveryPayrollDeductionFollowThroughInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryPayrollDeductionFollowThroughDbState>
  >,
  scenario: DeliveryPayrollDeductionFollowThroughScenario,
) {
  expect(state.payrollRun).toBeNull();
  expect(state.payrollRunLine).toBeNull();
  expect(state.deductionPayments).toHaveLength(0);
  expect(state.riderCharge?.id).toBe(scenario.riderChargeId);
  expect(state.riderCharge?.varianceId).toBe(scenario.varianceId);
  expect(state.riderCharge?.runId).toBe(scenario.closedRun.id);
  expect(state.riderCharge?.riderId).toBe(scenario.employeeId);
  expect(Number(state.riderCharge?.amount ?? 0).toFixed(2)).toBe(
    scenario.expectedDeductionAmountInput,
  );
  expect(state.riderCharge?.status).toBe("OPEN");
  expect(state.riderCharge?.settledAt).toBeNull();
  expect(String(state.riderCharge?.note ?? "")).toContain(
    "PLAN:PAYROLL_DEDUCTION",
  );
  expect(state.variance?.id).toBe(scenario.varianceId);
  expect(state.variance?.status).toBe("RIDER_ACCEPTED");
  expect(state.variance?.resolution).toBe("CHARGE_RIDER");
  expect(state.variance?.resolvedAt).toBeNull();
}

export function expectDeliveryPayrollDeductionFollowThroughPostedDbState(
  state: Awaited<
    ReturnType<typeof resolveDeliveryPayrollDeductionFollowThroughDbState>
  >,
  scenario: DeliveryPayrollDeductionFollowThroughScenario,
) {
  expect(state.payrollRun?.note).toBe(scenario.payrollRunNote);
  expect(state.payrollRun?.status).toBe("DRAFT");
  expect(state.payrollRunLine?.employeeId).toBe(scenario.employeeId);
  expect(Number(state.payrollRunLine?.chargeDeductionAmount ?? 0).toFixed(2)).toBe(
    scenario.expectedDeductionAmountInput,
  );
  expect(state.deductionPayments).toHaveLength(1);
  expect(state.deductionPayments[0]?.chargeId).toBe(scenario.riderChargeId);
  expect(state.deductionPayments[0]?.method).toBe(
    RiderChargePaymentMethod.PAYROLL_DEDUCTION,
  );
  expect(Number(state.deductionPayments[0]?.amount ?? 0).toFixed(2)).toBe(
    scenario.expectedDeductionAmountInput,
  );
  expect(String(state.deductionPayments[0]?.note ?? "")).toContain(
    scenario.deductionNote,
  );
  expect(state.riderCharge?.id).toBe(scenario.riderChargeId);
  expect(state.riderCharge?.varianceId).toBe(scenario.varianceId);
  expect(state.riderCharge?.runId).toBe(scenario.closedRun.id);
  expect(state.riderCharge?.riderId).toBe(scenario.employeeId);
  expect(state.riderCharge?.status).toBe("SETTLED");
  expect(state.riderCharge?.settledAt).not.toBeNull();
  expect(state.variance?.id).toBe(scenario.varianceId);
  expect(state.variance?.status).toBe("CLOSED");
  expect(state.variance?.resolution).toBe("CHARGE_RIDER");
  expect(state.variance?.resolvedAt).not.toBeNull();
}
