import {
  AttendanceResult,
  AttendanceDayType,
  Prisma,
  SuspensionRecordStatus,
  WorkerScheduleEntryType,
  WorkerScheduleStatus,
  WorkerScheduleEventType,
} from "@prisma/client";
import { db } from "~/utils/db.server";
import {
  recordWorkerSuspendedNoWorkDutyResult,
} from "~/services/worker-attendance-duty-result.server";
import { appendWorkerScheduleEvent } from "~/services/worker-schedule-event.server";
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

export const buildSuspensionRecordTag = (suspensionRecordId: number) =>
  `[SUSPENSION_RECORD:${suspensionRecordId}]`;

function buildSuspensionRecordNote(args: {
  suspensionRecordId: number;
  reasonType: string;
  managerNote?: string | null;
}) {
  return `${buildSuspensionRecordTag(args.suspensionRecordId)} ${
    args.managerNote?.trim() || `Suspension: ${args.reasonType}`
  }`;
}

function noteHasSuspensionRecordTag(note: string | null, suspensionRecordId: number) {
  return String(note ?? "").includes(buildSuspensionRecordTag(suspensionRecordId));
}

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
  prisma: WorkforceRootDbClient = db,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const record = await tx.suspensionRecord.findUnique({
      where: { id: suspensionRecordId },
    });
    if (!record) {
      throw new Error("Suspension record not found.");
    }

    const liftedAt = new Date();
    const liftDate = toDateOnly(liftedAt);

    const updated = await tx.suspensionRecord.update({
      where: { id: suspensionRecordId },
      data: {
        status: SuspensionRecordStatus.LIFTED,
        liftedById: liftedById ?? null,
        liftedAt,
      },
    });

    const futureAttendance = await tx.attendanceDutyResult.findMany({
      where: {
        workerId: record.workerId,
        dutyDate: {
          gte: liftDate,
          lte: record.endDate,
        },
        attendanceResult: AttendanceResult.SUSPENDED_NO_WORK,
        note: { contains: buildSuspensionRecordTag(record.id) },
      },
      select: { id: true, scheduleId: true },
    });

    if (futureAttendance.length > 0) {
      await tx.attendanceDutyResult.deleteMany({
        where: { id: { in: futureAttendance.map((row) => row.id) } },
      });
    }

    const schedules = await tx.workerSchedule.findMany({
      where: {
        workerId: record.workerId,
        entryType: WorkerScheduleEntryType.WORK,
        status: { not: WorkerScheduleStatus.CANCELLED },
        scheduleDate: {
          gte: liftDate,
          lte: record.endDate,
        },
      },
      orderBy: [{ scheduleDate: "asc" }, { startAt: "asc" }],
    });

    for (const schedule of schedules) {
      await appendWorkerScheduleEvent(
        {
          scheduleId: schedule.id,
          eventType: WorkerScheduleEventType.SUSPENSION_LIFTED,
          actorUserId: liftedById ?? null,
          subjectWorkerId: schedule.workerId,
          note: buildSuspensionRecordNote({
            suspensionRecordId: record.id,
            reasonType: record.reasonType,
            managerNote: record.managerNote,
          }),
        },
        tx,
      );
    }

    return {
      record: updated,
      clearedFutureAttendanceCount: futureAttendance.length,
    };
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

    return overlayWorkerSuspensionAttendanceInTx(record, actorUserId, tx);
  });
}

export async function listWorkerSuspensionRecords(
  args?: {
    workerId?: number;
    status?: SuspensionRecordStatus;
  },
  prisma: WorkforceDbClient = db,
) {
  return prisma.suspensionRecord.findMany({
    where: {
      ...(args?.workerId ? { workerId: args.workerId } : {}),
      ...(args?.status ? { status: args.status } : {}),
    },
    include: {
      worker: {
        include: {
          user: {
            select: { role: true, active: true },
          },
        },
      },
      appliedBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      liftedBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
    },
    orderBy: [{ status: "asc" }, { startDate: "desc" }, { id: "desc" }],
  });
}

export async function applyWorkerSuspensionRecordAndOverlay(
  input: ApplyWorkerSuspensionRecordInput,
  prisma: WorkforceRootDbClient = db,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const record = await tx.suspensionRecord.create({
      data: {
        workerId: input.workerId,
        startDate: toDateOnly(input.startDate),
        endDate: toDateOnly(input.endDate),
        reasonType: input.reasonType.trim(),
        managerNote: input.managerNote?.trim() || null,
        status: SuspensionRecordStatus.ACTIVE,
        appliedById: input.appliedById ?? null,
        appliedAt: new Date(),
      },
    });

    const overlay = await overlayWorkerSuspensionAttendanceInTx(
      record,
      input.appliedById ?? null,
      tx,
    );

    return { record, ...overlay };
  });
}

async function overlayWorkerSuspensionAttendanceInTx(
  record: {
    id: number;
    workerId: number;
    startDate: Date;
    endDate: Date;
    reasonType: string;
    managerNote: string | null;
    appliedById: number | null;
  },
  actorUserId: number | null | undefined,
  tx: Prisma.TransactionClient,
) {
  const suspensionNote = buildSuspensionRecordNote({
    suspensionRecordId: record.id,
    reasonType: record.reasonType,
    managerNote: record.managerNote,
  });

  const schedules = await tx.workerSchedule.findMany({
    where: {
      workerId: record.workerId,
      entryType: WorkerScheduleEntryType.WORK,
      status: { not: WorkerScheduleStatus.CANCELLED },
      scheduleDate: {
        gte: record.startDate,
        lte: record.endDate,
      },
    },
    orderBy: [{ scheduleDate: "asc" }, { startAt: "asc" }],
  });

  const existingAttendance = await tx.attendanceDutyResult.findMany({
    where: {
      workerId: record.workerId,
      dutyDate: {
        gte: record.startDate,
        lte: record.endDate,
      },
    },
    orderBy: [{ dutyDate: "asc" }, { id: "asc" }],
  });
  const attendanceByDate = new Map(
    existingAttendance.map((row) => [row.dutyDate.toISOString(), row]),
  );

  let overlaidSchedules = 0;

  for (const schedule of schedules) {
    const existing = attendanceByDate.get(schedule.scheduleDate.toISOString());
    if (
      existing &&
      existing.attendanceResult !== AttendanceResult.SUSPENDED_NO_WORK &&
      !noteHasSuspensionRecordTag(existing.note, record.id)
    ) {
      continue;
    }

    await recordWorkerSuspendedNoWorkDutyResult(
      {
        workerId: schedule.workerId,
        scheduleId: schedule.id,
        dutyDate: schedule.scheduleDate,
        dayType: AttendanceDayType.WORK_DAY,
        note: suspensionNote,
        recordedById: actorUserId ?? record.appliedById ?? null,
      },
      tx,
    );

    await appendWorkerScheduleEvent(
      {
        scheduleId: schedule.id,
        eventType: WorkerScheduleEventType.SUSPENSION_APPLIED,
        actorUserId: actorUserId ?? record.appliedById ?? null,
        subjectWorkerId: schedule.workerId,
        note: suspensionNote,
      },
      tx,
    );
    overlaidSchedules += 1;
  }

  return { overlaidSchedules };
}
