import { WorkerScheduleEventType } from "@prisma/client";
import { db } from "~/utils/db.server";
import type { WorkforceDbClient } from "~/services/worker-payroll-policy.server";

export type AppendWorkerScheduleEventInput = {
  scheduleId: number;
  eventType: WorkerScheduleEventType;
  actorUserId?: number | null;
  subjectWorkerId: number;
  relatedWorkerId?: number | null;
  note?: string | null;
  effectiveAt?: Date;
};

export async function appendWorkerScheduleEvent(
  input: AppendWorkerScheduleEventInput,
  prisma: WorkforceDbClient = db,
) {
  return prisma.scheduleEvent.create({
    data: {
      scheduleId: input.scheduleId,
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? null,
      subjectWorkerId: input.subjectWorkerId,
      relatedWorkerId: input.relatedWorkerId ?? null,
      note: input.note?.trim() || null,
      effectiveAt: input.effectiveAt ?? new Date(),
    },
  });
}

export async function listWorkerScheduleEventsForSchedules(
  scheduleIds: number[],
  prisma: WorkforceDbClient = db,
) {
  const normalized = Array.from(
    new Set(
      scheduleIds.filter(
        (scheduleId) => Number.isFinite(scheduleId) && scheduleId > 0,
      ),
    ),
  );

  if (normalized.length === 0) {
    return [];
  }

  return prisma.scheduleEvent.findMany({
    where: { scheduleId: { in: normalized } },
    include: {
      actorUser: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      subjectWorker: {
        select: { id: true, firstName: true, lastName: true, alias: true },
      },
      relatedWorker: {
        select: { id: true, firstName: true, lastName: true, alias: true },
      },
    },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}
