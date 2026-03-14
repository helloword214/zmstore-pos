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
  workContext?: AttendanceWorkContext;
  leaveType?: AttendanceLeaveType | null;
  lateFlag?: AttendanceLateFlag;
  note?: string | null;
  recordedById?: number | null;
  recordedAt?: Date;
};

const toDateOnly = (value: Date | string) => {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid dutyDate.");
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
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
      workContext: input.workContext ?? AttendanceWorkContext.REGULAR,
      leaveType: normalizeLeaveType(input.attendanceResult, input.leaveType),
      lateFlag: input.lateFlag ?? AttendanceLateFlag.NO,
      note: input.note?.trim() || null,
      recordedById: input.recordedById ?? null,
      recordedAt: input.recordedAt ?? new Date(),
      payProfileId: paySnapshot?.payProfileId ?? null,
      payBasis: paySnapshot?.payBasis ?? null,
      baseDailyRate:
        paySnapshot?.baseDailyRate == null
          ? null
          : toMoneyDecimal(paySnapshot.baseDailyRate),
      baseMonthlyRate:
        paySnapshot?.baseMonthlyRate == null
          ? null
          : toMoneyDecimal(paySnapshot.baseMonthlyRate),
      dailyRateEquivalent:
        paySnapshot?.dailyRateEquivalent == null
          ? null
          : toMoneyDecimal(paySnapshot.dailyRateEquivalent),
      halfDayFactor: toFactorDecimal(paySnapshot?.halfDayFactor ?? 0.5),
    },
    create: {
      workerId: input.workerId,
      scheduleId: input.scheduleId ?? null,
      dutyDate,
      dayType: input.dayType,
      attendanceResult: input.attendanceResult,
      workContext: input.workContext ?? AttendanceWorkContext.REGULAR,
      leaveType: normalizeLeaveType(input.attendanceResult, input.leaveType),
      lateFlag: input.lateFlag ?? AttendanceLateFlag.NO,
      note: input.note?.trim() || null,
      recordedById: input.recordedById ?? null,
      recordedAt: input.recordedAt ?? new Date(),
      payProfileId: paySnapshot?.payProfileId ?? null,
      payBasis: paySnapshot?.payBasis ?? null,
      baseDailyRate:
        paySnapshot?.baseDailyRate == null
          ? null
          : toMoneyDecimal(paySnapshot.baseDailyRate),
      baseMonthlyRate:
        paySnapshot?.baseMonthlyRate == null
          ? null
          : toMoneyDecimal(paySnapshot.baseMonthlyRate),
      dailyRateEquivalent:
        paySnapshot?.dailyRateEquivalent == null
          ? null
          : toMoneyDecimal(paySnapshot.dailyRateEquivalent),
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

export const WORKED_ATTENDANCE_RESULTS = new Set<AttendanceResult>([
  AttendanceResult.WHOLE_DAY,
  AttendanceResult.HALF_DAY,
]);
