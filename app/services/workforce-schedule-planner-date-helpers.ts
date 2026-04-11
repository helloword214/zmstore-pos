export type PlannerPreset = "next-week" | "next-two-weeks" | "next-month";

export type PatternApplyWindow =
  | "this-week"
  | "next-week"
  | "next-two-weeks"
  | "next-four-weeks";

export const WORKER_SCHEDULE_EVENT_TYPE = {
  MANAGER_NOTE_ADDED: "MANAGER_NOTE_ADDED",
  REPLACEMENT_ASSIGNED: "REPLACEMENT_ASSIGNED",
  ON_CALL_ASSIGNED: "ON_CALL_ASSIGNED",
} as const;

export type WorkerScheduleEventTypeValue =
  (typeof WORKER_SCHEDULE_EVENT_TYPE)[keyof typeof WORKER_SCHEDULE_EVENT_TYPE];

export const WORKER_SCHEDULE_EVENT_TYPE_VALUES = [
  WORKER_SCHEDULE_EVENT_TYPE.MANAGER_NOTE_ADDED,
  WORKER_SCHEDULE_EVENT_TYPE.REPLACEMENT_ASSIGNED,
  WORKER_SCHEDULE_EVENT_TYPE.ON_CALL_ASSIGNED,
] as const;

export const WORKER_SCHEDULE_STATUS = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  CANCELLED: "CANCELLED",
} as const;

export const WORKER_SCHEDULE_ENTRY_TYPE = {
  WORK: "WORK",
  OFF: "OFF",
} as const;

export const TEMPLATE_DAY_INDEX: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

export const PATTERN_APPLY_WINDOW_OPTIONS: Array<{
  value: PatternApplyWindow;
  label: string;
}> = [
  { value: "this-week", label: "This week" },
  { value: "next-week", label: "Next week" },
  { value: "next-two-weeks", label: "Next 2 weeks" },
  { value: "next-four-weeks", label: "Next 4 weeks" },
];

export const OFF_DAY_PRESET_KEY = "OFF";
const DATE_ONLY_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_ONLY_SAFE_HOUR = 12;

export const EVENT_OPTIONS = [
  { value: WORKER_SCHEDULE_EVENT_TYPE.MANAGER_NOTE_ADDED, label: "Manager note" },
  {
    value: WORKER_SCHEDULE_EVENT_TYPE.REPLACEMENT_ASSIGNED,
    label: "Replacement cover",
  },
  {
    value: WORKER_SCHEDULE_EVENT_TYPE.ON_CALL_ASSIGNED,
    label: "On-call cover",
  },
];

export type PlannerShiftPresetView = {
  id: number;
  key: string;
  startTime: string;
  endTime: string;
  timeWindowLabel: string;
  shortLabel: string;
};

export function scheduleEventLabel(value: string) {
  if (value === WORKER_SCHEDULE_EVENT_TYPE.MANAGER_NOTE_ADDED) return "Manager note";
  if (value === WORKER_SCHEDULE_EVENT_TYPE.REPLACEMENT_ASSIGNED) return "Replacement cover";
  if (value === WORKER_SCHEDULE_EVENT_TYPE.ON_CALL_ASSIGNED) return "On-call cover";
  return value;
}

export function humanizeEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatPlannerRoleLabel(value: string | null) {
  if (!value || value === "UNASSIGNED") return "Any role";
  return humanizeEnumLabel(value);
}

export function parseOptionalInt(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function toDateOnly(value: Date | string) {
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

export function formatDateInput(value: Date | string) {
  const date = toDateOnly(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(value: Date | string) {
  const date = toDateOnly(value);
  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

export function formatBoardDayLabel(value: Date | string) {
  const date = toDateOnly(value);
  return date.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
}

export function formatDateTimeLabel(value: Date | string) {
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatTimeValue(value: Date | string) {
  const date = new Date(value);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function minuteToTimeValue(minute: number) {
  const hour = String(Math.floor(minute / 60)).padStart(2, "0");
  const remainder = String(minute % 60).padStart(2, "0");
  return `${hour}:${remainder}`;
}

export function formatTimeDisplay(value: Date | string) {
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

export function formatHalfHourOptionLabel(value: string) {
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

export function formatPresetCompactCode(startTime: string, endTime: string) {
  return `${formatCompactTimeCodePart(startTime)}-${formatCompactTimeCodePart(endTime)}`;
}

export const HALF_HOUR_TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const totalMinutes = index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return {
    value,
    label: formatHalfHourOptionLabel(value),
  };
});

export function buildCustomTimeOptions(currentValue: string | null) {
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

export function buildShiftPresetView(preset: {
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

export function formatTimeWindow(startAt: Date | string, endAt: Date | string) {
  return `${formatTimeDisplay(startAt)} - ${formatTimeDisplay(endAt)}`;
}

export function findBoardShiftPreset(
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

export function isOffSchedule(
  schedule:
    | {
        entryType: string;
      }
    | null
    | undefined,
) {
  return schedule?.entryType === WORKER_SCHEDULE_ENTRY_TYPE.OFF;
}

export function isWorkSchedule(
  schedule:
    | {
        entryType: string;
      }
    | null
    | undefined,
) {
  return schedule?.entryType === WORKER_SCHEDULE_ENTRY_TYPE.WORK;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfNextWeek(reference: Date) {
  const current = toDateOnly(reference);
  const day = current.getDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  return addDays(current, daysUntilMonday);
}

export function endOfWeek(start: Date) {
  return addDays(start, 6);
}

export function startOfWeek(reference: Date | string) {
  const current = toDateOnly(reference);
  const day = current.getDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDays(current, -daysSinceMonday);
}

export function startOfNextMonth(reference: Date) {
  return new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
}

export function endOfMonth(reference: Date) {
  return new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
}

export function enumerateDatesInclusive(start: Date, end: Date) {
  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function resolvePlannerRange(url: URL) {
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

export function buildPlannerRedirect(args: {
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

export function isPatternApplyWindowValue(value: string): value is PatternApplyWindow {
  return PATTERN_APPLY_WINDOW_OPTIONS.some((option) => option.value === value);
}

export function resolvePatternApplyRange(reference: Date | string, window: PatternApplyWindow) {
  const anchor = toDateOnly(reference);

  if (window === "this-week") {
    const weekStart = startOfWeek(anchor);
    return {
      rangeStart: anchor,
      rangeEnd: endOfWeek(weekStart),
      label: "remaining matching days this week",
    };
  }

  const nextWeekStart = startOfNextWeek(anchor);

  if (window === "next-week") {
    return {
      rangeStart: nextWeekStart,
      rangeEnd: endOfWeek(nextWeekStart),
      label: "next week",
    };
  }

  if (window === "next-two-weeks") {
    return {
      rangeStart: nextWeekStart,
      rangeEnd: addDays(nextWeekStart, 13),
      label: "the next 2 weeks",
    };
  }

  return {
    rangeStart: nextWeekStart,
    rangeEnd: addDays(nextWeekStart, 27),
    label: "the next 4 weeks",
  };
}

export function patternMatchesWorkerRole(patternRole: string | null, workerRole: string) {
  return patternRole == null || patternRole === workerRole;
}

export function patternMatchesDateKey(
  pattern: { days: Array<{ dayOfWeek: string }> },
  dateKey: string,
) {
  const dateDayIndex = toDateOnly(dateKey).getDay();
  return pattern.days.some((day) => TEMPLATE_DAY_INDEX[day.dayOfWeek] === dateDayIndex);
}

export function summarizePatternNames(patterns: Array<{ templateName: string }>) {
  if (patterns.length === 0) return null;
  if (patterns.length === 1) return patterns[0].templateName;
  if (patterns.length === 2) {
    return `${patterns[0].templateName} · ${patterns[1].templateName}`;
  }
  return `${patterns[0].templateName} · ${patterns[1].templateName} +${patterns.length - 2}`;
}

export function buildWorkerLabel(worker: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  const fullName = `${worker.firstName} ${worker.lastName}`.trim();
  return `${fullName}${worker.alias ? ` (${worker.alias})` : ""}`;
}

export function buildCellKey(workerId: number, dateKey: string) {
  return `${workerId}:${dateKey}`;
}

export function statusTone(status: string) {
  if (status === "PUBLISHED") return "success" as const;
  if (status === "DRAFT") return "warning" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "info" as const;
}

export function plannerSavedMessage(saved: string | null) {
  if (saved === "generated") {
    return "Draft rows generated from active staffing pattern links.";
  }
  if (saved === "pattern-applied") {
    return "Named staffing pattern applied. Matching open days in that window were added as draft rows.";
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
  if (saved === "worker-drafts-cleared") {
    return "Draft rows in this worker window were cleared. Published rows stayed unchanged.";
  }
  if (saved === "worker-drafts-already-clear") {
    return "This worker already has no draft rows in the visible window.";
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

export function isWorkerScheduleEventTypeValue(
  value: string,
): value is WorkerScheduleEventTypeValue {
  return WORKER_SCHEDULE_EVENT_TYPE_VALUES.includes(value as WorkerScheduleEventTypeValue);
}

export function actorLabel(actor: {
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
