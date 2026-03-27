import {
  UserRole,
  WorkerScheduleEntryType,
  WorkerScheduleEventType,
  WorkerScheduleRole,
  WorkerScheduleStatus,
  WorkerScheduleTemplateDayOfWeek,
} from "@prisma/client";
import { db } from "~/utils/db.server";
import type { WorkforceDbClient } from "~/services/worker-payroll-policy.server";
import { appendWorkerScheduleEvent } from "~/services/worker-schedule-event.server";

const DAY_OF_WEEK_INDEX: Record<WorkerScheduleTemplateDayOfWeek, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

const DATE_ONLY_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_ONLY_SAFE_HOUR = 12;

const toDateOnly = (value: Date | string) => {
  if (typeof value === "string") {
    const match = DATE_ONLY_INPUT_PATTERN.exec(value.trim());
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const parsed = new Date(
        year,
        month - 1,
        day,
        DATE_ONLY_SAFE_HOUR,
        0,
        0,
        0,
      );
      if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
      ) {
        throw new Error("Invalid date input.");
      }
      return parsed;
    }
  }

  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(DATE_ONLY_SAFE_HOUR, 0, 0, 0);
  return parsed;
};

const enumerateDatesInclusive = (start: Date, end: Date) => {
  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const combineDateAndMinute = (date: Date, minute: number) => {
  const combined = new Date(date);
  combined.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return combined;
};

const OFF_DAY_START_MINUTE = 0;
const OFF_DAY_END_MINUTE = 1;

const parseTimeToMinute = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error("Time must be in HH:MM format.");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("Invalid time value.");
  }
  if (minute !== 0 && minute !== 30) {
    throw new Error("Time must use only whole hours or :30.");
  }
  return hour * 60 + minute;
};

const fallsWithinEffectiveRange = (
  date: Date,
  effectiveFrom: Date,
  effectiveTo: Date | null,
) => date >= effectiveFrom && (!effectiveTo || date <= effectiveTo);

const buildWorkerDateKey = (workerId: number, date: Date) =>
  `${workerId}:${date.toISOString().slice(0, 10)}`;

const deriveWorkerScheduleRole = (
  templateRole: WorkerScheduleRole | null,
  userRole: UserRole | null | undefined,
) => {
  if (templateRole) return templateRole;
  if (userRole === UserRole.CASHIER) return WorkerScheduleRole.CASHIER;
  if (userRole === UserRole.STORE_MANAGER) return WorkerScheduleRole.STORE_MANAGER;
  return WorkerScheduleRole.EMPLOYEE;
};

const buildOffDayWindow = (scheduleDate: Date) => ({
  startAt: combineDateAndMinute(scheduleDate, OFF_DAY_START_MINUTE),
  endAt: combineDateAndMinute(scheduleDate, OFF_DAY_END_MINUTE),
});

const formatWindowLabel = (startAt: Date, endAt: Date) => {
  const startHour = String(startAt.getHours()).padStart(2, "0");
  const startMinute = String(startAt.getMinutes()).padStart(2, "0");
  const endHour = String(endAt.getHours()).padStart(2, "0");
  const endMinute = String(endAt.getMinutes()).padStart(2, "0");
  return `${startHour}:${startMinute}-${endHour}:${endMinute}`;
};

const formatScheduleEntryLabel = (entry: {
  entryType: WorkerScheduleEntryType;
  startAt: Date;
  endAt: Date;
}) =>
  entry.entryType === WorkerScheduleEntryType.OFF
    ? "OFF"
    : formatWindowLabel(entry.startAt, entry.endAt);

export async function generateWorkerSchedulesFromTemplateAssignments(
  args: {
    rangeStart: Date | string;
    rangeEnd: Date | string;
    actorUserId?: number | null;
    branchId?: number;
  },
  prisma: WorkforceDbClient = db,
) {
  const rangeStart = toDateOnly(args.rangeStart);
  const rangeEnd = toDateOnly(args.rangeEnd);

  if (rangeEnd < rangeStart) {
    throw new Error("rangeEnd must be on or after rangeStart.");
  }

  const assignments = await prisma.scheduleTemplateAssignment.findMany({
    where: {
      status: "ACTIVE",
      effectiveFrom: { lte: rangeEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: rangeStart } }],
      template: {
        is: {
          status: "ACTIVE",
          effectiveFrom: { lte: rangeEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: rangeStart } }],
          ...(args.branchId ? { branchId: args.branchId } : {}),
        },
      },
    },
    include: {
      template: {
        include: {
          days: { orderBy: { dayOfWeek: "asc" } },
        },
      },
      worker: {
        include: {
          user: {
            select: { role: true },
          },
        },
      },
    },
    orderBy: [{ workerId: "asc" }, { id: "asc" }],
  });
  const workerIds = [...new Set(assignments.map((assignment) => assignment.workerId))];
  const existingActiveRows =
    workerIds.length === 0
      ? []
      : await prisma.workerSchedule.findMany({
          where: {
            workerId: { in: workerIds },
            status: { not: WorkerScheduleStatus.CANCELLED },
            scheduleDate: {
              gte: rangeStart,
              lte: rangeEnd,
            },
          },
          select: {
            workerId: true,
            scheduleDate: true,
          },
        });
  const occupiedWorkerDates = new Set(
    existingActiveRows.map((row) => buildWorkerDateKey(row.workerId, row.scheduleDate)),
  );
  const dates = enumerateDatesInclusive(rangeStart, rangeEnd);
  const rowsToCreate: Array<{
    workerId: number;
    role: WorkerScheduleRole;
    branchId: number | null;
    scheduleDate: Date;
    entryType: WorkerScheduleEntryType;
    startAt: Date;
    endAt: Date;
    templateAssignmentId: number;
    status: WorkerScheduleStatus;
    createdById: number | null;
    updatedById: number | null;
    note: string | null;
  }> = [];

  for (const assignment of assignments) {
    const templateBranchId = assignment.template.branchId ?? null;
    const scheduleRole = deriveWorkerScheduleRole(
      assignment.template.role,
      assignment.worker.user?.role,
    );

    for (const date of dates) {
      if (
        !fallsWithinEffectiveRange(
          date,
          assignment.effectiveFrom,
          assignment.effectiveTo,
        ) ||
        !fallsWithinEffectiveRange(
          date,
          assignment.template.effectiveFrom,
          assignment.template.effectiveTo,
        )
      ) {
        continue;
      }

      const matchingDay = assignment.template.days.find(
        (day) => DAY_OF_WEEK_INDEX[day.dayOfWeek] === date.getDay(),
      );
      if (!matchingDay) continue;
      const workerDateKey = buildWorkerDateKey(assignment.workerId, date);
      if (occupiedWorkerDates.has(workerDateKey)) {
        continue;
      }

      rowsToCreate.push({
        workerId: assignment.workerId,
        role: scheduleRole,
        branchId: templateBranchId,
        scheduleDate: new Date(date),
        entryType: WorkerScheduleEntryType.WORK,
        startAt: combineDateAndMinute(date, matchingDay.startMinute),
        endAt: combineDateAndMinute(date, matchingDay.endMinute),
        templateAssignmentId: assignment.id,
        status: WorkerScheduleStatus.DRAFT,
        createdById: args.actorUserId ?? null,
        updatedById: args.actorUserId ?? null,
        note: matchingDay.note ?? null,
      });
      occupiedWorkerDates.add(workerDateKey);
    }
  }

  if (rowsToCreate.length === 0) {
    return { createdCount: 0 };
  }

  const created = await prisma.workerSchedule.createMany({
    data: rowsToCreate,
    skipDuplicates: true,
  });

  return { createdCount: created.count };
}

type SetWorkerScheduleBoardCellInput = {
  workerId: number;
  scheduleDate: Date | string;
  actorUserId: number;
  startTime?: string | null;
  endTime?: string | null;
  note?: string | null;
  markOffDay?: boolean;
  clearSchedule?: boolean;
};

async function findBoardScheduleForWorkerDate(
  args: {
    workerId: number;
    scheduleDate: Date;
  },
  prisma: WorkforceDbClient,
) {
  const schedules = await prisma.workerSchedule.findMany({
    where: {
      workerId: args.workerId,
      scheduleDate: args.scheduleDate,
      status: { not: WorkerScheduleStatus.CANCELLED },
    },
    orderBy: [{ publishedAt: "desc" }, { startAt: "asc" }, { id: "asc" }],
  });

  if (schedules.length > 1) {
    throw new Error(
      "Planner board supports one active schedule row per worker per date. Resolve duplicate rows first.",
    );
  }

  return schedules[0] ?? null;
}

async function findCancelledScheduleForExactWindow(
  args: {
    workerId: number;
    scheduleDate: Date;
    startAt: Date;
    endAt: Date;
  },
  prisma: WorkforceDbClient,
) {
  return prisma.workerSchedule.findFirst({
    where: {
      workerId: args.workerId,
      scheduleDate: args.scheduleDate,
      startAt: args.startAt,
      endAt: args.endAt,
      status: WorkerScheduleStatus.CANCELLED,
    },
  });
}

async function reviveCancelledBoardSchedule(
  args: {
    cancelledScheduleId: number;
    actorUserId: number;
    role: WorkerScheduleRole;
    branchId: number | null;
    templateAssignmentId: number | null;
    scheduleDate: Date;
    entryType: WorkerScheduleEntryType;
    startAt: Date;
    endAt: Date;
    status: WorkerScheduleStatus;
    publishedById: number | null;
    publishedAt: Date | null;
    note: string | null;
  },
  prisma: WorkforceDbClient,
) {
  return prisma.workerSchedule.update({
    where: { id: args.cancelledScheduleId },
    data: {
      role: args.role,
      branchId: args.branchId,
      templateAssignmentId: args.templateAssignmentId,
      scheduleDate: args.scheduleDate,
      entryType: args.entryType,
      startAt: args.startAt,
      endAt: args.endAt,
      status: args.status,
      publishedById: args.publishedById,
      publishedAt: args.publishedAt,
      note: args.note,
      updatedById: args.actorUserId,
    },
  });
}

async function runInWorkforceTransaction<T>(
  prisma: WorkforceDbClient,
  fn: (tx: WorkforceDbClient) => Promise<T>,
) {
  if ("$transaction" in prisma && typeof prisma.$transaction === "function") {
    return prisma.$transaction(async (tx) => fn(tx));
  }

  return fn(prisma);
}

export async function setWorkerScheduleBoardCell(
  input: SetWorkerScheduleBoardCellInput,
  prisma: WorkforceDbClient = db,
) {
  const scheduleDate = toDateOnly(input.scheduleDate);
  const existing = await findBoardScheduleForWorkerDate(
    {
      workerId: input.workerId,
      scheduleDate,
    },
    prisma,
  );

  if (input.clearSchedule) {
    if (!existing) {
      return null;
    }

    const note =
      input.note?.trim() ||
      (existing.entryType === WorkerScheduleEntryType.OFF
        ? "Planner board cleared this saved OFF day."
        : "Planner board cleared this worker from the duty date.");
    const updated = await prisma.workerSchedule.update({
      where: { id: existing.id },
      data: {
        status: WorkerScheduleStatus.CANCELLED,
        note,
        updatedById: input.actorUserId,
      },
    });

    await appendWorkerScheduleEvent(
      {
        scheduleId: existing.id,
        eventType: WorkerScheduleEventType.SCHEDULE_CANCELLED,
        actorUserId: input.actorUserId,
        subjectWorkerId: existing.workerId,
        note,
      },
      prisma,
    );

    return updated;
  }

  const worker = await prisma.employee.findUnique({
    where: { id: input.workerId },
    include: {
      user: {
        select: { role: true },
      },
    },
  });

  if (!worker) {
    throw new Error("Worker not found.");
  }

  const role = deriveWorkerScheduleRole(null, worker.user?.role);

  if (input.markOffDay) {
    const nextNote = input.note?.trim() || "Planner board marked this worker OFF for the duty date.";
    const offWindow = buildOffDayWindow(scheduleDate);
    const cancelledOffMatch = await findCancelledScheduleForExactWindow(
      {
        workerId: worker.id,
        scheduleDate,
        startAt: offWindow.startAt,
        endAt: offWindow.endAt,
      },
      prisma,
    );

    if (!existing) {
      if (cancelledOffMatch) {
        const revived = await reviveCancelledBoardSchedule(
          {
            cancelledScheduleId: cancelledOffMatch.id,
            actorUserId: input.actorUserId,
            role,
            branchId: null,
            templateAssignmentId: null,
            scheduleDate,
            entryType: WorkerScheduleEntryType.OFF,
            startAt: offWindow.startAt,
            endAt: offWindow.endAt,
            status: WorkerScheduleStatus.DRAFT,
            publishedById: null,
            publishedAt: null,
            note: nextNote,
          },
          prisma,
        );

        await appendWorkerScheduleEvent(
          {
            scheduleId: revived.id,
            eventType: WorkerScheduleEventType.MANAGER_NOTE_ADDED,
            actorUserId: input.actorUserId,
            subjectWorkerId: revived.workerId,
            note:
              input.note?.trim() ||
              "Planner board revived this previously cleared OFF day.",
          },
          prisma,
        );

        return revived;
      }

      return prisma.workerSchedule.create({
        data: {
          workerId: worker.id,
          role,
          branchId: null,
          scheduleDate,
          entryType: WorkerScheduleEntryType.OFF,
          startAt: offWindow.startAt,
          endAt: offWindow.endAt,
          status: WorkerScheduleStatus.DRAFT,
          note: nextNote,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
        },
      });
    }

    const unchanged =
      existing.entryType === WorkerScheduleEntryType.OFF &&
      (existing.note ?? null) === nextNote;

    if (unchanged) {
      return existing;
    }

    if (cancelledOffMatch) {
      return runInWorkforceTransaction(prisma, async (tx) => {
        await cancelWorkerSchedule(
          {
            scheduleId: existing.id,
            actorUserId: input.actorUserId,
            note:
              input.note?.trim() ||
              `Planner board replaced ${formatScheduleEntryLabel(existing)} by reviving a previously cleared OFF row.`,
          },
          tx,
        );

        const revived = await reviveCancelledBoardSchedule(
          {
            cancelledScheduleId: cancelledOffMatch.id,
            actorUserId: input.actorUserId,
            role,
            branchId: existing.branchId,
            templateAssignmentId: existing.templateAssignmentId,
            scheduleDate,
            entryType: WorkerScheduleEntryType.OFF,
            startAt: offWindow.startAt,
            endAt: offWindow.endAt,
            status: existing.status,
            publishedById: existing.publishedById,
            publishedAt: existing.publishedAt,
            note: nextNote,
          },
          tx,
        );

        await appendWorkerScheduleEvent(
          {
            scheduleId: revived.id,
            eventType: WorkerScheduleEventType.MANAGER_NOTE_ADDED,
            actorUserId: input.actorUserId,
            subjectWorkerId: revived.workerId,
            note:
              input.note?.trim() ||
              `Planner board revived a previously cleared row as OFF instead of creating a duplicate.`,
          },
          tx,
        );

        return revived;
      });
    }

    const updated = await prisma.workerSchedule.update({
      where: { id: existing.id },
      data: {
        role,
        entryType: WorkerScheduleEntryType.OFF,
        startAt: offWindow.startAt,
        endAt: offWindow.endAt,
        note: nextNote,
        updatedById: input.actorUserId,
      },
    });

    await appendWorkerScheduleEvent(
      {
        scheduleId: existing.id,
        eventType: WorkerScheduleEventType.MANAGER_NOTE_ADDED,
        actorUserId: input.actorUserId,
        subjectWorkerId: existing.workerId,
        note:
          input.note?.trim() ||
          `Planner board updated ${formatScheduleEntryLabel(existing)} -> OFF.`,
      },
      prisma,
    );

    return updated;
  }

  if (!input.startTime || !input.endTime) {
    throw new Error("Start and end time are required.");
  }

  const nextStartAt = combineDateAndMinute(
    scheduleDate,
    parseTimeToMinute(input.startTime),
  );
  const nextEndAt = combineDateAndMinute(
    scheduleDate,
    parseTimeToMinute(input.endTime),
  );
  const cancelledWorkMatch = await findCancelledScheduleForExactWindow(
    {
      workerId: worker.id,
      scheduleDate,
      startAt: nextStartAt,
      endAt: nextEndAt,
    },
    prisma,
  );

  if (nextEndAt <= nextStartAt) {
    throw new Error("End time must be later than start time.");
  }

  const note = input.note?.trim() || null;

  if (!existing) {
    if (cancelledWorkMatch) {
      const revived = await reviveCancelledBoardSchedule(
        {
          cancelledScheduleId: cancelledWorkMatch.id,
          actorUserId: input.actorUserId,
          role,
          branchId: null,
          templateAssignmentId: null,
          scheduleDate,
          entryType: WorkerScheduleEntryType.WORK,
          startAt: nextStartAt,
          endAt: nextEndAt,
          status: WorkerScheduleStatus.DRAFT,
          publishedById: null,
          publishedAt: null,
          note,
        },
        prisma,
      );

      await appendWorkerScheduleEvent(
        {
          scheduleId: revived.id,
          eventType: WorkerScheduleEventType.MANAGER_NOTE_ADDED,
          actorUserId: input.actorUserId,
          subjectWorkerId: revived.workerId,
          note:
            note ||
            `Planner board revived this previously cleared row as ${formatWindowLabel(nextStartAt, nextEndAt)}.`,
        },
        prisma,
      );

      return revived;
    }

    return prisma.workerSchedule.create({
      data: {
        workerId: worker.id,
        role,
        branchId: null,
        scheduleDate,
        entryType: WorkerScheduleEntryType.WORK,
        startAt: nextStartAt,
        endAt: nextEndAt,
        status: WorkerScheduleStatus.DRAFT,
        note,
        createdById: input.actorUserId,
        updatedById: input.actorUserId,
      },
    });
  }

  const nextNote = note ?? existing.note;
  const unchanged =
    existing.entryType === WorkerScheduleEntryType.WORK &&
    existing.startAt.getTime() === nextStartAt.getTime() &&
    existing.endAt.getTime() === nextEndAt.getTime() &&
    (nextNote ?? null) === (existing.note ?? null);

  if (unchanged) {
    return existing;
  }

  if (cancelledWorkMatch) {
    return runInWorkforceTransaction(prisma, async (tx) => {
      await cancelWorkerSchedule(
        {
          scheduleId: existing.id,
          actorUserId: input.actorUserId,
          note:
            note ||
            `Planner board replaced ${formatScheduleEntryLabel(existing)} by reviving a previously cleared ${formatWindowLabel(nextStartAt, nextEndAt)} row.`,
        },
        tx,
      );

      const revived = await reviveCancelledBoardSchedule(
        {
          cancelledScheduleId: cancelledWorkMatch.id,
          actorUserId: input.actorUserId,
          role,
          branchId: existing.branchId,
          templateAssignmentId: existing.templateAssignmentId,
          scheduleDate,
          entryType: WorkerScheduleEntryType.WORK,
          startAt: nextStartAt,
          endAt: nextEndAt,
          status: existing.status,
          publishedById: existing.publishedById,
          publishedAt: existing.publishedAt,
          note: nextNote,
        },
        tx,
      );

      await appendWorkerScheduleEvent(
        {
          scheduleId: revived.id,
          eventType: WorkerScheduleEventType.MANAGER_NOTE_ADDED,
          actorUserId: input.actorUserId,
          subjectWorkerId: revived.workerId,
          note:
            note ||
            `Planner board revived a previously cleared row as ${formatWindowLabel(nextStartAt, nextEndAt)} instead of creating a duplicate.`,
        },
        tx,
      );

      return revived;
    });
  }

  const updated = await prisma.workerSchedule.update({
    where: { id: existing.id },
    data: {
      role,
      entryType: WorkerScheduleEntryType.WORK,
      startAt: nextStartAt,
      endAt: nextEndAt,
      note: nextNote,
      updatedById: input.actorUserId,
    },
  });

  const eventNote =
    note ??
    `Planner board updated ${formatScheduleEntryLabel(existing)} -> ${formatWindowLabel(nextStartAt, nextEndAt)}.`;

  await appendWorkerScheduleEvent(
    {
      scheduleId: existing.id,
      eventType: WorkerScheduleEventType.MANAGER_NOTE_ADDED,
      actorUserId: input.actorUserId,
      subjectWorkerId: existing.workerId,
      note: eventNote,
    },
    prisma,
  );

  return updated;
}

export async function publishWorkerSchedules(
  args: {
    actorUserId: number;
    scheduleIds?: number[];
    rangeStart?: Date | string;
    rangeEnd?: Date | string;
    branchId?: number;
  },
  prisma: WorkforceDbClient = db,
) {
  const scheduleIds = args.scheduleIds?.filter(
    (scheduleId) => Number.isFinite(scheduleId) && scheduleId > 0,
  );

  const dateWindow =
    args.rangeStart && args.rangeEnd
      ? {
          scheduleDate: {
            gte: toDateOnly(args.rangeStart),
            lte: toDateOnly(args.rangeEnd),
          },
        }
      : {};

  const result = await prisma.workerSchedule.updateMany({
    where: {
      status: WorkerScheduleStatus.DRAFT,
      ...(scheduleIds && scheduleIds.length > 0 ? { id: { in: scheduleIds } } : {}),
      ...(args.branchId ? { branchId: args.branchId } : {}),
      ...dateWindow,
    },
    data: {
      status: WorkerScheduleStatus.PUBLISHED,
      publishedById: args.actorUserId,
      publishedAt: new Date(),
      updatedById: args.actorUserId,
    },
  });

  return { publishedCount: result.count };
}

export async function listWorkerSchedulesForRange(
  args: {
    rangeStart: Date | string;
    rangeEnd: Date | string;
    workerId?: number;
    branchId?: number;
    status?: WorkerScheduleStatus;
  },
  prisma: WorkforceDbClient = db,
) {
  return prisma.workerSchedule.findMany({
    where: {
      ...(args.workerId ? { workerId: args.workerId } : {}),
      ...(args.branchId ? { branchId: args.branchId } : {}),
      ...(args.status ? { status: args.status } : {}),
      scheduleDate: {
        gte: toDateOnly(args.rangeStart),
        lte: toDateOnly(args.rangeEnd),
      },
    },
    orderBy: [{ scheduleDate: "asc" }, { startAt: "asc" }, { workerId: "asc" }],
  });
}

export async function updateWorkerScheduleOneOff(
  args: {
    scheduleId: number;
    actorUserId: number;
    startTime?: string;
    endTime?: string;
    note?: string | null;
  },
  prisma: WorkforceDbClient = db,
) {
  const schedule = await prisma.workerSchedule.findUnique({
    where: { id: args.scheduleId },
  });
  if (!schedule) {
    throw new Error("Worker schedule not found.");
  }
  if (schedule.status === WorkerScheduleStatus.CANCELLED) {
    throw new Error("Cancelled schedules cannot be edited.");
  }
  if (schedule.entryType === WorkerScheduleEntryType.OFF) {
    throw new Error("Intentional OFF rows must be changed from the planner board.");
  }

  const nextStartAt = args.startTime
    ? combineDateAndMinute(schedule.scheduleDate, parseTimeToMinute(args.startTime))
    : schedule.startAt;
  const nextEndAt = args.endTime
    ? combineDateAndMinute(schedule.scheduleDate, parseTimeToMinute(args.endTime))
    : schedule.endAt;

  if (nextEndAt <= nextStartAt) {
    throw new Error("End time must be later than start time.");
  }

  const updated = await prisma.workerSchedule.update({
    where: { id: args.scheduleId },
    data: {
      startAt: nextStartAt,
      endAt: nextEndAt,
      note: args.note?.trim() || schedule.note,
      updatedById: args.actorUserId,
    },
  });

  const originalWindow = `${schedule.startAt.toISOString()} -> ${schedule.endAt.toISOString()}`;
  const nextWindow = `${updated.startAt.toISOString()} -> ${updated.endAt.toISOString()}`;
  const eventNote = [
    `One-off schedule update: ${originalWindow} => ${nextWindow}.`,
    args.note?.trim() || null,
  ]
    .filter(Boolean)
    .join(" ");

  await appendWorkerScheduleEvent(
    {
      scheduleId: schedule.id,
      eventType: WorkerScheduleEventType.MANAGER_NOTE_ADDED,
      actorUserId: args.actorUserId,
      subjectWorkerId: schedule.workerId,
      note: eventNote,
    },
    prisma,
  );

  return updated;
}

export async function cancelWorkerSchedule(
  args: {
    scheduleId: number;
    actorUserId: number;
    note?: string | null;
  },
  prisma: WorkforceDbClient = db,
) {
  const schedule = await prisma.workerSchedule.findUnique({
    where: { id: args.scheduleId },
  });
  if (!schedule) {
    throw new Error("Worker schedule not found.");
  }
  if (schedule.status === WorkerScheduleStatus.CANCELLED) {
    return schedule;
  }

  const note = args.note?.trim() || null;
  const updated = await prisma.workerSchedule.update({
    where: { id: args.scheduleId },
    data: {
      status: WorkerScheduleStatus.CANCELLED,
      note: note ?? schedule.note,
      updatedById: args.actorUserId,
    },
  });

  await appendWorkerScheduleEvent(
    {
      scheduleId: schedule.id,
      eventType: WorkerScheduleEventType.SCHEDULE_CANCELLED,
      actorUserId: args.actorUserId,
      subjectWorkerId: schedule.workerId,
      note: note ?? "Manager cancelled this one-off schedule row.",
    },
    prisma,
  );

  return updated;
}
