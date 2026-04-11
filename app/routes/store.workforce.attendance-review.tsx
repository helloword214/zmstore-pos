import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigate } from "@remix-run/react";
import { useEffect, useState } from "react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import { SelectInput } from "~/components/ui/SelectInput";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  listWorkerAttendanceDutyResultsForDate,
  recordWorkerAttendanceDutyResult,
} from "~/services/worker-attendance-duty-result.server";
import {
  appendWorkerScheduleEvent,
  listWorkerScheduleEventsForSchedules,
} from "~/services/worker-schedule-event.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

type PlannedDutyStateValue = "WORK" | "OFF" | "BLANK";
type PlannerCoverageHint = {
  workContext: AttendanceWorkContextValue;
  coveringForLabel: string;
  eventLabel: string;
  note: string | null;
};

const ATTENDANCE_DAY_TYPE = {
  WORK_DAY: "WORK_DAY",
  REST_DAY: "REST_DAY",
  REGULAR_HOLIDAY: "REGULAR_HOLIDAY",
  SPECIAL_HOLIDAY: "SPECIAL_HOLIDAY",
} as const;

type AttendanceDayTypeValue =
  (typeof ATTENDANCE_DAY_TYPE)[keyof typeof ATTENDANCE_DAY_TYPE];

const ATTENDANCE_DAY_TYPE_VALUES = [
  ATTENDANCE_DAY_TYPE.WORK_DAY,
  ATTENDANCE_DAY_TYPE.REST_DAY,
  ATTENDANCE_DAY_TYPE.REGULAR_HOLIDAY,
  ATTENDANCE_DAY_TYPE.SPECIAL_HOLIDAY,
] as const;

const ATTENDANCE_LATE_FLAG = {
  NO: "NO",
  YES: "YES",
} as const;

type AttendanceLateFlagValue =
  (typeof ATTENDANCE_LATE_FLAG)[keyof typeof ATTENDANCE_LATE_FLAG];

const ATTENDANCE_LEAVE_TYPE = {
  SICK_LEAVE: "SICK_LEAVE",
} as const;

type AttendanceLeaveTypeValue =
  (typeof ATTENDANCE_LEAVE_TYPE)[keyof typeof ATTENDANCE_LEAVE_TYPE];

const ATTENDANCE_RESULT = {
  WHOLE_DAY: "WHOLE_DAY",
  HALF_DAY: "HALF_DAY",
  ABSENT: "ABSENT",
  LEAVE: "LEAVE",
  NOT_REQUIRED: "NOT_REQUIRED",
  SUSPENDED_NO_WORK: "SUSPENDED_NO_WORK",
} as const;

type AttendanceResultValue =
  (typeof ATTENDANCE_RESULT)[keyof typeof ATTENDANCE_RESULT];

const ATTENDANCE_RESULT_VALUES = [
  ATTENDANCE_RESULT.WHOLE_DAY,
  ATTENDANCE_RESULT.HALF_DAY,
  ATTENDANCE_RESULT.ABSENT,
  ATTENDANCE_RESULT.LEAVE,
  ATTENDANCE_RESULT.NOT_REQUIRED,
  ATTENDANCE_RESULT.SUSPENDED_NO_WORK,
] as const;

const ATTENDANCE_WORK_CONTEXT = {
  REGULAR: "REGULAR",
  REPLACEMENT: "REPLACEMENT",
  ON_CALL: "ON_CALL",
} as const;

type AttendanceWorkContextValue =
  (typeof ATTENDANCE_WORK_CONTEXT)[keyof typeof ATTENDANCE_WORK_CONTEXT];

const ATTENDANCE_WORK_CONTEXT_VALUES = [
  ATTENDANCE_WORK_CONTEXT.REGULAR,
  ATTENDANCE_WORK_CONTEXT.REPLACEMENT,
  ATTENDANCE_WORK_CONTEXT.ON_CALL,
] as const;

const WORKER_SCHEDULE_EVENT_TYPE = {
  MARKED_ABSENT: "MARKED_ABSENT",
  EMERGENCY_LEAVE_RECORDED: "EMERGENCY_LEAVE_RECORDED",
  REPLACEMENT_ASSIGNED: "REPLACEMENT_ASSIGNED",
  ON_CALL_ASSIGNED: "ON_CALL_ASSIGNED",
} as const;

const WORKER_SCHEDULE_ENTRY_TYPE = {
  WORK: "WORK",
  OFF: "OFF",
} as const;

const DAY_TYPE_OPTIONS = [
  { value: ATTENDANCE_DAY_TYPE.WORK_DAY, label: "Work day" },
  { value: ATTENDANCE_DAY_TYPE.REST_DAY, label: "Rest day" },
  { value: ATTENDANCE_DAY_TYPE.REGULAR_HOLIDAY, label: "Regular holiday" },
  { value: ATTENDANCE_DAY_TYPE.SPECIAL_HOLIDAY, label: "Special holiday" },
];

const ATTENDANCE_RESULT_OPTIONS = [
  { value: ATTENDANCE_RESULT.WHOLE_DAY, label: "Whole day" },
  { value: ATTENDANCE_RESULT.HALF_DAY, label: "Half day" },
  { value: ATTENDANCE_RESULT.ABSENT, label: "Absent" },
  { value: ATTENDANCE_RESULT.LEAVE, label: "Leave" },
  { value: ATTENDANCE_RESULT.NOT_REQUIRED, label: "Not required" },
  {
    value: ATTENDANCE_RESULT.SUSPENDED_NO_WORK,
    label: "Suspended no work",
  },
];

const WORK_CONTEXT_OPTIONS = [
  { value: ATTENDANCE_WORK_CONTEXT.REGULAR, label: "Regular" },
  { value: ATTENDANCE_WORK_CONTEXT.REPLACEMENT, label: "Replacement" },
  { value: ATTENDANCE_WORK_CONTEXT.ON_CALL, label: "On-call" },
];

const LATE_FLAG_OPTIONS = [
  { value: ATTENDANCE_LATE_FLAG.NO, label: "No" },
  { value: ATTENDANCE_LATE_FLAG.YES, label: "Yes" },
];

function optionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string | null | undefined,
  fallback = "—",
) {
  if (!value) return fallback;
  return options.find((option) => option.value === value)?.label ?? fallback;
}

function laneLabel(value: string | null | undefined) {
  if (value === "STORE_MANAGER") return "Store manager";
  if (value === "CASHIER") return "Cashier";
  if (value === "EMPLOYEE") return "Staff";
  if (value === "ADMIN") return "Admin";
  return "Team member";
}

function parseOptionalInt(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const DATE_ONLY_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_ONLY_SAFE_HOUR = 12;

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
  return toDateOnly(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatTimeWindow(startAt: Date | string, endAt: Date | string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")} - ${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
}

function buildWorkerLabel(worker: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  return `${worker.firstName} ${worker.lastName}`.trim() +
    (worker.alias ? ` (${worker.alias})` : "");
}

function statusTone(status: string) {
  if (
    status === ATTENDANCE_RESULT.WHOLE_DAY ||
    status === ATTENDANCE_RESULT.HALF_DAY
  ) {
    return "success" as const;
  }
  if (status === ATTENDANCE_RESULT.NOT_REQUIRED) return "info" as const;
  if (status === ATTENDANCE_RESULT.LEAVE) return "warning" as const;
  return "danger" as const;
}

function plannerCoverageEventLabel(workContext: AttendanceWorkContextValue) {
  if (workContext === ATTENDANCE_WORK_CONTEXT.REPLACEMENT) {
    return "Replacement cover";
  }
  if (workContext === ATTENDANCE_WORK_CONTEXT.ON_CALL) {
    return "On-call cover";
  }
  return "Coverage";
}

function plannedDutySummary(
  schedule:
    | {
        entryType: string;
        startAt?: Date | string;
        endAt?: Date | string;
      }
    | null
    | undefined,
) {
  if (isOffSchedule(schedule)) {
    return {
      label: "Off day",
      tone: "warning" as const,
      detail: "Intentional day off in planner",
    };
  }

  if (isWorkSchedule(schedule) && schedule?.startAt && schedule?.endAt) {
    return {
      label: "Regular duty",
      tone: "info" as const,
      detail: formatTimeWindow(schedule.startAt, schedule.endAt),
    };
  }

  return {
    label: "No schedule",
    tone: "neutral" as const,
    detail: "No planner row for this date",
  };
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

function getPlannedDutyState(
  schedule:
    | {
        entryType: string;
      }
    | null
    | undefined,
): PlannedDutyStateValue {
  if (isWorkSchedule(schedule)) return "WORK";
  if (isOffSchedule(schedule)) return "OFF";
  return "BLANK";
}

function isWorkedAttendanceResult(result: string | null | undefined) {
  return (
    result === ATTENDANCE_RESULT.WHOLE_DAY ||
    result === ATTENDANCE_RESULT.HALF_DAY
  );
}

function deriveDefaultWorkContext(
  plannedDutyState: PlannedDutyStateValue,
  attendanceResult: AttendanceResultValue,
  plannerCoverageWorkContext?: AttendanceWorkContextValue | null,
) {
  if (!isWorkedAttendanceResult(attendanceResult)) {
    return ATTENDANCE_WORK_CONTEXT.REGULAR;
  }

  if (plannerCoverageWorkContext) {
    return plannerCoverageWorkContext;
  }

  if (plannedDutyState === "OFF") {
    return ATTENDANCE_WORK_CONTEXT.REPLACEMENT;
  }

  if (plannedDutyState === "BLANK") {
    return ATTENDANCE_WORK_CONTEXT.ON_CALL;
  }

  return ATTENDANCE_WORK_CONTEXT.REGULAR;
}

function workContextSummaryHint(
  plannedDutyState: PlannedDutyStateValue,
  plannerCoverage: PlannerCoverageHint | null | undefined,
  manualOverride: boolean,
) {
  if (manualOverride) {
    return "Manual override";
  }

  if (plannerCoverage) {
    return `${plannerCoverage.eventLabel} from planner`;
  }

  if (plannedDutyState === "OFF") {
    return "Auto-detected from off day";
  }

  if (plannedDutyState === "BLANK") {
    return "Auto-detected from no schedule";
  }

  return "Auto-detected from regular duty";
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);
  const url = new URL(request.url);
  const dutyDate = formatDateInput(url.searchParams.get("date") || new Date());
  const selectedWorkerId = parseOptionalInt(url.searchParams.get("workerId"));
  const saved = url.searchParams.get("saved");

  const [workers, schedules, attendanceRows, activeSuspensions] = await Promise.all([
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
    db.workerSchedule.findMany({
      where: {
        scheduleDate: toDateOnly(dutyDate),
        status: { not: "CANCELLED" },
      },
      orderBy: [{ startAt: "asc" }, { worker: { lastName: "asc" } }],
    }),
    listWorkerAttendanceDutyResultsForDate(dutyDate),
    db.suspensionRecord.findMany({
      where: {
        status: "ACTIVE",
        startDate: { lte: toDateOnly(dutyDate) },
        endDate: { gte: toDateOnly(dutyDate) },
      },
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
    }),
  ]);
  const scheduleEvents = await listWorkerScheduleEventsForSchedules(
    schedules.map((schedule) => schedule.id),
  );

  const scheduleByWorkerId = new Map(schedules.map((schedule) => [schedule.workerId, schedule]));
  const attendanceByWorkerId = new Map(
    attendanceRows.map((row) => [row.workerId, row]),
  );
  const suspensionByWorkerId = new Map(
    activeSuspensions.map((record) => [record.workerId, record]),
  );
  const plannerCoverageByWorkerId = new Map<number, PlannerCoverageHint>();

  for (const event of scheduleEvents) {
    if (!event.relatedWorkerId || plannerCoverageByWorkerId.has(event.relatedWorkerId)) {
      continue;
    }

    if (event.eventType === WORKER_SCHEDULE_EVENT_TYPE.REPLACEMENT_ASSIGNED) {
      plannerCoverageByWorkerId.set(event.relatedWorkerId, {
        workContext: ATTENDANCE_WORK_CONTEXT.REPLACEMENT,
        coveringForLabel: event.subjectWorker
          ? buildWorkerLabel(event.subjectWorker)
          : "scheduled worker",
        eventLabel: "Replacement cover",
        note: event.note ?? null,
      });
    }

    if (event.eventType === WORKER_SCHEDULE_EVENT_TYPE.ON_CALL_ASSIGNED) {
      plannerCoverageByWorkerId.set(event.relatedWorkerId, {
        workContext: ATTENDANCE_WORK_CONTEXT.ON_CALL,
        coveringForLabel: event.subjectWorker
          ? buildWorkerLabel(event.subjectWorker)
          : "scheduled worker",
        eventLabel: "On-call cover",
        note: event.note ?? null,
      });
    }
  }

  const rows = workers
    .map((worker) => ({
      id: worker.id,
      label: buildWorkerLabel(worker),
      lane: worker.user?.role ?? "UNASSIGNED",
      schedule: scheduleByWorkerId.get(worker.id) ?? null,
      attendance: attendanceByWorkerId.get(worker.id) ?? null,
      suspension: suspensionByWorkerId.get(worker.id) ?? null,
      plannerCoverage: plannerCoverageByWorkerId.get(worker.id) ?? null,
    }))
    .sort((left, right) => {
      const leftRank = isWorkSchedule(left.schedule)
        ? 0
        : isOffSchedule(left.schedule)
          ? 1
          : 2;
      const rightRank = isWorkSchedule(right.schedule)
        ? 0
        : isOffSchedule(right.schedule)
          ? 1
          : 2;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.label.localeCompare(right.label);
    });

  const selectedRow =
    selectedWorkerId
      ? rows.find((row) => row.id === selectedWorkerId) ?? null
      : null;

  return json({
    rows,
    selectedRow,
    dutyDate,
    saved,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");

  try {
    if (intent !== "record-attendance") {
      return json<ActionData>(
        { ok: false, error: "Unsupported action.", action: intent },
        { status: 400 },
      );
    }

    const workerId = parseOptionalInt(String(fd.get("workerId") || ""));
    const scheduleId = parseOptionalInt(String(fd.get("scheduleId") || ""));
    const dutyDate = String(fd.get("dutyDate") || "");
    const dayType = String(fd.get("dayType") || "");
    const attendanceResult = String(fd.get("attendanceResult") || "");
    const workContext = String(fd.get("workContext") || "");
    const plannedDutyState = String(fd.get("plannedDutyState") || "");
    const leaveTypeRaw = String(fd.get("leaveType") || "");
    const lateFlag = String(fd.get("lateFlag") || "");
    const note = String(fd.get("note") || "");

    if (!workerId) throw new Error("Worker is required.");
    if (!ATTENDANCE_DAY_TYPE_VALUES.includes(dayType as AttendanceDayTypeValue)) {
      throw new Error("Invalid day type.");
    }
    if (!ATTENDANCE_RESULT_VALUES.includes(attendanceResult as AttendanceResultValue)) {
      throw new Error("Invalid attendance result.");
    }
    if (
      !ATTENDANCE_WORK_CONTEXT_VALUES.includes(workContext as AttendanceWorkContextValue)
    ) {
      throw new Error("Invalid work context.");
    }
    if (
      plannedDutyState !== "WORK" &&
      plannedDutyState !== "OFF" &&
      plannedDutyState !== "BLANK"
    ) {
      throw new Error("Invalid planned duty state.");
    }
    if (
      lateFlag !== ATTENDANCE_LATE_FLAG.NO &&
      lateFlag !== ATTENDANCE_LATE_FLAG.YES
    ) {
      throw new Error("Invalid late flag.");
    }

    await recordWorkerAttendanceDutyResult({
      workerId,
      scheduleId,
      dutyDate,
      dayType: dayType as AttendanceDayTypeValue,
      attendanceResult: attendanceResult as AttendanceResultValue,
      plannedDutyState: plannedDutyState as PlannedDutyStateValue,
      workContext: workContext as AttendanceWorkContextValue,
      leaveType:
        leaveTypeRaw === ATTENDANCE_LEAVE_TYPE.SICK_LEAVE
          ? (ATTENDANCE_LEAVE_TYPE.SICK_LEAVE as AttendanceLeaveTypeValue)
          : null,
      lateFlag: lateFlag as AttendanceLateFlagValue,
      note,
      recordedById: me.userId,
    });

    if (scheduleId) {
      if (attendanceResult === ATTENDANCE_RESULT.ABSENT) {
        await appendWorkerScheduleEvent({
          scheduleId,
          eventType: WORKER_SCHEDULE_EVENT_TYPE.MARKED_ABSENT,
          actorUserId: me.userId,
          subjectWorkerId: workerId,
          note: note || "Attendance review marked this worker absent.",
        });
      }

      if (attendanceResult === ATTENDANCE_RESULT.LEAVE) {
        await appendWorkerScheduleEvent({
          scheduleId,
          eventType: WORKER_SCHEDULE_EVENT_TYPE.EMERGENCY_LEAVE_RECORDED,
          actorUserId: me.userId,
          subjectWorkerId: workerId,
          note:
            note ||
            `Attendance review recorded ${leaveTypeRaw || "leave"} for this worker.`,
        });
      }
    }

    return redirect(
      `/store/workforce/attendance-review?date=${encodeURIComponent(
        dutyDate,
      )}&saved=attendance`,
    );
  } catch (error) {
    return json<ActionData>(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to save attendance.",
        action: intent,
      },
      { status: 400 },
    );
  }
}

export default function WorkforceAttendanceReviewRoute() {
  const { rows, selectedRow, dutyDate, saved } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigate = useNavigate();
  const selectedPlannedDutyState = getPlannedDutyState(selectedRow?.schedule);
  const attendanceReviewBaseHref =
    `/store/workforce/attendance-review?date=${encodeURIComponent(dutyDate)}`;

  const defaultDayType =
    selectedRow?.attendance?.dayType ??
    (selectedRow?.schedule && isWorkSchedule(selectedRow.schedule)
      ? ATTENDANCE_DAY_TYPE.WORK_DAY
      : ATTENDANCE_DAY_TYPE.REST_DAY);
  const baselineDayType =
    selectedRow?.schedule && isWorkSchedule(selectedRow.schedule)
      ? ATTENDANCE_DAY_TYPE.WORK_DAY
      : ATTENDANCE_DAY_TYPE.REST_DAY;
  const defaultAttendanceResult =
    selectedRow?.attendance?.attendanceResult ??
    (selectedRow?.suspension && selectedRow?.schedule && isWorkSchedule(selectedRow.schedule)
      ? ATTENDANCE_RESULT.SUSPENDED_NO_WORK
      : selectedRow?.schedule && isWorkSchedule(selectedRow.schedule)
        ? ATTENDANCE_RESULT.WHOLE_DAY
        : ATTENDANCE_RESULT.NOT_REQUIRED);
  const defaultSuggestedWorkContext = deriveDefaultWorkContext(
    selectedPlannedDutyState,
    defaultAttendanceResult,
    selectedRow?.plannerCoverage?.workContext ?? null,
  );
  const hasSavedWorkContextOverride = Boolean(
    selectedRow?.attendance?.workContext &&
      selectedRow.attendance.workContext !== defaultSuggestedWorkContext,
  );
  const defaultWorkContext =
    selectedRow?.attendance?.workContext ?? defaultSuggestedWorkContext;
  const defaultLeaveType = selectedRow?.attendance?.leaveType ?? "";
  const defaultLateFlag = selectedRow?.attendance?.lateFlag ?? ATTENDANCE_LATE_FLAG.NO;
  const selectedPlannedSummary = plannedDutySummary(selectedRow?.schedule);
  const [dayTypeValue, setDayTypeValue] =
    useState<AttendanceDayTypeValue>(defaultDayType);
  const [attendanceResultValue, setAttendanceResultValue] =
    useState<AttendanceResultValue>(defaultAttendanceResult);
  const [workContextValue, setWorkContextValue] =
    useState<AttendanceWorkContextValue>(defaultWorkContext);
  const [leaveTypeValue, setLeaveTypeValue] = useState<
    AttendanceLeaveTypeValue | ""
  >(defaultLeaveType as AttendanceLeaveTypeValue | "");
  const [lateFlagValue, setLateFlagValue] =
    useState<AttendanceLateFlagValue>(defaultLateFlag);
  const [workContextDirty, setWorkContextDirty] = useState(
    hasSavedWorkContextOverride,
  );
  const [showWorkContextOverride, setShowWorkContextOverride] = useState(
    hasSavedWorkContextOverride,
  );
  const [showDetails, setShowDetails] = useState(
    Boolean(
      selectedRow?.attendance?.note?.trim() ||
        defaultDayType !== baselineDayType,
    ),
  );
  const workedAttendance = isWorkedAttendanceResult(attendanceResultValue);
  const leaveAttendance = attendanceResultValue === ATTENDANCE_RESULT.LEAVE;
  const suggestedWorkContext = deriveDefaultWorkContext(
    selectedPlannedDutyState,
    attendanceResultValue,
    selectedRow?.plannerCoverage?.workContext ?? null,
  );
  const effectiveWorkContext = workedAttendance
    ? workContextDirty
      ? workContextValue
      : suggestedWorkContext
    : ATTENDANCE_WORK_CONTEXT.REGULAR;

  useEffect(() => {
    setDayTypeValue(defaultDayType);
    setAttendanceResultValue(defaultAttendanceResult);
    setWorkContextValue(defaultWorkContext);
    setLeaveTypeValue(defaultLeaveType as AttendanceLeaveTypeValue | "");
    setLateFlagValue(defaultLateFlag);
    setWorkContextDirty(hasSavedWorkContextOverride);
    setShowWorkContextOverride(hasSavedWorkContextOverride);
    setShowDetails(
      Boolean(
        selectedRow?.attendance?.note?.trim() ||
          defaultDayType !== baselineDayType,
      ),
    );
  }, [
    baselineDayType,
    defaultDayType,
    defaultAttendanceResult,
    defaultWorkContext,
    defaultLeaveType,
    defaultLateFlag,
    hasSavedWorkContextOverride,
    selectedRow?.id,
  ]);

  useEffect(() => {
    if (workContextDirty) return;
    setWorkContextValue(suggestedWorkContext);
  }, [
    suggestedWorkContext,
    workContextDirty,
  ]);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Workforce Attendance Review"
        subtitle="Check the duty list and record the day."
        backTo="/store"
        backLabel="Manager Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {saved === "attendance" ? (
          <SoTAlert tone="success">Attendance record saved.</SoTAlert>
        ) : null}
        {actionData && !actionData.ok && !selectedRow ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <SoTCard interaction="form" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Attendance date</h2>
            <span className="text-xs text-slate-500">{formatDateLabel(dutyDate)}</span>
          </div>

          <Form method="get" className="grid gap-3 md:grid-cols-[1fr,auto]">
            <SoTFormField label="Date">
              <SoTInput type="date" name="date" defaultValue={dutyDate} required />
            </SoTFormField>
            {selectedRow ? <input type="hidden" name="workerId" value={selectedRow.id} /> : null}
            <div className="flex items-end">
              <SoTButton type="submit" variant="primary" size="compact">
                Load
              </SoTButton>
            </div>
          </Form>
        </SoTCard>

        <SoTCard className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Attendance board</h2>
            <p className="text-xs text-slate-500">
              Planned duty and recorded attendance stay on one row. Open a worker only when you need to record or adjust the day.
            </p>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              No active workers found.
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => {
                const selected = selectedRow?.id === row.id;
                const plannedSummary = plannedDutySummary(row.schedule);
                const actualLabel = row.attendance
                  ? optionLabel(
                      ATTENDANCE_RESULT_OPTIONS,
                      row.attendance.attendanceResult,
                      row.attendance.attendanceResult,
                    )
                  : "Pending";
                const actualTone = row.attendance
                  ? statusTone(row.attendance.attendanceResult)
                  : "neutral";
                const actualDetail = row.attendance
                  ? [
                      optionLabel(
                        DAY_TYPE_OPTIONS,
                        row.attendance.dayType,
                        row.attendance.dayType,
                      ),
                      optionLabel(
                        WORK_CONTEXT_OPTIONS,
                        row.attendance.workContext,
                        row.attendance.workContext,
                      ),
                    ].join(" · ")
                  : row.plannerCoverage
                    ? `${row.plannerCoverage.eventLabel} for ${row.plannerCoverage.coveringForLabel}`
                    : "Not recorded yet";

                return (
                  <Link
                    key={row.id}
                    to={`${attendanceReviewBaseHref}&workerId=${row.id}`}
                    preventScrollReset
                    className={`block rounded-2xl border px-4 py-3 transition-colors duration-150 ${
                      selected
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`font-medium ${
                                selected ? "text-indigo-700" : "text-slate-900"
                              }`}
                            >
                              {row.label}
                            </span>
                            <SoTStatusBadge tone="neutral">
                              {laneLabel(row.lane)}
                            </SoTStatusBadge>
                            {selected ? (
                              <SoTStatusBadge tone="info">Open</SoTStatusBadge>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {row.suspension ? (
                            <SoTStatusBadge tone="warning">Suspended</SoTStatusBadge>
                          ) : null}
                          {row.attendance?.lateFlag === ATTENDANCE_LATE_FLAG.YES ? (
                            <SoTStatusBadge tone="warning">Late</SoTStatusBadge>
                          ) : null}
                          {(row.attendance?.workContext &&
                            row.attendance.workContext !== ATTENDANCE_WORK_CONTEXT.REGULAR) ||
                          (!row.attendance && row.plannerCoverage) ? (
                            <SoTStatusBadge tone="info">
                              {optionLabel(
                                WORK_CONTEXT_OPTIONS,
                                row.attendance?.workContext ??
                                  row.plannerCoverage?.workContext,
                                row.attendance?.workContext ??
                                  row.plannerCoverage?.workContext,
                              )}
                            </SoTStatusBadge>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Planned
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <SoTStatusBadge tone={plannedSummary.tone}>
                              {plannedSummary.label}
                            </SoTStatusBadge>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {plannedSummary.detail}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Recorded
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <SoTStatusBadge tone={actualTone}>{actualLabel}</SoTStatusBadge>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{actualDetail}</div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </SoTCard>

        {selectedRow ? (
          <div
            className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/55 px-4 py-6 backdrop-blur-md sm:py-10"
            onClick={() => navigate(attendanceReviewBaseHref)}
          >
            <div
              className="mx-auto w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Record attendance</h2>
                  <p className="text-sm text-slate-500">
                    {selectedRow.label} · {laneLabel(selectedRow.lane)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedRow.attendance ? (
                    <SoTStatusBadge tone={statusTone(selectedRow.attendance.attendanceResult)}>
                      {optionLabel(
                        ATTENDANCE_RESULT_OPTIONS,
                        selectedRow.attendance.attendanceResult,
                        selectedRow.attendance.attendanceResult,
                      )}
                    </SoTStatusBadge>
                  ) : (
                    <SoTStatusBadge tone="neutral">Pending</SoTStatusBadge>
                  )}
                  <SoTButton
                    type="button"
                    variant="secondary"
                    size="compact"
                    onClick={() => navigate(attendanceReviewBaseHref)}
                  >
                    Close
                  </SoTButton>
                </div>
              </div>

              <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SoTStatusBadge tone={selectedPlannedSummary.tone}>
                    {selectedPlannedSummary.label}
                  </SoTStatusBadge>
                  <span className="text-sm text-slate-600">
                    {selectedPlannedSummary.detail}
                  </span>
                  {selectedRow.suspension ? (
                    <SoTStatusBadge tone="warning">Suspended</SoTStatusBadge>
                  ) : null}
                </div>
                {selectedRow.plannerCoverage ? (
                  <div className="mt-2 text-sm text-slate-600">
                    {`${plannerCoverageEventLabel(
                      selectedRow.plannerCoverage.workContext,
                    )} for ${selectedRow.plannerCoverage.coveringForLabel}`}
                    {selectedRow.plannerCoverage.note
                      ? ` · ${selectedRow.plannerCoverage.note}`
                      : ""}
                  </div>
                ) : selectedRow.suspension ? (
                  <div className="mt-2 text-sm text-slate-600">
                    {`${formatDateLabel(
                      selectedRow.suspension.startDate,
                    )} -> ${formatDateLabel(selectedRow.suspension.endDate)}`}
                  </div>
                ) : null}
              </div>

              {actionData && !actionData.ok ? (
                <div className="mb-4">
                  <SoTAlert tone="warning">{actionData.error}</SoTAlert>
                </div>
              ) : null}

              <Form method="post" className="space-y-4">
                <input type="hidden" name="_intent" value="record-attendance" />
                <input type="hidden" name="workerId" value={selectedRow.id} />
                <input
                  type="hidden"
                  name="scheduleId"
                  value={selectedRow.schedule?.id ?? ""}
                />
                <input
                  type="hidden"
                  name="plannedDutyState"
                  value={selectedPlannedDutyState}
                />
                <input type="hidden" name="dutyDate" value={dutyDate} />
                <input type="hidden" name="dayType" value={dayTypeValue} />
                <input
                  type="hidden"
                  name="attendanceResult"
                  value={attendanceResultValue}
                />
                <input
                  type="hidden"
                  name="workContext"
                  value={effectiveWorkContext}
                />
                <input
                  type="hidden"
                  name="lateFlag"
                  value={
                    workedAttendance ? lateFlagValue : ATTENDANCE_LATE_FLAG.NO
                  }
                />
                {leaveAttendance ? (
                  <input type="hidden" name="leaveType" value={leaveTypeValue} />
                ) : null}

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Attendance result
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {ATTENDANCE_RESULT_OPTIONS.map((option) => {
                      const selected = attendanceResultValue === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            setAttendanceResultValue(
                              option.value as AttendanceResultValue,
                            )
                          }
                          className={`rounded-2xl border px-3 py-3 text-left text-sm font-medium transition-colors ${
                            selected
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {workedAttendance ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Work details
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-slate-600">Context</span>
                          <SoTStatusBadge tone="info">
                            {optionLabel(
                              WORK_CONTEXT_OPTIONS,
                              effectiveWorkContext,
                              effectiveWorkContext,
                            )}
                          </SoTStatusBadge>
                          <span className="text-xs text-slate-500">
                            {workContextSummaryHint(
                              selectedPlannedDutyState,
                              selectedRow?.plannerCoverage,
                              workContextDirty,
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-slate-600">Late</span>
                        {LATE_FLAG_OPTIONS.map((option) => {
                          const selected = lateFlagValue === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() =>
                                setLateFlagValue(
                                  option.value as AttendanceLateFlagValue,
                                )
                              }
                              className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                                selected
                                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                        {!showWorkContextOverride ? (
                          <button
                            type="button"
                            className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
                            onClick={() => {
                              setWorkContextDirty(true);
                              setShowWorkContextOverride(true);
                            }}
                          >
                            Change context
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {showWorkContextOverride ? (
                      <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                        <SoTFormField label="Override context">
                          <SelectInput
                            value={workContextValue}
                            onChange={(value) => {
                              setWorkContextDirty(true);
                              setWorkContextValue(
                                value as AttendanceWorkContextValue,
                              );
                            }}
                            options={WORK_CONTEXT_OPTIONS}
                          />
                        </SoTFormField>

                        <div className="flex flex-wrap gap-2">
                          <SoTButton
                            type="button"
                            variant="secondary"
                            size="compact"
                            onClick={() => {
                              setWorkContextDirty(false);
                              setWorkContextValue(suggestedWorkContext);
                              setShowWorkContextOverride(false);
                            }}
                          >
                            Use detected context
                          </SoTButton>
                          <SoTButton
                            type="button"
                            variant="secondary"
                            size="compact"
                            onClick={() => setShowWorkContextOverride(false)}
                          >
                            Done
                          </SoTButton>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {leaveAttendance ? (
                  <SoTFormField label="Leave type">
                    <SelectInput
                      value={leaveTypeValue}
                      onChange={(value) =>
                        setLeaveTypeValue(value as AttendanceLeaveTypeValue | "")
                      }
                      options={[
                        { value: "", label: "None" },
                        { value: ATTENDANCE_LEAVE_TYPE.SICK_LEAVE, label: "Sick leave" },
                      ]}
                    />
                  </SoTFormField>
                ) : null}

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Details
                      </div>
                      <div className="text-xs text-slate-500">
                        Day type and manager note only when needed.
                      </div>
                    </div>
                    <SoTButton
                      type="button"
                      variant="secondary"
                      size="compact"
                      onClick={() => setShowDetails((current) => !current)}
                    >
                      {showDetails ? "Hide" : "Show"}
                    </SoTButton>
                  </div>

                  {showDetails ? (
                    <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3">
                      <SoTFormField label="Day type">
                        <SelectInput
                          value={dayTypeValue}
                          onChange={(value) =>
                            setDayTypeValue(value as AttendanceDayTypeValue)
                          }
                          options={DAY_TYPE_OPTIONS}
                        />
                      </SoTFormField>

                      <SoTFormField label="Manager note">
                        <SoTInput
                          name="note"
                          defaultValue={selectedRow.attendance?.note ?? ""}
                          placeholder="Optional note"
                        />
                      </SoTFormField>
                    </div>
                  ) : null}
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                  <SoTButton
                    type="button"
                    variant="secondary"
                    size="compact"
                    onClick={() => navigate(attendanceReviewBaseHref)}
                  >
                    Cancel
                  </SoTButton>
                  <SoTButton type="submit" variant="primary" size="compact">
                    Save attendance
                  </SoTButton>
                </div>
              </Form>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
