import {
  UserRole,
  WorkerScheduleRole,
  WorkerScheduleStatus,
  WorkerScheduleTemplateDayOfWeek,
} from "@prisma/client";
import { db } from "~/utils/db.server";
import type { WorkforceDbClient } from "~/services/worker-payroll-policy.server";

const DAY_OF_WEEK_INDEX: Record<WorkerScheduleTemplateDayOfWeek, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

const toDateOnly = (value: Date | string) => {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(0, 0, 0, 0);
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

const fallsWithinEffectiveRange = (
  date: Date,
  effectiveFrom: Date,
  effectiveTo: Date | null,
) => date >= effectiveFrom && (!effectiveTo || date <= effectiveTo);

const deriveWorkerScheduleRole = (
  templateRole: WorkerScheduleRole | null,
  userRole: UserRole | null | undefined,
) => {
  if (templateRole) return templateRole;
  if (userRole === UserRole.CASHIER) return WorkerScheduleRole.CASHIER;
  if (userRole === UserRole.STORE_MANAGER) return WorkerScheduleRole.STORE_MANAGER;
  return WorkerScheduleRole.EMPLOYEE;
};

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
  const dates = enumerateDatesInclusive(rangeStart, rangeEnd);
  const rowsToCreate: Array<{
    workerId: number;
    role: WorkerScheduleRole;
    branchId: number | null;
    scheduleDate: Date;
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

      rowsToCreate.push({
        workerId: assignment.workerId,
        role: scheduleRole,
        branchId: templateBranchId,
        scheduleDate: new Date(date),
        startAt: combineDateAndMinute(date, matchingDay.startMinute),
        endAt: combineDateAndMinute(date, matchingDay.endMinute),
        templateAssignmentId: assignment.id,
        status: WorkerScheduleStatus.DRAFT,
        createdById: args.actorUserId ?? null,
        updatedById: args.actorUserId ?? null,
        note: matchingDay.note ?? null,
      });
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
