import "dotenv/config";

import { EmployeeRole, PayrollFrequency } from "@prisma/client";
import { getEffectiveCompanyPayrollPolicy } from "~/services/worker-payroll-policy.server";
import { db } from "~/utils/db.server";

const DAY_MS = 24 * 60 * 60 * 1000;

export const WORKFORCE_PAYROLL_HAPPY_PATH_QA_MARKER =
  "QA: workforce-payroll-happy-path";
export const WORKFORCE_PAYROLL_HAPPY_PATH_ATTENDANCE_NOTE =
  WORKFORCE_PAYROLL_HAPPY_PATH_QA_MARKER;
export const WORKFORCE_PAYROLL_HAPPY_PATH_PAY_PROFILE_NOTE =
  `${WORKFORCE_PAYROLL_HAPPY_PATH_QA_MARKER} salary row`;
export const WORKFORCE_PAYROLL_HAPPY_PATH_STATUTORY_NOTE =
  `${WORKFORCE_PAYROLL_HAPPY_PATH_QA_MARKER} deduction row`;
export const WORKFORCE_PAYROLL_HAPPY_PATH_RUN_NOTE =
  WORKFORCE_PAYROLL_HAPPY_PATH_QA_MARKER;

export const WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_DAILY_RATE = 500;
export const WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR = 0.5;
export const WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_SSS_AMOUNT = 50;
export const WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PHILHEALTH_AMOUNT = 40;
export const WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PAG_IBIG_AMOUNT = 20;

type ScenarioEmployee = {
  id: number;
  firstName: string;
  lastName: string;
  alias: string | null;
};

type ScenarioWindow = {
  payFrequency: PayrollFrequency;
  periodStart: Date;
  periodEnd: Date;
  payDate: Date;
  customCutoffNote: string | null;
  companyPayrollPolicyId: number | null;
  statutoryToggles: {
    sss: boolean;
    philhealth: boolean;
    pagIbig: boolean;
  };
};

const parseCalendarDateParts = (value: Date | string) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid date input.");
    }

    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  const trimmed = value.trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(trimmed);
  if (dateOnlyMatch) {
    const [, yearRaw, monthRaw, dayRaw] = dateOnlyMatch;
    return {
      year: Number(yearRaw),
      month: Number(monthRaw),
      day: Number(dayRaw),
    };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }

  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
  };
};

const toDateOnly = (value: Date | string) => {
  const { year, month, day } = parseCalendarDateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
};

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);

const startOfWeek = (referenceDate: Date) => {
  const date = toDateOnly(referenceDate);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
};

const endOfWeek = (referenceDate: Date) => addDays(startOfWeek(referenceDate), 6);

export const formatScenarioDateInput = (value: Date | string) => {
  const date = toDateOnly(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const formatScenarioDateLabel = (value: Date | string) =>
  toDateOnly(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });

export const formatWorkerLabel = (worker: ScenarioEmployee) => {
  const fullName = `${worker.firstName} ${worker.lastName}`.trim();
  return worker.alias ? `${fullName} (${worker.alias})` : fullName;
};

export async function resolveWorkforcePayrollHappyPathWindow(
  referenceDate: Date = new Date(),
): Promise<ScenarioWindow> {
  const today = toDateOnly(referenceDate);
  const policy = await getEffectiveCompanyPayrollPolicy(db, today);
  const payFrequency = policy?.payFrequency ?? PayrollFrequency.WEEKLY;

  let periodStart: Date;
  let periodEnd: Date;

  if (payFrequency === PayrollFrequency.SEMI_MONTHLY) {
    if (today.getUTCDate() <= 15) {
      periodStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
      );
      periodEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 15),
      );
    } else {
      periodStart = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 16),
      );
      periodEnd = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
      );
    }
  } else if (payFrequency === PayrollFrequency.WEEKLY) {
    periodStart = startOfWeek(today);
    periodEnd = endOfWeek(today);
  } else {
    periodStart = addDays(today, -13);
    periodEnd = today;
  }

  return {
    payFrequency,
    periodStart,
    periodEnd,
    payDate: today,
    customCutoffNote: policy?.customCutoffNote ?? null,
    companyPayrollPolicyId: policy?.id ?? null,
    statutoryToggles: {
      sss: policy?.sssDeductionEnabled ?? false,
      philhealth: policy?.philhealthDeductionEnabled ?? false,
      pagIbig: policy?.pagIbigDeductionEnabled ?? false,
    },
  };
}

export async function resolveWorkforcePayrollHappyPathTargetEmployee(
  onDate: Date,
): Promise<ScenarioEmployee> {
  const riders = await db.employee.findMany({
    where: {
      active: true,
      role: EmployeeRole.RIDER,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      alias: true,
      payProfiles: {
        where: {
          effectiveFrom: { lte: onDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
        },
        select: { id: true },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
    orderBy: [{ id: "asc" }],
  });

  if (riders.length === 0) {
    throw new Error("No active rider employee is available for this QA scenario.");
  }

  const preferred = riders.find((worker) => worker.payProfiles.length > 0) ?? riders[0];

  return {
    id: preferred.id,
    firstName: preferred.firstName,
    lastName: preferred.lastName,
    alias: preferred.alias,
  };
}

export async function resolveWorkforcePayrollHappyPathDutyDates(args: {
  workerId: number;
  periodStart: Date;
  periodEnd: Date;
  requiredCount?: number;
}) {
  const requiredCount = args.requiredCount ?? 3;
  const attendanceRows = await db.attendanceDutyResult.findMany({
    where: {
      workerId: args.workerId,
      dutyDate: {
        gte: args.periodStart,
        lte: args.periodEnd,
      },
    },
    select: {
      dutyDate: true,
      note: true,
    },
    orderBy: [{ dutyDate: "asc" }, { id: "asc" }],
  });

  const qaDates = new Set<string>();
  const occupiedNonQaDates = new Set<string>();

  for (const row of attendanceRows) {
    const key = formatScenarioDateInput(row.dutyDate);
    if (row.note === WORKFORCE_PAYROLL_HAPPY_PATH_ATTENDANCE_NOTE) {
      qaDates.add(key);
    } else {
      occupiedNonQaDates.add(key);
    }
  }

  const targetDates = Array.from(qaDates)
    .sort()
    .slice(0, requiredCount)
    .map((value) => toDateOnly(value));

  for (
    let cursor = toDateOnly(args.periodStart);
    cursor.getTime() <= args.periodEnd.getTime();
    cursor = addDays(cursor, 1)
  ) {
    if (targetDates.length >= requiredCount) break;
    const key = formatScenarioDateInput(cursor);
    const alreadySelected = targetDates.some(
      (value) => formatScenarioDateInput(value) === key,
    );
    if (occupiedNonQaDates.has(key) || alreadySelected) continue;
    targetDates.push(cursor);
  }

  if (targetDates.length < requiredCount) {
    throw new Error(
      `Not enough free attendance dates in ${formatScenarioDateLabel(
        args.periodStart,
      )} to ${formatScenarioDateLabel(
        args.periodEnd,
      )} for ${requiredCount} QA duty rows.`,
    );
  }

  return targetDates.sort((left, right) => left.getTime() - right.getTime());
}
