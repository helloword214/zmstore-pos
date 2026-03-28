import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useEffect, useState } from "react";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import { SelectInput } from "~/components/ui/SelectInput";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

type PlannerPreset = "next-week" | "next-two-weeks" | "next-month";

const WORKER_SCHEDULE_EVENT_TYPE = {
  MANAGER_NOTE_ADDED: "MANAGER_NOTE_ADDED",
  REPLACEMENT_ASSIGNED: "REPLACEMENT_ASSIGNED",
  ON_CALL_ASSIGNED: "ON_CALL_ASSIGNED",
} as const;

type WorkerScheduleEventTypeValue =
  (typeof WORKER_SCHEDULE_EVENT_TYPE)[keyof typeof WORKER_SCHEDULE_EVENT_TYPE];

const WORKER_SCHEDULE_EVENT_TYPE_VALUES = [
  WORKER_SCHEDULE_EVENT_TYPE.MANAGER_NOTE_ADDED,
  WORKER_SCHEDULE_EVENT_TYPE.REPLACEMENT_ASSIGNED,
  WORKER_SCHEDULE_EVENT_TYPE.ON_CALL_ASSIGNED,
] as const;

const WORKER_SCHEDULE_STATUS = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  CANCELLED: "CANCELLED",
} as const;

const WORKER_SCHEDULE_ENTRY_TYPE = {
  WORK: "WORK",
  OFF: "OFF",
} as const;

const OFF_DAY_PRESET_KEY = "OFF";
const DATE_ONLY_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_ONLY_SAFE_HOUR = 12;

const EVENT_OPTIONS = [
  { value: WORKER_SCHEDULE_EVENT_TYPE.MANAGER_NOTE_ADDED, label: "Manager note" },
  {
    value: WORKER_SCHEDULE_EVENT_TYPE.REPLACEMENT_ASSIGNED,
    label: "Replacement assigned",
  },
  {
    value: WORKER_SCHEDULE_EVENT_TYPE.ON_CALL_ASSIGNED,
    label: "On-call assigned",
  },
];

function parseOptionalInt(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toDateOnly(value: Date | string) {
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
}

function formatDateInput(value: Date | string) {
  const date = toDateOnly(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: Date | string) {
  const date = toDateOnly(value);
  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatBoardDayLabel(value: Date | string) {
  const date = toDateOnly(value);
  return date.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
}

function formatDateTimeLabel(value: Date | string) {
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatTimeValue(value: Date | string) {
  const date = new Date(value);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function minuteToTimeValue(minute: number) {
  const hour = String(Math.floor(minute / 60)).padStart(2, "0");
  const remainder = String(minute % 60).padStart(2, "0");
  return `${hour}:${remainder}`;
}

function formatTimeDisplay(value: Date | string) {
  return new Date(value).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatCompactTimeCodePart(value: Date | string) {
  const timeValue =
    typeof value === "string" && /^\d{2}:\d{2}$/.test(value.trim())
      ? value.trim()
      : formatTimeValue(value);
  const [hourToken, minuteToken] = timeValue.split(":");
  const hour = Number(hourToken);
  const minute = Number(minuteToken);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return timeValue;
  }
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0
    ? String(hour12)
    : `${hour12}:${String(minute).padStart(2, "0")}`;
}

function formatHalfHourOptionLabel(value: string) {
  const [hourToken, minuteToken] = value.split(":");
  const hour = Number(hourToken);
  const minute = Number(minuteToken);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    (minute !== 0 && minute !== 30)
  ) {
    return value;
  }
  const meridiem = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function formatPresetCompactCode(startTime: string, endTime: string) {
  return `${formatCompactTimeCodePart(startTime)}-${formatCompactTimeCodePart(endTime)}`;
}

const HALF_HOUR_TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const totalMinutes = index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return {
    value,
    label: formatHalfHourOptionLabel(value),
  };
});

function buildCustomTimeOptions(currentValue: string | null) {
  if (
    !currentValue ||
    HALF_HOUR_TIME_OPTIONS.some((option) => option.value === currentValue)
  ) {
    return HALF_HOUR_TIME_OPTIONS;
  }

  return [
    {
      value: currentValue,
      label: `${currentValue} (legacy)`,
    },
    ...HALF_HOUR_TIME_OPTIONS,
  ];
}

type PlannerShiftPresetView = {
  id: number;
  key: string;
  startTime: string;
  endTime: string;
  timeWindowLabel: string;
  shortLabel: string;
};

function buildShiftPresetView(preset: {
  id: number;
  startMinute: number;
  endMinute: number;
}): PlannerShiftPresetView {
  const startTime = minuteToTimeValue(preset.startMinute);
  const endTime = minuteToTimeValue(preset.endMinute);
  return {
    id: preset.id,
    key: String(preset.id),
    startTime,
    endTime,
    timeWindowLabel: `${formatHalfHourOptionLabel(startTime)} - ${formatHalfHourOptionLabel(endTime)}`,
    shortLabel: formatPresetCompactCode(startTime, endTime),
  };
}

function formatTimeWindow(startAt: Date | string, endAt: Date | string) {
  return `${formatTimeDisplay(startAt)} - ${formatTimeDisplay(endAt)}`;
}

function findBoardShiftPreset(
  presets: PlannerShiftPresetView[],
  startAt: Date | string,
  endAt: Date | string,
): PlannerShiftPresetView | null {
  const startTime = formatTimeValue(startAt);
  const endTime = formatTimeValue(endAt);
  return (
    presets.find(
      (preset) => preset.startTime === startTime && preset.endTime === endTime,
    ) ?? null
  );
}

function isOffSchedule(
  schedule:
    | {
        entryType: string;
      }
    | null
    | undefined,
) {
  return schedule?.entryType === WORKER_SCHEDULE_ENTRY_TYPE.OFF;
}

function isWorkSchedule(
  schedule:
    | {
        entryType: string;
      }
    | null
    | undefined,
) {
  return schedule?.entryType === WORKER_SCHEDULE_ENTRY_TYPE.WORK;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfNextWeek(reference: Date) {
  const current = toDateOnly(reference);
  const day = current.getDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  return addDays(current, daysUntilMonday);
}

function endOfWeek(start: Date) {
  return addDays(start, 6);
}

function startOfNextMonth(reference: Date) {
  return new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
}

function endOfMonth(reference: Date) {
  return new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
}

function enumerateDatesInclusive(start: Date, end: Date) {
  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function resolvePlannerRange(url: URL) {
  const preset = url.searchParams.get("preset") as PlannerPreset | null;
  const today = toDateOnly(new Date());

  if (preset === "next-month") {
    const rangeStart = startOfNextMonth(today);
    return { rangeStart, rangeEnd: endOfMonth(rangeStart), preset };
  }

  if (preset === "next-two-weeks") {
    const rangeStart = startOfNextWeek(today);
    return { rangeStart, rangeEnd: addDays(rangeStart, 13), preset };
  }

  if (preset === "next-week") {
    const rangeStart = startOfNextWeek(today);
    return { rangeStart, rangeEnd: endOfWeek(rangeStart), preset };
  }

  const rangeStartParam = url.searchParams.get("rangeStart");
  const rangeEndParam = url.searchParams.get("rangeEnd");
  if (rangeStartParam && rangeEndParam) {
    return {
      rangeStart: toDateOnly(rangeStartParam),
      rangeEnd: toDateOnly(rangeEndParam),
      preset: null,
    };
  }

  const rangeStart = startOfNextWeek(today);
  return {
    rangeStart,
    rangeEnd: endOfWeek(rangeStart),
    preset: "next-week" as const,
  };
}

function buildPlannerRedirect(args: {
  rangeStart: string;
  rangeEnd: string;
  workerId?: number | null;
  scheduleDate?: string | null;
  saved?: string;
}) {
  const params = new URLSearchParams({
    rangeStart: args.rangeStart,
    rangeEnd: args.rangeEnd,
  });
  if (args.workerId) {
    params.set("workerId", String(args.workerId));
  }
  if (args.scheduleDate) {
    params.set("scheduleDate", args.scheduleDate);
  }
  if (args.saved) {
    params.set("saved", args.saved);
  }
  return `/store/workforce/schedule-planner?${params.toString()}`;
}

function buildWorkerLabel(worker: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  const fullName = `${worker.firstName} ${worker.lastName}`.trim();
  return `${fullName}${worker.alias ? ` (${worker.alias})` : ""}`;
}

function buildCellKey(workerId: number, dateKey: string) {
  return `${workerId}:${dateKey}`;
}

function statusTone(status: string) {
  if (status === "PUBLISHED") return "success" as const;
  if (status === "DRAFT") return "warning" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "info" as const;
}

function plannerSavedMessage(saved: string | null) {
  if (saved === "generated") {
    return "Draft rows generated from active template assignments.";
  }
  if (saved === "published") {
    return "Draft rows in this window were published.";
  }
  if (saved === "preset-applied") {
    return "Quick shift preset applied to the selected cell.";
  }
  if (saved === "off-marked") {
    return "Selected cell marked as an intentional OFF day.";
  }
  if (saved === "cell-cleared") {
    return "Selected cell returned to blank.";
  }
  if (saved === "custom-saved") {
    return "Custom schedule row saved for the selected cell.";
  }
  if (saved === "event-added") {
    return "Schedule event appended to the selected row.";
  }
  if (saved === "shift-preset-created") {
    return "Work preset added to the planner library.";
  }
  if (saved === "shift-preset-updated") {
    return "Work preset updated.";
  }
  if (saved === "shift-preset-deleted") {
    return "Work preset removed from the planner library.";
  }
  return null;
}

function isWorkerScheduleEventTypeValue(
  value: string,
): value is WorkerScheduleEventTypeValue {
  return WORKER_SCHEDULE_EVENT_TYPE_VALUES.includes(
    value as WorkerScheduleEventTypeValue,
  );
}

function actorLabel(actor: {
  email: string | null;
  employee: { firstName: string; lastName: string; alias: string | null } | null;
} | null) {
  if (!actor) return "Unknown actor";
  if (actor.employee) {
    return buildWorkerLabel({
      firstName: actor.employee.firstName,
      lastName: actor.employee.lastName,
      alias: actor.employee.alias,
    });
  }
  return actor.email ?? "Unknown actor";
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);
  const [
    { listWorkerScheduleShiftPresets },
    { listWorkerScheduleEventsForSchedules },
  ] = await Promise.all([
    import("~/services/worker-schedule-shift-preset.server"),
    import("~/services/worker-schedule-event.server"),
  ]);
  const url = new URL(request.url);
  const { rangeStart, rangeEnd, preset } = resolvePlannerRange(url);
  const saved = url.searchParams.get("saved");
  const dates = enumerateDatesInclusive(rangeStart, rangeEnd);
  const dateKeys = dates.map((date) => formatDateInput(date));
  const selectedWorkerId = parseOptionalInt(url.searchParams.get("workerId"));
  const selectedDateKeyParam = url.searchParams.get("scheduleDate");
  const selectedDateKey =
    selectedDateKeyParam && dateKeys.includes(selectedDateKeyParam)
      ? selectedDateKeyParam
      : null;

  const [schedules, workers, shiftPresets] =
    await Promise.all([
      db.workerSchedule.findMany({
        where: {
          scheduleDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        include: {
          worker: {
            include: {
              user: {
                select: { role: true },
              },
            },
          },
          attendanceDutyResult: true,
          templateAssignment: {
            include: {
              template: {
                select: { templateName: true },
              },
            },
          },
        },
        orderBy: [
          { scheduleDate: "asc" },
          { status: "asc" },
          { startAt: "asc" },
          { worker: { lastName: "asc" } },
        ],
      }),
      db.employee.findMany({
        where: {
          active: true,
          user: { is: { active: true } },
        },
        include: {
          user: {
            select: { role: true },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      }),
      listWorkerScheduleShiftPresets(),
    ]);

  const scheduleByCell = new Map<string, (typeof schedules)[number]>();
  for (const schedule of schedules) {
    if (schedule.status === WORKER_SCHEDULE_STATUS.CANCELLED) {
      continue;
    }
    const cellKey = buildCellKey(
      schedule.workerId,
      formatDateInput(schedule.scheduleDate),
    );
    if (!scheduleByCell.has(cellKey)) {
      scheduleByCell.set(cellKey, schedule);
    }
  }

  const selectedWorker =
    selectedWorkerId == null
      ? null
      : workers.find((worker) => worker.id === selectedWorkerId) ?? null;

  const scheduleEvents = await listWorkerScheduleEventsForSchedules(
    schedules
      .filter((schedule) => schedule.status !== WORKER_SCHEDULE_STATUS.CANCELLED)
      .map((schedule) => schedule.id),
  );

  return json({
    boardDates: dates.map((date) => ({
      key: formatDateInput(date),
      label: formatBoardDayLabel(date),
      fullLabel: formatDateLabel(date),
    })),
    boardRows: workers.map((worker) => ({
      worker: {
        id: worker.id,
        label: buildWorkerLabel(worker),
        role: worker.user?.role ?? "UNASSIGNED",
      },
      cells: dateKeys.map((dateKey) => ({
        dateKey,
        schedule: scheduleByCell.get(buildCellKey(worker.id, dateKey)) ?? null,
      })),
    })),
    workers: workers.map((worker) => ({
      id: worker.id,
      label: buildWorkerLabel(worker),
      role: worker.user?.role ?? "UNASSIGNED",
    })),
    shiftPresets: shiftPresets.map(buildShiftPresetView),
    saved,
    preset,
    rangeStart: formatDateInput(rangeStart),
    rangeEnd: formatDateInput(rangeEnd),
    initialSelectedWorkerId: selectedWorker?.id ?? null,
    initialSelectedDateKey: selectedDateKey,
    scheduleEvents,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);
  const [
    {
      generateWorkerSchedulesFromTemplateAssignments,
      publishWorkerSchedules,
      setWorkerScheduleBoardCell,
    },
    {
      createWorkerScheduleShiftPreset,
      deleteWorkerScheduleShiftPreset,
      updateWorkerScheduleShiftPreset,
    },
    { appendWorkerScheduleEvent },
  ] = await Promise.all([
    import("~/services/worker-schedule-publication.server"),
    import("~/services/worker-schedule-shift-preset.server"),
    import("~/services/worker-schedule-event.server"),
  ]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  const rangeStart = String(fd.get("rangeStart") || "");
  const rangeEnd = String(fd.get("rangeEnd") || "");
  const workerId = parseOptionalInt(String(fd.get("workerId") || ""));
  const scheduleDate = String(fd.get("scheduleDate") || "");

  try {
    if (intent === "generate-range") {
      await generateWorkerSchedulesFromTemplateAssignments({
        rangeStart,
        rangeEnd,
        actorUserId: me.userId,
      });
      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          saved: "generated",
        }),
      );
    }

    if (intent === "publish-range") {
      await publishWorkerSchedules({
        actorUserId: me.userId,
        rangeStart,
        rangeEnd,
      });
      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          saved: "published",
        }),
      );
    }

    if (intent === "set-board-preset") {
      if (!workerId || !scheduleDate) {
        throw new Error("Worker and duty date are required.");
      }

      const presetIdValue = String(fd.get("presetId") || "");
      if (presetIdValue === OFF_DAY_PRESET_KEY) {
        await setWorkerScheduleBoardCell({
          workerId,
          scheduleDate,
          actorUserId: me.userId,
          markOffDay: true,
        });
        return redirect(
          buildPlannerRedirect({
            rangeStart,
            rangeEnd,
            saved: "off-marked",
          }),
        );
      }

      const presetId = parseOptionalInt(presetIdValue);
      if (!presetId) {
        throw new Error("Select a saved work preset first.");
      }

      const preset = await db.workerScheduleShiftPreset.findUnique({
        where: { id: presetId },
        select: { startMinute: true, endMinute: true },
      });
      if (!preset) {
        throw new Error("Work preset not found.");
      }

      await setWorkerScheduleBoardCell({
        workerId,
        scheduleDate,
        actorUserId: me.userId,
        startTime: minuteToTimeValue(preset.startMinute),
        endTime: minuteToTimeValue(preset.endMinute),
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          saved: "preset-applied",
        }),
      );
    }

    if (intent === "create-shift-preset") {
      await createWorkerScheduleShiftPreset({
        startTime: String(fd.get("startTime") || ""),
        endTime: String(fd.get("endTime") || ""),
        actorUserId: me.userId,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "shift-preset-created",
        }),
      );
    }

    if (intent === "update-shift-preset") {
      const presetId = parseOptionalInt(String(fd.get("presetId") || ""));
      if (!presetId) {
        throw new Error("Work preset is required.");
      }

      await updateWorkerScheduleShiftPreset({
        presetId,
        startTime: String(fd.get("startTime") || ""),
        endTime: String(fd.get("endTime") || ""),
        actorUserId: me.userId,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "shift-preset-updated",
        }),
      );
    }

    if (intent === "delete-shift-preset") {
      const presetId = parseOptionalInt(String(fd.get("presetId") || ""));
      if (!presetId) {
        throw new Error("Work preset is required.");
      }

      await deleteWorkerScheduleShiftPreset({ presetId });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "shift-preset-deleted",
        }),
      );
    }

    if (intent === "clear-board-cell") {
      if (!workerId || !scheduleDate) {
        throw new Error("Worker and duty date are required.");
      }

      await setWorkerScheduleBoardCell({
        workerId,
        scheduleDate,
        actorUserId: me.userId,
        clearSchedule: true,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          saved: "cell-cleared",
        }),
      );
    }

    if (intent === "set-board-custom") {
      if (!workerId || !scheduleDate) {
        throw new Error("Worker and duty date are required.");
      }

      await setWorkerScheduleBoardCell({
        workerId,
        scheduleDate,
        actorUserId: me.userId,
        startTime: String(fd.get("startTime") || ""),
        endTime: String(fd.get("endTime") || ""),
        note: String(fd.get("note") || ""),
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "custom-saved",
        }),
      );
    }

    if (intent === "append-event") {
      const scheduleId = parseOptionalInt(String(fd.get("scheduleId") || ""));
      if (!scheduleId || !workerId || !scheduleDate) {
        throw new Error("Select a scheduled cell first.");
      }

      const eventType = String(fd.get("eventType") || "");
      const relatedWorkerId = parseOptionalInt(String(fd.get("relatedWorkerId") || ""));
      const note = String(fd.get("note") || "");

      if (!isWorkerScheduleEventTypeValue(eventType)) {
        throw new Error("Unsupported schedule event.");
      }

      if (
        (eventType === WORKER_SCHEDULE_EVENT_TYPE.REPLACEMENT_ASSIGNED ||
          eventType === WORKER_SCHEDULE_EVENT_TYPE.ON_CALL_ASSIGNED) &&
        !relatedWorkerId
      ) {
        throw new Error("Related worker is required for replacement/on-call events.");
      }

      await appendWorkerScheduleEvent({
        scheduleId,
        eventType,
        actorUserId: me.userId,
        subjectWorkerId: workerId,
        relatedWorkerId,
        note,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          workerId,
          scheduleDate,
          saved: "event-added",
        }),
      );
    }

    return json<ActionData>(
      { ok: false, error: "Unsupported action.", action: intent },
      { status: 400 },
    );
  } catch (error) {
    return json<ActionData>(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save changes.",
        action: intent,
      },
      { status: 400 },
    );
  }
}

export default function WorkforceSchedulePlannerRoute() {
  const {
    boardDates,
    boardRows,
    workers,
    shiftPresets,
    saved,
    preset,
    rangeStart,
    rangeEnd,
    initialSelectedWorkerId,
    initialSelectedDateKey,
    scheduleEvents,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const [activeCell, setActiveCell] = useState<{
    workerId: number;
    dateKey: string;
  } | null>(
    initialSelectedWorkerId && initialSelectedDateKey
      ? { workerId: initialSelectedWorkerId, dateKey: initialSelectedDateKey }
      : null,
  );

  useEffect(() => {
    if (initialSelectedWorkerId && initialSelectedDateKey) {
      setActiveCell({
        workerId: initialSelectedWorkerId,
        dateKey: initialSelectedDateKey,
      });
      return;
    }

    if (
      saved === "preset-applied" ||
      saved === "off-marked" ||
      saved === "cell-cleared" ||
      saved === "published" ||
      saved === "generated"
    ) {
      setActiveCell(null);
    }
  }, [initialSelectedDateKey, initialSelectedWorkerId, saved]);

  const isDenseWindow = boardDates.length > 7;
  const isVeryDenseWindow = boardDates.length > 20;
  const selectedWorker =
    activeCell == null
      ? null
      : workers.find((worker) => worker.id === activeCell.workerId) ?? null;
  const selectedBoardRow =
    activeCell == null
      ? null
      : boardRows.find((row) => row.worker.id === activeCell.workerId) ?? null;
  const selectedCell =
    activeCell == null
      ? null
      : selectedBoardRow?.cells.find((cell) => cell.dateKey === activeCell.dateKey) ?? null;
  const selectedSchedule = selectedCell?.schedule ?? null;
  const selectedDateKey = activeCell?.dateKey ?? null;
  const selectedDateLabel = selectedDateKey ? formatDateLabel(selectedDateKey) : null;
  const selectedEvents =
    selectedSchedule == null
      ? []
      : scheduleEvents.filter((event) => event.scheduleId === selectedSchedule.id);
  const selectedPreset =
    selectedSchedule == null || !isWorkSchedule(selectedSchedule)
      ? null
      : findBoardShiftPreset(
          shiftPresets,
          selectedSchedule.startAt,
          selectedSchedule.endAt,
        );
  const selectedWorkStartTime =
    selectedSchedule && isWorkSchedule(selectedSchedule)
      ? formatTimeValue(selectedSchedule.startAt)
      : null;
  const selectedWorkEndTime =
    selectedSchedule && isWorkSchedule(selectedSchedule)
      ? formatTimeValue(selectedSchedule.endAt)
      : null;
  const customStartTimeOptions = buildCustomTimeOptions(selectedWorkStartTime);
  const customEndTimeOptions = buildCustomTimeOptions(selectedWorkEndTime);
  const selectedCellBadgeTone = selectedSchedule
    ? isOffSchedule(selectedSchedule)
      ? "warning"
      : statusTone(selectedSchedule.status)
    : "neutral";
  const selectedCellBadgeLabel = selectedSchedule
    ? isOffSchedule(selectedSchedule)
      ? "OFF"
      : selectedSchedule.status
    : "BLANK";
  const selectedCellSummaryTitle = selectedSchedule
    ? isOffSchedule(selectedSchedule)
      ? "Intentional OFF day"
      : formatTimeWindow(selectedSchedule.startAt, selectedSchedule.endAt)
    : "No saved row yet";
  const selectedCellSummaryDetail = selectedSchedule
    ? isOffSchedule(selectedSchedule)
      ? `${
          selectedSchedule.status === WORKER_SCHEDULE_STATUS.PUBLISHED
            ? "Published OFF row"
            : "Draft OFF row"
        }${selectedSchedule.note ? ` · ${selectedSchedule.note}` : ""}`
      : selectedSchedule.templateAssignment?.template?.templateName
        ? `Source: ${selectedSchedule.templateAssignment.template.templateName}`
        : selectedSchedule.note
          ? `Source: direct board row · ${selectedSchedule.note}`
        : "Source: direct board row"
    : "Choose a preset or save a custom time to create one draft row for this worker-date cell.";
  const isCellModalOpen = Boolean(activeCell);
  const shouldOpenCustomEditor =
    actionData?.action === "set-board-custom" ||
    saved === "custom-saved" ||
    Boolean(
      selectedSchedule && isWorkSchedule(selectedSchedule) && selectedPreset == null,
    );
  const shouldOpenCellHistory = saved === "event-added";
  const shouldOpenStaffingActivity =
    actionData?.action === "append-event" || saved === "event-added";
  const pageSuccessMessage =
    saved === "custom-saved" ||
    saved === "event-added" ||
    saved === "shift-preset-created" ||
    saved === "shift-preset-updated" ||
    saved === "shift-preset-deleted"
      ? null
      : plannerSavedMessage(saved);
  const modalSuccessMessage =
    saved === "custom-saved" ||
    saved === "event-added" ||
    saved === "shift-preset-created" ||
    saved === "shift-preset-updated" ||
    saved === "shift-preset-deleted"
      ? plannerSavedMessage(saved)
      : null;
  const showPageError = Boolean(actionData && !actionData.ok && !isCellModalOpen);
  const showModalError = Boolean(actionData && !actionData.ok && isCellModalOpen);
  const plannerWindowLabel =
    preset === "next-week"
      ? "Next week"
      : preset === "next-two-weeks"
        ? "Next 2 weeks"
        : preset === "next-month"
          ? "Next month"
          : `${formatDateLabel(rangeStart)} - ${formatDateLabel(rangeEnd)}`;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Workforce Planner Board"
        subtitle="Build the week on one canvas, use presets for speed, and open one focused editor only when a cell needs detail."
        backTo="/store"
        backLabel="Manager Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-4 px-5 py-6">
        {pageSuccessMessage ? <SoTAlert tone="success">{pageSuccessMessage}</SoTAlert> : null}
        {showPageError ? <SoTAlert tone="warning">{actionData?.error}</SoTAlert> : null}

        <section className="rounded-[26px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
                Planner canvas
              </div>
              <h2 className="mt-1 text-base font-semibold text-slate-900">
                {plannerWindowLabel}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Direct board edits save draft rows right away. Publish only when this
                window is ready.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Form method="get" className="flex flex-wrap items-end gap-2">
                <div className="w-[155px]">
                  <SoTFormField label="Start">
                    <SoTInput
                      type="date"
                      name="rangeStart"
                      defaultValue={rangeStart}
                      required
                    />
                  </SoTFormField>
                </div>
                <div className="w-[155px]">
                  <SoTFormField label="End">
                    <SoTInput
                      type="date"
                      name="rangeEnd"
                      defaultValue={rangeEnd}
                      required
                    />
                  </SoTFormField>
                </div>
                <div className="flex items-end">
                  <SoTButton type="submit" variant="primary">
                    Load
                  </SoTButton>
                </div>
              </Form>

              <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <Link
                  to="/store/workforce/schedule-planner?preset=next-week"
                  preventScrollReset
                  className={`inline-flex h-9 items-center px-3 text-sm font-medium ${
                    preset === "next-week"
                      ? "bg-indigo-50 text-indigo-800"
                      : "text-slate-700 hover:bg-white"
                  }`}
                >
                  Week
                </Link>
                <Link
                  to="/store/workforce/schedule-planner?preset=next-two-weeks"
                  preventScrollReset
                  className={`inline-flex h-9 items-center border-l border-slate-200 px-3 text-sm font-medium ${
                    preset === "next-two-weeks"
                      ? "bg-indigo-50 text-indigo-800"
                      : "text-slate-700 hover:bg-white"
                  }`}
                >
                  2 Weeks
                </Link>
                <Link
                  to="/store/workforce/schedule-planner?preset=next-month"
                  preventScrollReset
                  className={`inline-flex h-9 items-center border-l border-slate-200 px-3 text-sm font-medium ${
                    preset === "next-month"
                      ? "bg-indigo-50 text-indigo-800"
                      : "text-slate-700 hover:bg-white"
                  }`}
                >
                  Month
                </Link>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Link
                  to="/store/workforce/schedule-templates"
                  className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Templates
                </Link>
                <Form method="post">
                  <input type="hidden" name="_intent" value="generate-range" />
                  <input type="hidden" name="rangeStart" value={rangeStart} />
                  <input type="hidden" name="rangeEnd" value={rangeEnd} />
                  <SoTButton type="submit" variant="secondary" size="compact">
                    Generate
                  </SoTButton>
                </Form>
                <Form method="post">
                  <input type="hidden" name="_intent" value="publish-range" />
                  <input type="hidden" name="rangeStart" value={rangeStart} />
                  <input type="hidden" name="rangeEnd" value={rangeEnd} />
                  <SoTButton type="submit" variant="primary">
                    Publish
                  </SoTButton>
                </Form>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)]">
          <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="mt-1 text-base font-semibold text-slate-900">
                Employee schedule board
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Click any cell to edit.
              </p>
            </div>
            <div className="text-xs text-slate-500">Preset cells save and close.</div>
          </div>

          <div className="overflow-x-auto">
            <table
              className={`w-full border-collapse text-sm ${
                isVeryDenseWindow
                  ? "min-w-[720px]"
                  : isDenseWindow
                    ? "min-w-[840px]"
                    : "min-w-[980px]"
              }`}
            >
              <thead className="bg-slate-50/90">
                <tr>
                  <th
                    className={`border-b border-r border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 ${
                      isDenseWindow ? "min-w-[170px]" : "min-w-[200px]"
                    }`}
                  >
                    Employee
                  </th>
                  {boardDates.map((date) => (
                    <th
                      key={date.key}
                      className={`border-b border-slate-200 px-3 py-3 text-left align-top ${
                        isVeryDenseWindow
                          ? "min-w-[96px]"
                          : isDenseWindow
                            ? "min-w-[112px]"
                            : "min-w-[138px]"
                      }`}
                    >
                      {isDenseWindow ? (
                        <>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {date.label.slice(0, 3)}
                          </div>
                          <div className="mt-1 text-xs font-medium text-slate-700">
                            {date.key.slice(-2)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {date.label}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {date.fullLabel}
                          </div>
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {boardRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={boardDates.length + 1}
                      className="px-4 py-6 text-center text-sm text-slate-500"
                    >
                      No active employees found for the planner board.
                    </td>
                  </tr>
                ) : (
                  boardRows.map((row) => (
                    <tr key={row.worker.id} className="align-top">
                      <th className="border-r border-t border-slate-200 bg-white px-4 py-4 text-left">
                        <div className="font-semibold text-slate-900">{row.worker.label}</div>
                      </th>
                      {row.cells.map((cell) => {
                        const isSelected =
                          activeCell?.workerId === row.worker.id &&
                          activeCell?.dateKey === cell.dateKey;
                        const offCell = isOffSchedule(cell.schedule);
                        const workCell = isWorkSchedule(cell.schedule);
                        const matchedPreset =
                          !workCell || cell.schedule == null
                            ? null
                            : findBoardShiftPreset(
                                shiftPresets,
                                cell.schedule.startAt,
                                cell.schedule.endAt,
                              );
                        const primaryLabel = offCell
                          ? "OFF"
                          : cell.schedule
                            ? matchedPreset
                              ? matchedPreset.timeWindowLabel
                              : formatTimeWindow(
                                  cell.schedule.startAt,
                                  cell.schedule.endAt,
                                )
                            : "Blank";
                        const supportingLabel = offCell
                          ? "Day off"
                          : cell.schedule
                            ? cell.schedule.status === WORKER_SCHEDULE_STATUS.PUBLISHED
                              ? "Published"
                              : "Draft"
                            : null;
                        const cellToneClass = offCell
                          ? "border-rose-100 bg-rose-50/70 hover:border-rose-200"
                          : cell.schedule
                            ? cell.schedule.status === WORKER_SCHEDULE_STATUS.PUBLISHED
                              ? "border-emerald-100 bg-emerald-50/70 hover:border-emerald-200"
                              : "border-amber-100 bg-amber-50/70 hover:border-amber-200"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50";

                        return (
                          <td
                            key={cell.dateKey}
                            className={`border-t border-slate-200 px-2 py-2 ${
                              isSelected ? "bg-indigo-50/40" : "bg-white"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setActiveCell({
                                  workerId: row.worker.id,
                                  dateKey: cell.dateKey,
                                })
                              }
                              className={`block min-h-[72px] w-full rounded-[20px] border px-3 py-3 text-left ${cellToneClass} ${
                                isSelected
                                  ? "border-indigo-300 ring-2 ring-indigo-100"
                                  : ""
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                  {supportingLabel ?? ""}
                                </span>
                                {isSelected ? (
                                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                                ) : null}
                              </div>
                              <div
                                className={`mt-3 font-semibold text-slate-900 ${
                                  isVeryDenseWindow
                                    ? "text-xs"
                                    : isDenseWindow
                                      ? "text-[13px]"
                                      : "text-sm"
                                }`}
                              >
                                {primaryLabel}
                              </div>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {isCellModalOpen ? (
          <>
            <button
              type="button"
              aria-label="Close cell editor"
              onClick={() => setActiveCell(null)}
              className="fixed inset-0 z-40 bg-slate-900/30"
            />

            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
              <div className="relative max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-200 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-xl">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
                        Cell editor
                      </div>
                      <h2 className="mt-1 text-xl font-semibold text-slate-900">
                        {selectedWorker?.label} · {selectedDateLabel}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Quick presets save and close. Custom time stays here for finer edits.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <SoTStatusBadge tone={selectedCellBadgeTone}>
                        {selectedCellBadgeLabel}
                      </SoTStatusBadge>
                      <button
                        type="button"
                        onClick={() => setActiveCell(null)}
                        className="inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  {modalSuccessMessage ? (
                    <div className="mt-4">
                      <SoTAlert tone="success">{modalSuccessMessage}</SoTAlert>
                    </div>
                  ) : null}
                  {showModalError ? (
                    <div className="mt-4">
                      <SoTAlert tone="warning">{actionData?.error}</SoTAlert>
                    </div>
                  ) : null}
                </div>

                <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-5 py-4">
                  <div className="space-y-3">
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            {selectedCellSummaryTitle}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {selectedCellSummaryDetail}
                          </div>
                        </div>
                        {selectedSchedule?.status ? (
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                            {selectedSchedule.status}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <section className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
                      <div>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">
                            Quick presets
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                            Use saved work presets first for faster scheduling. OFF / Day off
                            stays fixed as a built-in choice.
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        {shiftPresets.map((preset) => {
                          const isCurrentPreset =
                            selectedPreset != null && preset.key === selectedPreset.key;

                          return (
                            <Form method="post" key={preset.key}>
                              <input type="hidden" name="_intent" value="set-board-preset" />
                              <input
                                type="hidden"
                                name="workerId"
                                value={selectedWorker?.id ?? ""}
                              />
                              <input
                                type="hidden"
                                name="scheduleDate"
                                value={selectedDateKey ?? ""}
                              />
                              <input type="hidden" name="rangeStart" value={rangeStart} />
                              <input type="hidden" name="rangeEnd" value={rangeEnd} />
                              <input type="hidden" name="presetId" value={preset.id} />
                              <button
                                type="submit"
                                className={`w-full rounded-[18px] border px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                                  isCurrentPreset
                                    ? "border-indigo-300 bg-indigo-50"
                                    : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold text-slate-900">
                                    {preset.timeWindowLabel}
                                  </span>
                                  {isCurrentPreset ? (
                                    <SoTStatusBadge tone="info">Current</SoTStatusBadge>
                                  ) : null}
                                </div>
                                <div className="mt-2 text-xs text-slate-500">
                                  Saved work preset
                                </div>
                              </button>
                            </Form>
                          );
                        })}

                        <Form method="post">
                          <input type="hidden" name="_intent" value="set-board-preset" />
                          <input
                            type="hidden"
                            name="workerId"
                            value={selectedWorker?.id ?? ""}
                          />
                          <input
                            type="hidden"
                            name="scheduleDate"
                            value={selectedDateKey ?? ""}
                          />
                          <input type="hidden" name="rangeStart" value={rangeStart} />
                          <input type="hidden" name="rangeEnd" value={rangeEnd} />
                          <input type="hidden" name="presetId" value={OFF_DAY_PRESET_KEY} />
                          <button
                            type="submit"
                            className={`w-full rounded-[18px] border px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                              isOffSchedule(selectedSchedule)
                                ? "border-rose-300 bg-rose-50"
                                : "border-rose-200 bg-rose-50 hover:border-rose-300"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                OFF / Day off
                              </span>
                              {isOffSchedule(selectedSchedule) ? (
                                <SoTStatusBadge tone="warning">Current</SoTStatusBadge>
                              ) : null}
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              Mark this date as intentional day off.
                            </div>
                          </button>
                        </Form>
                      </div>
                    </section>

                    <details className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
                      <summary className="cursor-pointer list-none">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">
                            Manage work presets
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                            Update reusable work hours here. OFF / Day off stays fixed and
                            is not part of the editable preset list.
                          </p>
                        </div>
                      </summary>

                      <div className="mt-4 space-y-3">
                        {shiftPresets.length === 0 ? (
                          <SoTAlert tone="info">
                            No saved work presets yet. Add one below to speed up scheduling.
                          </SoTAlert>
                        ) : null}

                        {shiftPresets.map((preset) => {
                          const isSelectedPreset =
                            selectedPreset != null && selectedPreset.key === preset.key;

                          return (
                            <div
                              key={`manage-${preset.id}`}
                              className={`rounded-[18px] border px-4 py-4 ${
                                isSelectedPreset
                                  ? "border-indigo-200 bg-indigo-50/60"
                                  : "border-slate-200 bg-slate-50/70"
                              }`}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">
                                    {preset.timeWindowLabel}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    Reusable work preset
                                    {isSelectedPreset
                                      ? " · matches this selected work row"
                                      : ""}
                                  </div>
                                </div>
                                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                  {preset.shortLabel}
                                </span>
                              </div>

                              <Form method="post" className="mt-4 space-y-3">
                                <input type="hidden" name="_intent" value="update-shift-preset" />
                                <input type="hidden" name="presetId" value={preset.id} />
                                <input
                                  type="hidden"
                                  name="workerId"
                                  value={selectedWorker?.id ?? ""}
                                />
                                <input
                                  type="hidden"
                                  name="scheduleDate"
                                  value={selectedDateKey ?? ""}
                                />
                                <input type="hidden" name="rangeStart" value={rangeStart} />
                                <input type="hidden" name="rangeEnd" value={rangeEnd} />

                                <div className="grid gap-3 md:grid-cols-2">
                                  <SelectInput
                                    label="Start"
                                    name="startTime"
                                    defaultValue={preset.startTime}
                                    options={HALF_HOUR_TIME_OPTIONS}
                                  />
                                  <SelectInput
                                    label="End"
                                    name="endTime"
                                    defaultValue={preset.endTime}
                                    options={HALF_HOUR_TIME_OPTIONS}
                                  />
                                </div>

                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <SoTButton type="submit" variant="primary">
                                    Save preset
                                  </SoTButton>
                                </div>
                              </Form>

                              <Form method="post" className="mt-2 flex justify-end">
                                <input type="hidden" name="_intent" value="delete-shift-preset" />
                                <input type="hidden" name="presetId" value={preset.id} />
                                <input
                                  type="hidden"
                                  name="workerId"
                                  value={selectedWorker?.id ?? ""}
                                />
                                <input
                                  type="hidden"
                                  name="scheduleDate"
                                  value={selectedDateKey ?? ""}
                                />
                                <input type="hidden" name="rangeStart" value={rangeStart} />
                                <input type="hidden" name="rangeEnd" value={rangeEnd} />
                                <SoTButton type="submit" variant="secondary">
                                  Remove preset
                                </SoTButton>
                              </Form>
                            </div>
                          );
                        })}

                        <div className="rounded-[18px] border border-dashed border-slate-300 bg-white px-4 py-4">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">
                              Add work preset
                            </h4>
                            <p className="mt-1 text-xs text-slate-500">
                              Save another common shift so managers can apply it with one click.
                            </p>
                          </div>

                          <Form method="post" className="mt-4 space-y-3">
                            <input type="hidden" name="_intent" value="create-shift-preset" />
                            <input
                              type="hidden"
                              name="workerId"
                              value={selectedWorker?.id ?? ""}
                            />
                            <input
                              type="hidden"
                              name="scheduleDate"
                              value={selectedDateKey ?? ""}
                            />
                            <input type="hidden" name="rangeStart" value={rangeStart} />
                            <input type="hidden" name="rangeEnd" value={rangeEnd} />

                            <div className="grid gap-3 md:grid-cols-2">
                              <SelectInput
                                label="Start"
                                name="startTime"
                                defaultValue="06:00"
                                options={HALF_HOUR_TIME_OPTIONS}
                              />
                              <SelectInput
                                label="End"
                                name="endTime"
                                defaultValue="15:00"
                                options={HALF_HOUR_TIME_OPTIONS}
                              />
                            </div>

                            <div className="flex justify-end">
                              <SoTButton type="submit" variant="primary">
                                Add preset
                              </SoTButton>
                            </div>
                          </Form>
                        </div>
                      </div>
                    </details>

                    <details
                      className="rounded-[20px] border border-slate-200 bg-white px-4 py-4"
                      open={shouldOpenCustomEditor}
                    >
                      <summary className="cursor-pointer list-none">
                        <div>
                          <div>
                            <h3 className="text-sm font-semibold text-slate-900">
                              Custom time
                            </h3>
                            <p className="mt-1 text-xs text-slate-500">
                              Use this only when the preset choices do not fit. Hours must be on
                              :00 or :30 only.
                            </p>
                          </div>
                        </div>
                      </summary>

                      <Form method="post" className="mt-4 space-y-3">
                        <input type="hidden" name="_intent" value="set-board-custom" />
                        <input
                          type="hidden"
                          name="workerId"
                          value={selectedWorker?.id ?? ""}
                        />
                        <input
                          type="hidden"
                          name="scheduleDate"
                          value={selectedDateKey ?? ""}
                        />
                        <input type="hidden" name="rangeStart" value={rangeStart} />
                        <input type="hidden" name="rangeEnd" value={rangeEnd} />

                        <div className="grid gap-3 md:grid-cols-2">
                          <SelectInput
                            label="Start time"
                            name="startTime"
                            defaultValue={selectedWorkStartTime ?? "06:00"}
                            options={customStartTimeOptions}
                          />
                          <SelectInput
                            label="End time"
                            name="endTime"
                            defaultValue={selectedWorkEndTime ?? "15:00"}
                            options={customEndTimeOptions}
                          />
                        </div>

                        <SoTFormField label="Manager note">
                          <SoTInput
                            name="note"
                            defaultValue={
                              selectedSchedule && isWorkSchedule(selectedSchedule)
                                ? (selectedSchedule.note ?? "")
                                : ""
                            }
                            placeholder="Optional reason for this custom timing"
                          />
                        </SoTFormField>

                        <div className="flex justify-end">
                          <SoTButton type="submit" variant="primary">
                            Save custom cell
                          </SoTButton>
                        </div>
                      </Form>
                    </details>

                    {selectedSchedule && isWorkSchedule(selectedSchedule) ? (
                      <details
                        className="rounded-[20px] border border-slate-200 bg-white px-4 py-4"
                        open={shouldOpenStaffingActivity}
                      >
                        <summary className="cursor-pointer list-none">
                          <div>
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">
                                Staffing activity
                              </h3>
                              <p className="mt-1 text-xs text-slate-500">
                                Append replacement, on-call, or manager notes only when needed.
                              </p>
                            </div>
                          </div>
                        </summary>

                        <Form method="post" className="mt-4 space-y-3">
                          <input type="hidden" name="_intent" value="append-event" />
                          <input type="hidden" name="scheduleId" value={selectedSchedule.id} />
                          <input
                            type="hidden"
                            name="workerId"
                            value={selectedSchedule.workerId}
                          />
                          <input
                            type="hidden"
                            name="scheduleDate"
                            value={
                              selectedDateKey ??
                              formatDateInput(selectedSchedule.scheduleDate)
                            }
                          />
                          <input type="hidden" name="rangeStart" value={rangeStart} />
                          <input type="hidden" name="rangeEnd" value={rangeEnd} />

                          <SelectInput
                            label="Event type"
                            name="eventType"
                            defaultValue={WORKER_SCHEDULE_EVENT_TYPE.MANAGER_NOTE_ADDED}
                            options={EVENT_OPTIONS}
                          />

                          <SelectInput
                            label="Related worker (optional)"
                            name="relatedWorkerId"
                            defaultValue=""
                            options={[
                              { value: "", label: "None" },
                              ...workers
                                .filter((worker) => worker.id !== selectedSchedule.workerId)
                                .map((worker) => ({
                                  value: worker.id,
                                  label: `${worker.label} · ${worker.role}`,
                                })),
                            ]}
                          />

                          <SoTFormField label="Event note">
                            <SoTInput
                              name="note"
                              placeholder="Explain the coverage or staffing note"
                              required
                            />
                          </SoTFormField>

                          <div className="flex justify-end">
                            <SoTButton type="submit" variant="primary">
                              Append event
                            </SoTButton>
                          </div>
                        </Form>
                      </details>
                    ) : null}

                    {selectedSchedule ? (
                      <details
                        className="rounded-[20px] border border-slate-200 bg-white px-4 py-4"
                        open={shouldOpenCellHistory}
                      >
                        <summary className="cursor-pointer list-none">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">
                                Cell history
                              </h3>
                              <p className="mt-1 text-xs text-slate-500">
                                {selectedWorker?.label} · {selectedDateLabel}
                              </p>
                            </div>
                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                              {selectedEvents.length} event
                              {selectedEvents.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        </summary>

                        <div className="mt-4 space-y-2">
                          {selectedEvents.length === 0 ? (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                              No staffing events yet.
                            </div>
                          ) : (
                            selectedEvents.map((event) => (
                              <div
                                key={event.id}
                                className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <SoTStatusBadge tone="info">
                                    {event.eventType}
                                  </SoTStatusBadge>
                                  <span className="text-xs text-slate-500">
                                    {formatDateTimeLabel(event.effectiveAt)}
                                  </span>
                                </div>
                                <div className="mt-2 text-sm font-medium text-slate-800">
                                  {event.note ?? "No note provided."}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  Actor: {actorLabel(event.actorUser)}
                                  {event.relatedWorker
                                    ? ` · Related worker: ${buildWorkerLabel(event.relatedWorker)}`
                                    : ""}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </details>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 bg-slate-50/90 px-4 py-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          Return cell to blank
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Remove the saved row so this cell becomes unassigned again.
                        </div>
                      </div>

                      <Form method="post">
                        <input type="hidden" name="_intent" value="clear-board-cell" />
                        <input
                          type="hidden"
                          name="workerId"
                          value={selectedWorker?.id ?? ""}
                        />
                        <input
                          type="hidden"
                          name="scheduleDate"
                          value={selectedDateKey ?? ""}
                        />
                        <input type="hidden" name="rangeStart" value={rangeStart} />
                        <input type="hidden" name="rangeEnd" value={rangeEnd} />
                        <SoTButton
                          type="submit"
                          variant="secondary"
                          disabled={!selectedSchedule}
                        >
                          Clear to blank
                        </SoTButton>
                      </Form>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
