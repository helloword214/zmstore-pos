import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import {
  AttendanceDayType,
  AttendanceLateFlag,
  AttendanceLeaveType,
  AttendanceResult,
  AttendanceWorkContext,
  WorkerScheduleEventType,
} from "@prisma/client";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import {
  SoTTable,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
  SoTTh,
  SoTTd,
} from "~/components/ui/SoTTable";
import { SelectInput } from "~/components/ui/SelectInput";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  listWorkerAttendanceDutyResultsForDate,
  recordWorkerAttendanceDutyResult,
} from "~/services/worker-attendance-duty-result.server";
import { appendWorkerScheduleEvent } from "~/services/worker-schedule-event.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

const DAY_TYPE_OPTIONS = [
  { value: AttendanceDayType.WORK_DAY, label: "Work day" },
  { value: AttendanceDayType.REST_DAY, label: "Rest day" },
  { value: AttendanceDayType.REGULAR_HOLIDAY, label: "Regular holiday" },
  { value: AttendanceDayType.SPECIAL_HOLIDAY, label: "Special holiday" },
];

const ATTENDANCE_RESULT_OPTIONS = [
  { value: AttendanceResult.WHOLE_DAY, label: "Whole day" },
  { value: AttendanceResult.HALF_DAY, label: "Half day" },
  { value: AttendanceResult.ABSENT, label: "Absent" },
  { value: AttendanceResult.LEAVE, label: "Leave" },
  { value: AttendanceResult.NOT_REQUIRED, label: "Not required" },
  {
    value: AttendanceResult.SUSPENDED_NO_WORK,
    label: "Suspended no work",
  },
];

const WORK_CONTEXT_OPTIONS = [
  { value: AttendanceWorkContext.REGULAR, label: "Regular" },
  { value: AttendanceWorkContext.REPLACEMENT, label: "Replacement" },
  { value: AttendanceWorkContext.ON_CALL, label: "On-call" },
];

const LATE_FLAG_OPTIONS = [
  { value: AttendanceLateFlag.NO, label: "No" },
  { value: AttendanceLateFlag.YES, label: "Yes" },
];

function parseOptionalInt(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toDateOnly(value: Date | string) {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(0, 0, 0, 0);
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
    status === AttendanceResult.WHOLE_DAY ||
    status === AttendanceResult.HALF_DAY
  ) {
    return "success" as const;
  }
  if (status === AttendanceResult.NOT_REQUIRED) return "info" as const;
  if (status === AttendanceResult.LEAVE) return "warning" as const;
  return "danger" as const;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER", "ADMIN"]);
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

  const scheduleByWorkerId = new Map(schedules.map((schedule) => [schedule.workerId, schedule]));
  const attendanceByWorkerId = new Map(
    attendanceRows.map((row) => [row.workerId, row]),
  );
  const suspensionByWorkerId = new Map(
    activeSuspensions.map((record) => [record.workerId, record]),
  );

  const rows = workers
    .map((worker) => ({
      id: worker.id,
      label: buildWorkerLabel(worker),
      lane: worker.user?.role ?? "UNASSIGNED",
      schedule: scheduleByWorkerId.get(worker.id) ?? null,
      attendance: attendanceByWorkerId.get(worker.id) ?? null,
      suspension: suspensionByWorkerId.get(worker.id) ?? null,
    }))
    .sort((left, right) => {
      const leftRank = left.schedule ? 0 : 1;
      const rightRank = right.schedule ? 0 : 1;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.label.localeCompare(right.label);
    });

  const selectedRow =
    rows.find((row) => row.id === selectedWorkerId) ??
    rows[0] ??
    null;

  return json({
    rows,
    selectedRow,
    dutyDate,
    saved,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);
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
    const leaveTypeRaw = String(fd.get("leaveType") || "");
    const lateFlag = String(fd.get("lateFlag") || "");
    const note = String(fd.get("note") || "");

    if (!workerId) throw new Error("Worker is required.");
    if (
      dayType !== AttendanceDayType.WORK_DAY &&
      dayType !== AttendanceDayType.REST_DAY &&
      dayType !== AttendanceDayType.REGULAR_HOLIDAY &&
      dayType !== AttendanceDayType.SPECIAL_HOLIDAY
    ) {
      throw new Error("Invalid day type.");
    }
    if (!Object.values(AttendanceResult).includes(attendanceResult as AttendanceResult)) {
      throw new Error("Invalid attendance result.");
    }
    if (
      workContext !== AttendanceWorkContext.REGULAR &&
      workContext !== AttendanceWorkContext.REPLACEMENT &&
      workContext !== AttendanceWorkContext.ON_CALL
    ) {
      throw new Error("Invalid work context.");
    }
    if (lateFlag !== AttendanceLateFlag.NO && lateFlag !== AttendanceLateFlag.YES) {
      throw new Error("Invalid late flag.");
    }

    await recordWorkerAttendanceDutyResult({
      workerId,
      scheduleId,
      dutyDate,
      dayType: dayType as AttendanceDayType,
      attendanceResult: attendanceResult as AttendanceResult,
      workContext: workContext as AttendanceWorkContext,
      leaveType:
        leaveTypeRaw === AttendanceLeaveType.SICK_LEAVE
          ? AttendanceLeaveType.SICK_LEAVE
          : null,
      lateFlag: lateFlag as AttendanceLateFlag,
      note,
      recordedById: me.userId,
    });

    if (scheduleId) {
      if (attendanceResult === AttendanceResult.ABSENT) {
        await appendWorkerScheduleEvent({
          scheduleId,
          eventType: WorkerScheduleEventType.MARKED_ABSENT,
          actorUserId: me.userId,
          subjectWorkerId: workerId,
          note: note || "Attendance review marked this worker absent.",
        });
      }

      if (attendanceResult === AttendanceResult.LEAVE) {
        await appendWorkerScheduleEvent({
          scheduleId,
          eventType: WorkerScheduleEventType.EMERGENCY_LEAVE_RECORDED,
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
      )}&workerId=${workerId}&saved=attendance`,
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

  const defaultDayType = selectedRow?.attendance?.dayType ??
    (selectedRow?.schedule ? AttendanceDayType.WORK_DAY : AttendanceDayType.REST_DAY);
  const defaultAttendanceResult =
    selectedRow?.attendance?.attendanceResult ??
    (selectedRow?.suspension && selectedRow?.schedule
      ? AttendanceResult.SUSPENDED_NO_WORK
      : selectedRow?.schedule
        ? AttendanceResult.WHOLE_DAY
        : AttendanceResult.NOT_REQUIRED);
  const defaultWorkContext =
    selectedRow?.attendance?.workContext ?? AttendanceWorkContext.REGULAR;
  const defaultLeaveType = selectedRow?.attendance?.leaveType ?? "";
  const defaultLateFlag = selectedRow?.attendance?.lateFlag ?? AttendanceLateFlag.NO;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Workforce Attendance Review"
        subtitle="Record the factual attendance layer payroll will later consume: day type, duty result, work context, leave, and late flag."
        backTo="/store"
        backLabel="Manager Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {saved === "attendance" ? (
          <SoTAlert tone="success">Attendance record saved.</SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <SoTCard interaction="form" className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Review date</h2>
            <p className="text-xs text-slate-500">
              Current attendance review date: {formatDateLabel(dutyDate)}
            </p>
          </div>

          <Form method="get" className="grid gap-3 md:grid-cols-[1fr,auto]">
            <SoTFormField label="Duty date">
              <SoTInput type="date" name="date" defaultValue={dutyDate} required />
            </SoTFormField>
            {selectedRow ? <input type="hidden" name="workerId" value={selectedRow.id} /> : null}
            <div className="flex items-end">
              <SoTButton type="submit" variant="primary">
                Load date
              </SoTButton>
            </div>
          </Form>
        </SoTCard>

        <div className="grid gap-5 lg:grid-cols-12">
          <section className="lg:col-span-7">
            <SoTCard className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Worker list for the day
                </h2>
                <p className="text-xs text-slate-500">
                  Scheduled workers are listed first. Select one row to review the factual attendance inputs.
                </p>
              </div>

              <SoTTable>
                <SoTTableHead>
                  <SoTTableRow>
                    <SoTTh>Worker</SoTTh>
                    <SoTTh>Schedule</SoTTh>
                    <SoTTh>Attendance</SoTTh>
                    <SoTTh>Review</SoTTh>
                  </SoTTableRow>
                </SoTTableHead>
                <tbody>
                  {rows.length === 0 ? (
                    <SoTTableEmptyRow colSpan={4}>
                      No active workers found.
                    </SoTTableEmptyRow>
                  ) : (
                    rows.map((row) => (
                      <SoTTableRow key={row.id}>
                        <SoTTd>
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">{row.label}</div>
                            <div className="text-xs text-slate-500">{row.lane}</div>
                          </div>
                        </SoTTd>
                        <SoTTd>
                          {row.schedule ? (
                            <div className="space-y-1">
                              <SoTStatusBadge tone="info">Scheduled</SoTStatusBadge>
                              <div className="text-xs text-slate-500">
                                {formatTimeWindow(row.schedule.startAt, row.schedule.endAt)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-slate-500">No planned row</span>
                          )}
                          {row.suspension ? (
                            <div className="mt-1">
                              <SoTStatusBadge tone="warning">Suspended</SoTStatusBadge>
                            </div>
                          ) : null}
                        </SoTTd>
                        <SoTTd>
                          {row.attendance ? (
                            <div className="space-y-1">
                              <SoTStatusBadge tone={statusTone(row.attendance.attendanceResult)}>
                                {row.attendance.attendanceResult}
                              </SoTStatusBadge>
                              <div className="text-xs text-slate-500">
                                {row.attendance.dayType} · {row.attendance.workContext}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-slate-500">Not recorded yet</span>
                          )}
                        </SoTTd>
                        <SoTTd>
                          <Link
                            to={`/store/workforce/attendance-review?date=${encodeURIComponent(
                              dutyDate,
                            )}&workerId=${row.id}`}
                            className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {selectedRow?.id === row.id ? "Selected" : "Open"}
                          </Link>
                        </SoTTd>
                      </SoTTableRow>
                    ))
                  )}
                </tbody>
              </SoTTable>
            </SoTCard>
          </section>

          <aside className="space-y-5 lg:col-span-5">
            {selectedRow ? (
              <SoTCard interaction="form" className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Selected worker</h2>
                    <p className="text-xs text-slate-500">
                      {selectedRow.label} · {selectedRow.lane}
                    </p>
                  </div>
                  {selectedRow.attendance ? (
                    <SoTStatusBadge tone={statusTone(selectedRow.attendance.attendanceResult)}>
                      {selectedRow.attendance.attendanceResult}
                    </SoTStatusBadge>
                  ) : null}
                </div>

                <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <div>
                    Planned row:{" "}
                    {selectedRow.schedule
                      ? formatTimeWindow(
                          selectedRow.schedule.startAt,
                          selectedRow.schedule.endAt,
                        )
                      : "none"}
                  </div>
                  <div>
                    Active suspension:{" "}
                    {selectedRow.suspension
                      ? `${formatDateLabel(selectedRow.suspension.startDate)} -> ${formatDateLabel(selectedRow.suspension.endDate)}`
                      : "none"}
                  </div>
                </div>

                <Form method="post" className="space-y-3">
                  <input type="hidden" name="_intent" value="record-attendance" />
                  <input type="hidden" name="workerId" value={selectedRow.id} />
                  <input
                    type="hidden"
                    name="scheduleId"
                    value={selectedRow.schedule?.id ?? ""}
                  />
                  <input type="hidden" name="dutyDate" value={dutyDate} />

                  <SoTFormField label="Day type">
                    <SelectInput
                      name="dayType"
                      defaultValue={defaultDayType}
                      options={DAY_TYPE_OPTIONS}
                    />
                  </SoTFormField>

                  <SoTFormField label="Attendance result">
                    <SelectInput
                      name="attendanceResult"
                      defaultValue={defaultAttendanceResult}
                      options={ATTENDANCE_RESULT_OPTIONS}
                    />
                  </SoTFormField>

                  <SoTFormField label="Work context">
                    <SelectInput
                      name="workContext"
                      defaultValue={defaultWorkContext}
                      options={WORK_CONTEXT_OPTIONS}
                    />
                  </SoTFormField>

                  <SoTFormField label="Leave type">
                    <SelectInput
                      name="leaveType"
                      defaultValue={defaultLeaveType}
                      options={[
                        { value: "", label: "None" },
                        { value: AttendanceLeaveType.SICK_LEAVE, label: "Sick leave" },
                      ]}
                    />
                  </SoTFormField>

                  <SoTFormField label="Late flag">
                    <SelectInput
                      name="lateFlag"
                      defaultValue={defaultLateFlag}
                      options={LATE_FLAG_OPTIONS}
                    />
                  </SoTFormField>

                  <SoTFormField label="Manager note">
                    <SoTInput
                      name="note"
                      defaultValue={selectedRow.attendance?.note ?? ""}
                      placeholder="Reason, clarification, or attendance context"
                    />
                  </SoTFormField>

                  <SoTButton type="submit" variant="primary">
                    Save attendance fact
                  </SoTButton>
                </Form>
              </SoTCard>
            ) : (
              <SoTCard>
                <p className="text-sm text-slate-600">
                  Select a worker row to review attendance facts.
                </p>
              </SoTCard>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
