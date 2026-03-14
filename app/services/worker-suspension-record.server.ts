import {
  AttendanceDayType,
  Prisma,
  SuspensionRecordStatus,
  WorkerScheduleStatus,
} from "@prisma/client";
import { db } from "~/utils/db.server";
import {
  recordWorkerSuspendedNoWorkDutyResult,
} from "~/services/worker-attendance-duty-result.server";
import type {
  WorkforceDbClient,
  WorkforceRootDbClient,
} from "~/services/worker-payroll-policy.server";

export type ApplyWorkerSuspensionRecordInput = {
  workerId: number;
  startDate: Date | string;
  endDate: Date | string;
  reasonType: string;
  managerNote?: string | null;
  appliedById?: number | null;
};

const toDateOnly = (value: Date | string) => {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

export async function applyWorkerSuspensionRecord(
  input: ApplyWorkerSuspensionRecordInput,
  prisma: WorkforceDbClient = db,
) {
  const startDate = toDateOnly(input.startDate);
  const endDate = toDateOnly(input.endDate);

  if (endDate < startDate) {
    throw new Error("endDate must be on or after startDate.");
  }
  if (!input.reasonType.trim()) {
    throw new Error("reasonType is required.");
  }

  return prisma.suspensionRecord.create({
    data: {
      workerId: input.workerId,
      startDate,
      endDate,
      reasonType: input.reasonType.trim(),
      managerNote: input.managerNote?.trim() || null,
      status: SuspensionRecordStatus.ACTIVE,
      appliedById: input.appliedById ?? null,
      appliedAt: new Date(),
    },
  });
}

export async function liftWorkerSuspensionRecord(
  suspensionRecordId: number,
  liftedById?: number | null,
  prisma: WorkforceDbClient = db,
) {
  return prisma.suspensionRecord.update({
    where: { id: suspensionRecordId },
    data: {
      status: SuspensionRecordStatus.LIFTED,
      liftedById: liftedById ?? null,
      liftedAt: new Date(),
    },
  });
}

export async function getActiveWorkerSuspensionForDate(
  workerId: number,
  date: Date | string,
  prisma: WorkforceDbClient = db,
) {
  const onDate = toDateOnly(date);

  return prisma.suspensionRecord.findFirst({
    where: {
      workerId,
      status: SuspensionRecordStatus.ACTIVE,
      startDate: { lte: onDate },
      endDate: { gte: onDate },
    },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
  });
}

export async function overlayWorkerSuspensionAttendance(
  suspensionRecordId: number,
  actorUserId?: number | null,
  prisma: WorkforceRootDbClient = db,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const record = await tx.suspensionRecord.findUnique({
      where: { id: suspensionRecordId },
    });
    if (!record) {
      throw new Error("Suspension record not found.");
    }

    const schedules = await tx.workerSchedule.findMany({
      where: {
        workerId: record.workerId,
        status: { not: WorkerScheduleStatus.CANCELLED },
        scheduleDate: {
          gte: record.startDate,
          lte: record.endDate,
        },
      },
      orderBy: [{ scheduleDate: "asc" }, { startAt: "asc" }],
    });

    for (const schedule of schedules) {
      await recordWorkerSuspendedNoWorkDutyResult(
        {
          workerId: schedule.workerId,
          scheduleId: schedule.id,
          dutyDate: schedule.scheduleDate,
          dayType: AttendanceDayType.WORK_DAY,
          note: record.managerNote ?? `Suspension: ${record.reasonType}`,
          recordedById: actorUserId ?? record.appliedById ?? null,
        },
        tx,
      );
    }

    return { overlaidSchedules: schedules.length };
  });
}
