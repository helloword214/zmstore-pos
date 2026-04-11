import {
  AttendanceDayType,
  AttendanceLateFlag,
  AttendanceLeaveType,
  AttendanceResult,
  AttendanceWorkContext,
  Prisma,
} from "@prisma/client";
import { db } from "~/utils/db.server";
import {
  getEffectiveEmployeePayProfile,
  snapshotEmployeePayProfile,
  type WorkforceDbClient,
} from "~/services/worker-payroll-policy.server";

export type RecordWorkerAttendanceDutyResultInput = {
  workerId: number;
  scheduleId?: number | null;
  dutyDate: Date | string;
  dayType: AttendanceDayType;
  attendanceResult: AttendanceResult;
  plannedDutyState?: "WORK" | "OFF" | "BLANK";
  workContext?: AttendanceWorkContext;
  leaveType?: AttendanceLeaveType | null;
  lateFlag?: AttendanceLateFlag;
  note?: string | null;
  recordedById?: number | null;
  recordedAt?: Date;
};

const parseCalendarDateParts = (value: Date | string) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid dutyDate.");
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
    throw new Error("Invalid dutyDate.");
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

const toMoneyDecimal = (value: number) => new Prisma.Decimal(value.toFixed(2));

const toFactorDecimal = (value: number) => new Prisma.Decimal(value.toFixed(4));

const normalizeLeaveType = (
  attendanceResult: AttendanceResult,
  leaveType?: AttendanceLeaveType | null,
) => {
  if (attendanceResult === AttendanceResult.LEAVE) {
    if (!leaveType) {
      throw new Error("leaveType is required when attendanceResult is LEAVE.");
    }
    return leaveType;
  }

  return null;
};

const deriveAttendanceWorkContext = (
  attendanceResult: AttendanceResult,
  plannedDutyState: RecordWorkerAttendanceDutyResultInput["plannedDutyState"],
) => {
  if (
    attendanceResult !== AttendanceResult.WHOLE_DAY &&
    attendanceResult !== AttendanceResult.HALF_DAY
  ) {
    return AttendanceWorkContext.REGULAR;
  }

  if (plannedDutyState === "OFF") {
    return AttendanceWorkContext.REPLACEMENT;
  }

  if (plannedDutyState === "BLANK") {
    return AttendanceWorkContext.ON_CALL;
  }

  return AttendanceWorkContext.REGULAR;
};

export async function recordWorkerAttendanceDutyResult(
  input: RecordWorkerAttendanceDutyResultInput,
  prisma: WorkforceDbClient = db,
) {
  if (!Number.isFinite(input.workerId) || input.workerId <= 0) {
    throw new Error("workerId is required.");
  }

  const dutyDate = toDateOnly(input.dutyDate);
  const payProfile = await getEffectiveEmployeePayProfile(
    prisma,
    input.workerId,
    dutyDate,
  );
  const paySnapshot = snapshotEmployeePayProfile(payProfile);

  return prisma.attendanceDutyResult.upsert({
    where: {
      workerId_dutyDate: {
        workerId: input.workerId,
        dutyDate,
      },
    },
    update: {
      ...(input.scheduleId !== undefined
        ? { scheduleId: input.scheduleId ?? null }
        : {}),
      dayType: input.dayType,
      attendanceResult: input.attendanceResult,
      workContext:
        input.workContext ??
        deriveAttendanceWorkContext(input.attendanceResult, input.plannedDutyState),
      leaveType: normalizeLeaveType(input.attendanceResult, input.leaveType),
      lateFlag: input.lateFlag ?? AttendanceLateFlag.NO,
      note: input.note?.trim() || null,
      recordedById: input.recordedById ?? null,
      recordedAt: input.recordedAt ?? new Date(),
      payProfileId: paySnapshot?.payProfileId ?? null,
      dailyRate:
        paySnapshot?.dailyRate == null
          ? null
          : toMoneyDecimal(paySnapshot.dailyRate),
      halfDayFactor: toFactorDecimal(paySnapshot?.halfDayFactor ?? 0.5),
    },
    create: {
      workerId: input.workerId,
      scheduleId: input.scheduleId ?? null,
      dutyDate,
      dayType: input.dayType,
      attendanceResult: input.attendanceResult,
      workContext:
        input.workContext ??
        deriveAttendanceWorkContext(input.attendanceResult, input.plannedDutyState),
      leaveType: normalizeLeaveType(input.attendanceResult, input.leaveType),
      lateFlag: input.lateFlag ?? AttendanceLateFlag.NO,
      note: input.note?.trim() || null,
      recordedById: input.recordedById ?? null,
      recordedAt: input.recordedAt ?? new Date(),
      payProfileId: paySnapshot?.payProfileId ?? null,
      dailyRate:
        paySnapshot?.dailyRate == null
          ? null
          : toMoneyDecimal(paySnapshot.dailyRate),
      halfDayFactor: toFactorDecimal(paySnapshot?.halfDayFactor ?? 0.5),
    },
  });
}

export async function recordWorkerSuspendedNoWorkDutyResult(
  input: Omit<
    RecordWorkerAttendanceDutyResultInput,
    "attendanceResult" | "lateFlag" | "workContext"
  >,
  prisma: WorkforceDbClient = db,
) {
  return recordWorkerAttendanceDutyResult(
    {
      ...input,
      attendanceResult: AttendanceResult.SUSPENDED_NO_WORK,
      workContext: AttendanceWorkContext.REGULAR,
      lateFlag: AttendanceLateFlag.NO,
    },
    prisma,
  );
}

export async function listWorkerAttendanceDutyResultsForPeriod(
  prisma: WorkforceDbClient,
  args: {
    workerId?: number;
    periodStart: Date | string;
    periodEnd: Date | string;
  },
) {
  const periodStart = toDateOnly(args.periodStart);
  const periodEnd = toDateOnly(args.periodEnd);

  return prisma.attendanceDutyResult.findMany({
    where: {
      ...(args.workerId ? { workerId: args.workerId } : {}),
      dutyDate: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    orderBy: [{ dutyDate: "asc" }, { workerId: "asc" }],
  });
}

export async function listWorkerAttendanceDutyResultsForDate(
  dutyDate: Date | string,
  prisma: WorkforceDbClient = db,
) {
  const date = toDateOnly(dutyDate);

  return prisma.attendanceDutyResult.findMany({
    where: { dutyDate: date },
    orderBy: [{ workerId: "asc" }, { id: "asc" }],
  });
}

export const WORKED_ATTENDANCE_RESULTS = new Set<AttendanceResult>([
  AttendanceResult.WHOLE_DAY,
  AttendanceResult.HALF_DAY,
]);
