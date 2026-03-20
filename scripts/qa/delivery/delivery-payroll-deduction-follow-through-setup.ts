import "dotenv/config";

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AttendanceDayType,
  AttendanceLateFlag,
  AttendanceResult,
  AttendanceWorkContext,
} from "@prisma/client";
import {
  getEffectiveEmployeePayProfile,
  getEffectiveEmployeeStatutoryDeductionProfile,
  upsertEmployeePayProfile,
  upsertEmployeeStatutoryDeductionProfile,
} from "~/services/worker-payroll-policy.server";
import { PAYROLL_PLAN_TAG } from "~/services/worker-payroll-identity.server";
import { recordWorkerAttendanceDutyResult } from "~/services/worker-attendance-duty-result.server";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  type DeliveryFinalSettlementGatingScenarioContext,
  deleteDeliveryFinalSettlementGatingArtifacts,
  resetDeliveryFinalSettlementGatingState,
  resolveDeliveryFinalSettlementGatingScenarioContext,
} from "./delivery-final-settlement-gating-setup";
import {
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_DAILY_RATE,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PAG_IBIG_AMOUNT,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PHILHEALTH_AMOUNT,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_SSS_AMOUNT,
  formatScenarioDateInput,
  formatScenarioDateLabel,
  resolveWorkforcePayrollHappyPathDutyDates,
  resolveWorkforcePayrollHappyPathWindow,
} from "../workforce/workforce-payroll-happy-path-scenario";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const AUTH_DIR = path.resolve(
  "test-results/ui/auth/delivery-payroll-deduction-follow-through",
);

const DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_QA_MARKER =
  "QA: delivery-payroll-deduction-follow-through";
const DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_ATTENDANCE_NOTE =
  DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_QA_MARKER;
const DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_PAY_PROFILE_NOTE =
  `${DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_QA_MARKER} salary row`;
const DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_STATUTORY_NOTE =
  `${DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_QA_MARKER} deduction row`;
const DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_RUN_NOTE =
  DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_QA_MARKER;

type BrowserSessionStorageState = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax";
  }>;
  origins: Array<unknown>;
};

type DeleteSummary = Awaited<
  ReturnType<typeof deleteDeliveryFinalSettlementGatingArtifacts>
> & {
  deletedAttendanceRows: number;
  deletedPayProfiles: number;
  deletedPayrollRuns: number;
  deletedStatutoryProfiles: number;
  removedManagerStateFile: boolean;
};

type PayrollWindow = Awaited<
  ReturnType<typeof resolveWorkforcePayrollHappyPathWindow>
>;

export type DeliveryPayrollDeductionFollowThroughScenarioContext =
  DeliveryFinalSettlementGatingScenarioContext & {
    deductionNote: string;
    employeeId: number;
    employeeLabel: string;
    expectedDeductionAmountInput: string;
    expectedDeductionAmountLabel: string;
    managerStateFilePath: string;
    payDateInput: string;
    payrollRoute: string;
    payrollRunNote: string;
    periodEndInput: string;
    periodStartInput: string;
    riderChargeId: number;
  };

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function peso(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);
}

function removeFileIfPresent(filePath: string) {
  const exists = existsSync(filePath);
  try {
    rmSync(filePath, { force: true });
    return exists;
  } catch {
    return false;
  }
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the delivery payroll follow-through QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

function formatEmployeeLabel(args: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  const fullName = `${args.firstName} ${args.lastName}`.trim();
  return args.alias ? `${fullName} (${args.alias})` : fullName;
}

function buildChargeNote(existingNote: string | null, riderChargeId: number) {
  const normalized = String(existingNote ?? "")
    .replace(/\|\s*PLAN:PAYROLL_DEDUCTION\b/g, "")
    .replace(/\bPLAN:PAYROLL_DEDUCTION\b/g, "")
    .trim();

  return [
    normalized || `QA payroll-tagged rider charge #${riderChargeId}`,
    PAYROLL_PLAN_TAG,
    DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_QA_MARKER,
  ].join(" | ");
}

function buildDeductionNote(runCode: string) {
  return `QA payroll deduction follow-through for ${runCode}`;
}

export function resolveDeliveryPayrollDeductionFollowThroughManagerStateFilePath() {
  return path.join(AUTH_DIR, "manager.json");
}

async function createManagerStorageState(userId: number, stateFilePath: string) {
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    userId,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error("Auth session creation did not return a session cookie.");
  }

  const cookie = parseCookiePair(setCookieHeader);
  const storageState: BrowserSessionStorageState = {
    cookies: [
      {
        name: cookie.name,
        value: cookie.value,
        domain: baseUrl.hostname,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
        httpOnly: true,
        secure: baseUrl.protocol === "https:",
        sameSite: "Lax",
      },
    ],
    origins: [],
  };

  mkdirSync(path.dirname(stateFilePath), { recursive: true });
  writeFileSync(stateFilePath, JSON.stringify(storageState, null, 2));
}

async function ensurePayrollReadyRiderEmployee(
  scenario: DeliveryFinalSettlementGatingScenarioContext,
  payrollWindow: PayrollWindow,
) {
  const employee = scenario.rider.employee;
  if (!employee) {
    throw new Error(
      "Delivery payroll deduction follow-through requires the seeded rider session to stay linked to an employee record.",
    );
  }

  const employeeId = employee.id;
  const payProfile = await getEffectiveEmployeePayProfile(
    db,
    employeeId,
    payrollWindow.periodStart,
  );
  if (!payProfile) {
    await upsertEmployeePayProfile({
      employeeId,
      dailyRate: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_DAILY_RATE,
      halfDayFactor: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR,
      effectiveFrom: payrollWindow.periodStart,
      effectiveTo: null,
      note: DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_PAY_PROFILE_NOTE,
      actorUserId: null,
    });
  }

  const statutoryProfile = await getEffectiveEmployeeStatutoryDeductionProfile(
    db,
    employeeId,
    payrollWindow.payDate,
  );
  if (!statutoryProfile) {
    await upsertEmployeeStatutoryDeductionProfile({
      employeeId,
      sssAmount: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_SSS_AMOUNT,
      philhealthAmount: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PHILHEALTH_AMOUNT,
      pagIbigAmount: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PAG_IBIG_AMOUNT,
      effectiveFrom: payrollWindow.periodStart,
      effectiveTo: null,
      note: DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_STATUTORY_NOTE,
      actorUserId: null,
    });
  }

  const dutyDates = await resolveWorkforcePayrollHappyPathDutyDates({
    workerId: employeeId,
    periodStart: payrollWindow.periodStart,
    periodEnd: payrollWindow.periodEnd,
    requiredCount: 3,
  });

  const attendancePattern = [
    AttendanceResult.WHOLE_DAY,
    AttendanceResult.WHOLE_DAY,
    AttendanceResult.HALF_DAY,
  ] as const;

  for (const [index, dutyDate] of dutyDates.entries()) {
    await recordWorkerAttendanceDutyResult({
      workerId: employeeId,
      dutyDate,
      dayType: AttendanceDayType.WORK_DAY,
      attendanceResult: attendancePattern[index] ?? AttendanceResult.WHOLE_DAY,
      workContext: AttendanceWorkContext.REGULAR,
      lateFlag: AttendanceLateFlag.NO,
      note: DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_ATTENDANCE_NOTE,
      recordedById: null,
    });
  }

  return {
    dutyDates,
    employeeId,
    employeeLabel: formatEmployeeLabel(employee),
  };
}

async function ensurePayrollTaggedOpenRiderCharge(
  scenario: DeliveryFinalSettlementGatingScenarioContext,
) {
  const riderCharge = await db.riderCharge.findUnique({
    where: { varianceId: scenario.varianceId },
    select: {
      id: true,
      amount: true,
      note: true,
      runId: true,
      riderId: true,
      settledAt: true,
      status: true,
      varianceId: true,
    },
  });

  if (!riderCharge) {
    throw new Error(
      `Missing RiderCharge for variance #${scenario.varianceId} during delivery payroll follow-through setup.`,
    );
  }

  if (riderCharge.status !== "OPEN") {
    throw new Error(
      `Delivery payroll follow-through requires an OPEN RiderCharge. Found ${riderCharge.status} on charge #${riderCharge.id}.`,
    );
  }

  const note = buildChargeNote(riderCharge.note, riderCharge.id);
  await db.riderCharge.update({
    where: { id: riderCharge.id },
    data: { note },
  });

  return {
    ...riderCharge,
    amount: Number(riderCharge.amount),
    note,
  };
}

export async function deleteDeliveryPayrollDeductionFollowThroughArtifacts(): Promise<DeleteSummary> {
  const taggedRuns = await db.payrollRun.findMany({
    where: {
      note: DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_RUN_NOTE,
    },
    select: { id: true },
  });

  const deletedPayrollRuns =
    taggedRuns.length > 0
      ? (
          await db.payrollRun.deleteMany({
            where: {
              id: { in: taggedRuns.map((run) => run.id) },
            },
          })
        ).count
      : 0;

  const deletedAttendanceRows = (
    await db.attendanceDutyResult.deleteMany({
      where: {
        note: DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_ATTENDANCE_NOTE,
      },
    })
  ).count;
  const deletedStatutoryProfiles = (
    await db.employeeStatutoryDeductionProfile.deleteMany({
      where: {
        note: DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_STATUTORY_NOTE,
      },
    })
  ).count;
  const deletedPayProfiles = (
    await db.employeePayProfile.deleteMany({
      where: {
        note: DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_PAY_PROFILE_NOTE,
      },
    })
  ).count;
  const deletedDeliveryArtifacts =
    await deleteDeliveryFinalSettlementGatingArtifacts();

  return {
    ...deletedDeliveryArtifacts,
    deletedAttendanceRows,
    deletedPayProfiles,
    deletedPayrollRuns,
    deletedStatutoryProfiles,
    removedManagerStateFile: removeFileIfPresent(
      resolveDeliveryPayrollDeductionFollowThroughManagerStateFilePath(),
    ),
  };
}

export async function resetDeliveryPayrollDeductionFollowThroughState() {
  const deleted = await deleteDeliveryPayrollDeductionFollowThroughArtifacts();
  await resetDeliveryFinalSettlementGatingState();
  const scenario = await resolveDeliveryFinalSettlementGatingScenarioContext();
  const payrollWindow = await resolveWorkforcePayrollHappyPathWindow(new Date());

  await createManagerStorageState(
    scenario.manager.id,
    resolveDeliveryPayrollDeductionFollowThroughManagerStateFilePath(),
  );

  const payrollReadyEmployee = await ensurePayrollReadyRiderEmployee(
    scenario,
    payrollWindow,
  );
  const riderCharge = await ensurePayrollTaggedOpenRiderCharge(scenario);

  return {
    deleted,
    dutyDates: payrollReadyEmployee.dutyDates,
    employeeId: payrollReadyEmployee.employeeId,
    riderChargeId: riderCharge.id,
  };
}

export async function resolveDeliveryPayrollDeductionFollowThroughScenarioContext(): Promise<DeliveryPayrollDeductionFollowThroughScenarioContext> {
  const scenario = await resolveDeliveryFinalSettlementGatingScenarioContext();
  const employee = scenario.rider.employee;
  if (!employee) {
    throw new Error(
      "Delivery payroll deduction follow-through requires the seeded rider session to stay linked to an employee record.",
    );
  }

  const payrollWindow = await resolveWorkforcePayrollHappyPathWindow(new Date());
  const attendanceCount = await db.attendanceDutyResult.count({
    where: {
      workerId: employee.id,
      note: DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_ATTENDANCE_NOTE,
      dutyDate: {
        gte: payrollWindow.periodStart,
        lte: payrollWindow.periodEnd,
      },
    },
  });

  if (attendanceCount < 3) {
    throw new Error(
      "Missing tagged payroll attendance rows for the delivery payroll follow-through scenario. " +
        "Run `npm run qa:delivery:payroll-deduction-follow-through:setup` first.",
    );
  }

  const riderCharge = await db.riderCharge.findUnique({
    where: { varianceId: scenario.varianceId },
    select: {
      id: true,
      amount: true,
      note: true,
    },
  });

  if (!riderCharge) {
    throw new Error(
      `Missing RiderCharge for variance #${scenario.varianceId} in delivery payroll follow-through context.`,
    );
  }
  if (!String(riderCharge.note ?? "").includes(PAYROLL_PLAN_TAG)) {
    throw new Error(
      "The seeded RiderCharge is not payroll-tagged. Run `npm run qa:delivery:payroll-deduction-follow-through:setup` first.",
    );
  }

  return {
    ...scenario,
    deductionNote: buildDeductionNote(scenario.closedRun.runCode),
    employeeId: employee.id,
    employeeLabel: formatEmployeeLabel(employee),
    expectedDeductionAmountInput: riderCharge.amount.toFixed(2),
    expectedDeductionAmountLabel: peso(Number(riderCharge.amount)),
    managerStateFilePath:
      resolveDeliveryPayrollDeductionFollowThroughManagerStateFilePath(),
    payDateInput: formatScenarioDateInput(payrollWindow.payDate),
    payrollRoute: "/store/payroll",
    payrollRunNote: DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_RUN_NOTE,
    periodEndInput: formatScenarioDateInput(payrollWindow.periodEnd),
    periodStartInput: formatScenarioDateInput(payrollWindow.periodStart),
    riderChargeId: riderCharge.id,
  };
}

async function main() {
  const { deleted, dutyDates } =
    await resetDeliveryPayrollDeductionFollowThroughState();
  const scenario =
    await resolveDeliveryPayrollDeductionFollowThroughScenarioContext();

  console.log(
    [
      "Delivery payroll deduction follow-through setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Closed run code: ${scenario.closedRun.runCode}`,
      `Variance ref: #${scenario.varianceId}`,
      `Rider charge: #${scenario.riderChargeId}`,
      `Payroll route: ${scenario.payrollRoute}`,
      `Payroll draft note: ${scenario.payrollRunNote}`,
      `Employee: ${scenario.employeeLabel} [employeeId=${scenario.employeeId}]`,
      `Cutoff: ${formatScenarioDateLabel(scenario.periodStartInput)} to ${formatScenarioDateLabel(
        scenario.periodEndInput,
      )}`,
      `Pay date: ${formatScenarioDateLabel(scenario.payDateInput)}`,
      `Tagged attendance dates: ${dutyDates
        .map((date) => formatScenarioDateInput(date))
        .join(", ")}`,
      `Expected deduction: ${scenario.expectedDeductionAmountLabel}`,
      `Full-deduction note: ${scenario.deductionNote}`,
      `Manager storage state: ${scenario.managerStateFilePath}`,
      `Deleted previous tagged payroll runs: ${deleted.deletedPayrollRuns}`,
      `Deleted previous tagged attendance rows: ${deleted.deletedAttendanceRows}`,
      `Deleted previous tagged runs: ${deleted.runIds.length}`,
      `Deleted previous tagged orders: ${deleted.orderIds.length}`,
      "Next manual QA steps:",
      "1. Open the printed payroll route as STORE_MANAGER.",
      "2. Create a payroll draft using the printed cutoff and draft note.",
      "3. Rebuild payroll lines, open the printed rider employee, and apply the full remaining balance using the printed deduction note.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery payroll deduction follow-through setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
