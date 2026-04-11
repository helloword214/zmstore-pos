import {
  WorkerScheduleAssignmentStatus,
  WorkerScheduleRole,
  WorkerScheduleTemplateDayOfWeek,
  WorkerScheduleTemplateStatus,
} from "@prisma/client";
import { db } from "~/utils/db.server";
import type { WorkforceDbClient } from "~/services/worker-payroll-policy.server";

export type WorkerScheduleTemplateDayInput = {
  dayOfWeek: WorkerScheduleTemplateDayOfWeek;
  startMinute: number;
  endMinute: number;
  note?: string | null;
};

export type UpsertWorkerScheduleTemplateInput = {
  id?: number;
  templateName: string;
  branchId?: number | null;
  role?: WorkerScheduleRole | null;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  days: WorkerScheduleTemplateDayInput[];
  actorUserId?: number | null;
};

export type AssignWorkerScheduleTemplateInput = {
  templateId: number;
  workerIds: number[];
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  actorUserId?: number | null;
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

const toOptionalDateOnly = (value?: Date | string | null) =>
  value == null ? null : toDateOnly(value);

const normalizeDays = (days: WorkerScheduleTemplateDayInput[]) => {
  if (days.length === 0) {
    throw new Error("At least one template day is required.");
  }

  const seen = new Set<WorkerScheduleTemplateDayOfWeek>();

  return days.map((day) => {
    if (seen.has(day.dayOfWeek)) {
      throw new Error(`Duplicate template day: ${day.dayOfWeek}.`);
    }
    seen.add(day.dayOfWeek);

    if (
      !Number.isInteger(day.startMinute) ||
      !Number.isInteger(day.endMinute) ||
      day.startMinute < 0 ||
      day.endMinute > 24 * 60 ||
      day.endMinute <= day.startMinute
    ) {
      throw new Error(
        `Invalid start/end minute range for ${day.dayOfWeek}.`,
      );
    }

    return {
      dayOfWeek: day.dayOfWeek,
      startMinute: day.startMinute,
      endMinute: day.endMinute,
      note: day.note?.trim() || null,
    };
  });
};

export async function upsertWorkerScheduleTemplate(
  input: UpsertWorkerScheduleTemplateInput,
  prisma: WorkforceDbClient = db,
) {
  const effectiveFrom = toDateOnly(input.effectiveFrom);
  const effectiveTo = toOptionalDateOnly(input.effectiveTo);
  const normalizedDays = normalizeDays(input.days);

  if (!input.templateName.trim()) {
    throw new Error("templateName is required.");
  }

  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error("effectiveTo must be on or after effectiveFrom.");
  }

  if (input.id) {
    return prisma.scheduleTemplate.update({
      where: { id: input.id },
      data: {
        templateName: input.templateName.trim(),
        branchId: input.branchId ?? null,
        role: input.role ?? null,
        effectiveFrom,
        effectiveTo,
        updatedById: input.actorUserId ?? null,
        days: {
          deleteMany: {},
          create: normalizedDays,
        },
      },
      include: {
        days: { orderBy: { dayOfWeek: "asc" } },
      },
    });
  }

  return prisma.scheduleTemplate.create({
    data: {
      templateName: input.templateName.trim(),
      branchId: input.branchId ?? null,
      role: input.role ?? null,
      effectiveFrom,
      effectiveTo,
      createdById: input.actorUserId ?? null,
      updatedById: input.actorUserId ?? null,
      days: {
        create: normalizedDays,
      },
    },
    include: {
      days: { orderBy: { dayOfWeek: "asc" } },
    },
  });
}

export async function setWorkerScheduleTemplateStatus(
  templateId: number,
  status: WorkerScheduleTemplateStatus,
  actorUserId?: number | null,
  prisma: WorkforceDbClient = db,
) {
  return prisma.scheduleTemplate.update({
    where: { id: templateId },
    data: {
      status,
      updatedById: actorUserId ?? null,
    },
  });
}

export async function assignWorkerScheduleTemplateToWorkers(
  input: AssignWorkerScheduleTemplateInput,
  prisma: WorkforceDbClient = db,
) {
  const effectiveFrom = toDateOnly(input.effectiveFrom);
  const effectiveTo = toOptionalDateOnly(input.effectiveTo);

  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error("effectiveTo must be on or after effectiveFrom.");
  }

  const workerIds = Array.from(
    new Set(
      input.workerIds
        .map((workerId) => Number(workerId))
        .filter((workerId) => Number.isFinite(workerId) && workerId > 0),
    ),
  );

  if (workerIds.length === 0) {
    throw new Error("At least one workerId is required.");
  }

  await prisma.scheduleTemplateAssignment.createMany({
    data: workerIds.map((workerId) => ({
      templateId: input.templateId,
      workerId,
      effectiveFrom,
      effectiveTo,
      status: WorkerScheduleAssignmentStatus.ACTIVE,
      createdById: input.actorUserId ?? null,
      updatedById: input.actorUserId ?? null,
    })),
    skipDuplicates: true,
  });

  return prisma.scheduleTemplateAssignment.findMany({
    where: {
      templateId: input.templateId,
      workerId: { in: workerIds },
      effectiveFrom,
    },
    orderBy: [{ workerId: "asc" }, { id: "asc" }],
  });
}

export async function setWorkerScheduleTemplateAssignmentStatus(
  assignmentId: number,
  status: WorkerScheduleAssignmentStatus,
  actorUserId?: number | null,
  prisma: WorkforceDbClient = db,
) {
  return prisma.scheduleTemplateAssignment.update({
    where: { id: assignmentId },
    data: {
      status,
      updatedById: actorUserId ?? null,
    },
  });
}

export async function listActiveWorkerScheduleTemplateAssignments(
  args: {
    onDate: Date | string;
    branchId?: number;
    workerId?: number;
  },
  prisma: WorkforceDbClient = db,
) {
  const onDate = toDateOnly(args.onDate);

  return prisma.scheduleTemplateAssignment.findMany({
    where: {
      ...(args.workerId ? { workerId: args.workerId } : {}),
      status: WorkerScheduleAssignmentStatus.ACTIVE,
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      template: {
        is: {
          status: WorkerScheduleTemplateStatus.ACTIVE,
          effectiveFrom: { lte: onDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
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
}

export async function listWorkerScheduleTemplates(
  prisma: WorkforceDbClient = db,
) {
  return prisma.scheduleTemplate.findMany({
    include: {
      days: { orderBy: { dayOfWeek: "asc" } },
      assignments: {
        include: {
          worker: {
            include: {
              user: {
                select: { role: true, active: true },
              },
            },
          },
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
      },
    },
    orderBy: [{ status: "asc" }, { templateName: "asc" }, { id: "asc" }],
  });
}

export async function listWorkerScheduleTemplateAssignments(
  args: {
    templateId?: number;
    workerId?: number;
    status?: WorkerScheduleAssignmentStatus;
  },
  prisma: WorkforceDbClient = db,
) {
  return prisma.scheduleTemplateAssignment.findMany({
    where: {
      ...(args.templateId ? { templateId: args.templateId } : {}),
      ...(args.workerId ? { workerId: args.workerId } : {}),
      ...(args.status ? { status: args.status } : {}),
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
            select: { role: true, active: true },
          },
        },
      },
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });
}

export async function listWorkerScheduleTemplatesForPlanner(
  args: {
    rangeStart: Date | string;
    rangeEnd: Date | string;
  },
  prisma: WorkforceDbClient = db,
) {
  const rangeStart = toDateOnly(args.rangeStart);
  const rangeEnd = toDateOnly(args.rangeEnd);

  if (rangeEnd < rangeStart) {
    throw new Error("rangeEnd must be on or after rangeStart.");
  }

  return prisma.scheduleTemplate.findMany({
    where: {
      status: WorkerScheduleTemplateStatus.ACTIVE,
      effectiveFrom: { lte: rangeEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: rangeStart } }],
    },
    include: {
      days: { orderBy: { dayOfWeek: "asc" } },
    },
    orderBy: [{ templateName: "asc" }, { id: "asc" }],
  });
}

export async function listWorkerScheduleTemplateAssignmentsForPlanner(
  args: {
    rangeStart: Date | string;
    rangeEnd: Date | string;
  },
  prisma: WorkforceDbClient = db,
) {
  const rangeStart = toDateOnly(args.rangeStart);
  const rangeEnd = toDateOnly(args.rangeEnd);

  if (rangeEnd < rangeStart) {
    throw new Error("rangeEnd must be on or after rangeStart.");
  }

  return prisma.scheduleTemplateAssignment.findMany({
    where: {
      status: WorkerScheduleAssignmentStatus.ACTIVE,
      effectiveFrom: { lte: rangeEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: rangeStart } }],
      template: {
        is: {
          status: WorkerScheduleTemplateStatus.ACTIVE,
          effectiveFrom: { lte: rangeEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: rangeStart } }],
        },
      },
    },
    include: {
      template: {
        include: {
          days: { orderBy: { dayOfWeek: "asc" } },
        },
      },
    },
    orderBy: [
      { workerId: "asc" },
      { effectiveFrom: "asc" },
      { template: { templateName: "asc" } },
      { id: "asc" },
    ],
  });
}
