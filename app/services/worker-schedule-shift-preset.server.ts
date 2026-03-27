import { db } from "~/utils/db.server";
import type { WorkforceDbClient } from "~/services/worker-payroll-policy.server";

const HALF_HOUR_TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export function parseWorkerScheduleShiftPresetTimeToMinute(value: string) {
  const match = HALF_HOUR_TIME_PATTERN.exec(value.trim());
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
    throw new Error("Shift presets must use only whole hours or :30.");
  }

  return hour * 60 + minute;
}

function validateWorkerScheduleShiftPresetWindow(
  startMinute: number,
  endMinute: number,
) {
  if (endMinute <= startMinute) {
    throw new Error("Preset end time must be later than start time.");
  }
}

export async function listWorkerScheduleShiftPresets(
  prisma: WorkforceDbClient = db,
) {
  return prisma.workerScheduleShiftPreset.findMany({
    orderBy: [{ startMinute: "asc" }, { endMinute: "asc" }, { id: "asc" }],
  });
}

export async function createWorkerScheduleShiftPreset(
  args: {
    startTime: string;
    endTime: string;
    actorUserId: number;
  },
  prisma: WorkforceDbClient = db,
) {
  const startMinute = parseWorkerScheduleShiftPresetTimeToMinute(args.startTime);
  const endMinute = parseWorkerScheduleShiftPresetTimeToMinute(args.endTime);
  validateWorkerScheduleShiftPresetWindow(startMinute, endMinute);

  const duplicate = await prisma.workerScheduleShiftPreset.findFirst({
    where: {
      startMinute,
      endMinute,
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new Error("A work preset already exists for that time window.");
  }

  return prisma.workerScheduleShiftPreset.create({
    data: {
      startMinute,
      endMinute,
      createdById: args.actorUserId,
      updatedById: args.actorUserId,
    },
  });
}

export async function updateWorkerScheduleShiftPreset(
  args: {
    presetId: number;
    startTime: string;
    endTime: string;
    actorUserId: number;
  },
  prisma: WorkforceDbClient = db,
) {
  const preset = await prisma.workerScheduleShiftPreset.findUnique({
    where: { id: args.presetId },
    select: { id: true },
  });

  if (!preset) {
    throw new Error("Work preset not found.");
  }

  const startMinute = parseWorkerScheduleShiftPresetTimeToMinute(args.startTime);
  const endMinute = parseWorkerScheduleShiftPresetTimeToMinute(args.endTime);
  validateWorkerScheduleShiftPresetWindow(startMinute, endMinute);

  const duplicate = await prisma.workerScheduleShiftPreset.findFirst({
    where: {
      startMinute,
      endMinute,
      id: { not: args.presetId },
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new Error("A work preset already exists for that time window.");
  }

  return prisma.workerScheduleShiftPreset.update({
    where: { id: args.presetId },
    data: {
      startMinute,
      endMinute,
      updatedById: args.actorUserId,
    },
  });
}

export async function deleteWorkerScheduleShiftPreset(
  args: {
    presetId: number;
  },
  prisma: WorkforceDbClient = db,
) {
  const preset = await prisma.workerScheduleShiftPreset.findUnique({
    where: { id: args.presetId },
    select: { id: true },
  });

  if (!preset) {
    throw new Error("Work preset not found.");
  }

  await prisma.workerScheduleShiftPreset.delete({
    where: { id: args.presetId },
  });
}
