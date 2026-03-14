import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import {
  PayrollFrequency,
  WorkerScheduleEventType,
  WorkerScheduleStatus,
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
import { getEffectiveCompanyPayrollPolicy } from "~/services/worker-payroll-policy.server";
import {
  cancelWorkerSchedule,
  generateWorkerSchedulesFromTemplateAssignments,
  publishWorkerSchedules,
  updateWorkerScheduleOneOff,
} from "~/services/worker-schedule-publication.server";
import {
  appendWorkerScheduleEvent,
  listWorkerScheduleEventsForSchedules,
} from "~/services/worker-schedule-event.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

type PlannerPreset = "next-week" | "next-cutoff" | "next-month";

const EVENT_OPTIONS = [
  { value: WorkerScheduleEventType.MANAGER_NOTE_ADDED, label: "Manager note" },
  {
    value: WorkerScheduleEventType.REPLACEMENT_ASSIGNED,
    label: "Replacement assigned",
  },
  { value: WorkerScheduleEventType.ON_CALL_ASSIGNED, label: "On-call assigned" },
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
  const date = toDateOnly(value);
  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatDateTimeLabel(value: Date | string) {
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTimeInput(value: Date | string) {
  const date = new Date(value);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
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

function getNextCutoffRange(
  reference: Date,
  payFrequency: PayrollFrequency | null | undefined,
) {
  const base = toDateOnly(reference);

  if (payFrequency === PayrollFrequency.SEMI_MONTHLY) {
    if (base.getDate() <= 15) {
      return {
        rangeStart: new Date(base.getFullYear(), base.getMonth(), 16),
        rangeEnd: new Date(base.getFullYear(), base.getMonth() + 1, 0),
      };
    }

    return {
      rangeStart: new Date(base.getFullYear(), base.getMonth() + 1, 1),
      rangeEnd: new Date(base.getFullYear(), base.getMonth() + 1, 15),
    };
  }

  if (payFrequency === PayrollFrequency.WEEKLY) {
    const rangeStart = startOfNextWeek(base);
    return { rangeStart, rangeEnd: endOfWeek(rangeStart) };
  }

  if (payFrequency === PayrollFrequency.BIWEEKLY) {
    const rangeStart = startOfNextWeek(base);
    return { rangeStart, rangeEnd: addDays(rangeStart, 13) };
  }

  return { rangeStart: addDays(base, 1), rangeEnd: addDays(base, 14) };
}

function resolvePlannerRange(args: {
  url: URL;
  payFrequency: PayrollFrequency | null | undefined;
}) {
  const preset = args.url.searchParams.get("preset") as PlannerPreset | null;
  const today = toDateOnly(new Date());

  if (preset === "next-month") {
    const rangeStart = startOfNextMonth(today);
    return { rangeStart, rangeEnd: endOfMonth(rangeStart), preset };
  }

  if (preset === "next-cutoff") {
    const { rangeStart, rangeEnd } = getNextCutoffRange(today, args.payFrequency);
    return { rangeStart, rangeEnd, preset };
  }

  if (preset === "next-week") {
    const rangeStart = startOfNextWeek(today);
    return { rangeStart, rangeEnd: endOfWeek(rangeStart), preset };
  }

  const rangeStartParam = args.url.searchParams.get("rangeStart");
  const rangeEndParam = args.url.searchParams.get("rangeEnd");
  if (rangeStartParam && rangeEndParam) {
    return {
      rangeStart: toDateOnly(rangeStartParam),
      rangeEnd: toDateOnly(rangeEndParam),
      preset: null,
    };
  }

  const rangeStart = startOfNextWeek(today);
  return { rangeStart, rangeEnd: endOfWeek(rangeStart), preset: "next-week" as const };
}

function buildPlannerRedirect(args: {
  rangeStart: string;
  rangeEnd: string;
  scheduleId?: number | null;
  saved?: string;
}) {
  const params = new URLSearchParams({
    rangeStart: args.rangeStart,
    rangeEnd: args.rangeEnd,
  });
  if (args.scheduleId) {
    params.set("scheduleId", String(args.scheduleId));
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
  user?: { role: string | null } | null;
}) {
  const fullName = `${worker.firstName} ${worker.lastName}`.trim();
  return `${fullName}${worker.alias ? ` (${worker.alias})` : ""}`;
}

function statusTone(status: string) {
  if (status === "PUBLISHED") return "success" as const;
  if (status === "DRAFT") return "warning" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "info" as const;
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
      user: null,
    });
  }
  return actor.email ?? "Unknown actor";
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);
  const url = new URL(request.url);
  const effectivePolicy = await getEffectiveCompanyPayrollPolicy(db, new Date());
  const { rangeStart, rangeEnd, preset } = resolvePlannerRange({
    url,
    payFrequency: effectivePolicy?.payFrequency,
  });
  const selectedScheduleId = parseOptionalInt(url.searchParams.get("scheduleId"));
  const saved = url.searchParams.get("saved");

  const [schedules, workers] = await Promise.all([
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
  ]);

  const selectedSchedule =
    schedules.find((schedule) => schedule.id === selectedScheduleId) ??
    schedules[0] ??
    null;

  const selectedEvents = selectedSchedule
    ? await listWorkerScheduleEventsForSchedules([selectedSchedule.id])
    : [];

  const counts = schedules.reduce(
    (acc, schedule) => {
      if (schedule.status === WorkerScheduleStatus.DRAFT) acc.draft += 1;
      if (schedule.status === WorkerScheduleStatus.PUBLISHED) acc.published += 1;
      if (schedule.status === WorkerScheduleStatus.CANCELLED) acc.cancelled += 1;
      return acc;
    },
    { draft: 0, published: 0, cancelled: 0 },
  );

  return json({
    schedules,
    selectedSchedule,
    selectedEvents,
    workers: workers.map((worker) => ({
      id: worker.id,
      label: buildWorkerLabel(worker),
      role: worker.user?.role ?? "UNASSIGNED",
    })),
    counts,
    saved,
    preset,
    rangeStart: formatDateInput(rangeStart),
    rangeEnd: formatDateInput(rangeEnd),
    payFrequency: effectivePolicy?.payFrequency ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  const rangeStart = String(fd.get("rangeStart") || "");
  const rangeEnd = String(fd.get("rangeEnd") || "");
  const scheduleId = parseOptionalInt(String(fd.get("scheduleId") || ""));

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

    if (intent === "update-schedule") {
      if (!scheduleId) throw new Error("Select a schedule first.");
      await updateWorkerScheduleOneOff({
        scheduleId,
        actorUserId: me.userId,
        startTime: String(fd.get("startTime") || ""),
        endTime: String(fd.get("endTime") || ""),
        note: String(fd.get("note") || ""),
      });
      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          scheduleId,
          saved: "schedule-updated",
        }),
      );
    }

    if (intent === "cancel-schedule") {
      if (!scheduleId) throw new Error("Select a schedule first.");
      await cancelWorkerSchedule({
        scheduleId,
        actorUserId: me.userId,
        note: String(fd.get("note") || ""),
      });
      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          scheduleId,
          saved: "schedule-cancelled",
        }),
      );
    }

    if (intent === "append-event") {
      if (!scheduleId) throw new Error("Select a schedule first.");
      const eventType = String(fd.get("eventType") || "");
      const relatedWorkerId = parseOptionalInt(String(fd.get("relatedWorkerId") || ""));
      const note = String(fd.get("note") || "");

      if (
        eventType !== WorkerScheduleEventType.MANAGER_NOTE_ADDED &&
        eventType !== WorkerScheduleEventType.REPLACEMENT_ASSIGNED &&
        eventType !== WorkerScheduleEventType.ON_CALL_ASSIGNED
      ) {
        throw new Error("Unsupported schedule event.");
      }
      if (
        (eventType === WorkerScheduleEventType.REPLACEMENT_ASSIGNED ||
          eventType === WorkerScheduleEventType.ON_CALL_ASSIGNED) &&
        !relatedWorkerId
      ) {
        throw new Error("Related worker is required for replacement/on-call events.");
      }

      const schedule = await db.workerSchedule.findUnique({
        where: { id: scheduleId },
        select: { id: true, workerId: true },
      });
      if (!schedule) throw new Error("Worker schedule not found.");

      await appendWorkerScheduleEvent({
        scheduleId: schedule.id,
        eventType,
        actorUserId: me.userId,
        subjectWorkerId: schedule.workerId,
        relatedWorkerId,
        note,
      });

      return redirect(
        buildPlannerRedirect({
          rangeStart,
          rangeEnd,
          scheduleId,
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
    schedules,
    selectedSchedule,
    selectedEvents,
    workers,
    counts,
    saved,
    preset,
    rangeStart,
    rangeEnd,
    payFrequency,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Workforce Schedule Planner"
        subtitle="Generate future schedules from templates, review draft rows, publish, and log one-off staffing changes."
        backTo="/store"
        backLabel="Manager Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {saved ? (
          <SoTAlert tone="success">
            {saved === "generated" && "Draft schedule rows generated for the selected range."}
            {saved === "published" && "Draft schedules published for the selected range."}
            {saved === "schedule-updated" && "One-off schedule row updated."}
            {saved === "schedule-cancelled" && "Schedule row cancelled with event history preserved."}
            {saved === "event-added" && "Schedule event appended."}
          </SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <SoTCard interaction="form" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Planning range</h2>
              <p className="text-xs text-slate-500">
                Current range: {formatDateLabel(rangeStart)} to {formatDateLabel(rangeEnd)}
                {payFrequency ? ` · Payroll frequency hint: ${payFrequency}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/store/workforce/schedule-planner?preset=next-week"
                className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium ${
                  preset === "next-week"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                Next Week
              </Link>
              <Link
                to="/store/workforce/schedule-planner?preset=next-cutoff"
                className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium ${
                  preset === "next-cutoff"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                Next Cutoff
              </Link>
              <Link
                to="/store/workforce/schedule-planner?preset=next-month"
                className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium ${
                  preset === "next-month"
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                Next Month
              </Link>
            </div>
          </div>

          <Form method="get" className="grid gap-3 md:grid-cols-[1fr,1fr,auto]">
            <SoTFormField label="Range start">
              <SoTInput type="date" name="rangeStart" defaultValue={rangeStart} required />
            </SoTFormField>
            <SoTFormField label="Range end">
              <SoTInput type="date" name="rangeEnd" defaultValue={rangeEnd} required />
            </SoTFormField>
            <div className="flex items-end">
              <SoTButton type="submit" variant="primary">
                Load range
              </SoTButton>
            </div>
          </Form>

          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Total rows" value={String(schedules.length)} />
            <MetricCard label="Draft" value={String(counts.draft)} tone="warning" />
            <MetricCard label="Published" value={String(counts.published)} tone="success" />
            <MetricCard label="Cancelled" value={String(counts.cancelled)} tone="danger" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Form method="post">
              <input type="hidden" name="_intent" value="generate-range" />
              <input type="hidden" name="rangeStart" value={rangeStart} />
              <input type="hidden" name="rangeEnd" value={rangeEnd} />
              <SoTButton type="submit" variant="primary">
                Generate Draft Rows
              </SoTButton>
            </Form>
            <Form method="post">
              <input type="hidden" name="_intent" value="publish-range" />
              <input type="hidden" name="rangeStart" value={rangeStart} />
              <input type="hidden" name="rangeEnd" value={rangeEnd} />
              <SoTButton type="submit">Publish Draft Rows</SoTButton>
            </Form>
            <Link
              to="/store/workforce/schedule-templates"
              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open templates
            </Link>
          </div>
        </SoTCard>

        <div className="grid gap-5 lg:grid-cols-12">
          <section className="lg:col-span-7">
            <SoTCard className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Generated schedule rows</h2>
                <p className="text-xs text-slate-500">
                  Review one row at a time, then use the detail panel for edits, cancellation, or append-only staffing events.
                </p>
              </div>

              <SoTTable>
                <SoTTableHead>
                  <SoTTableRow>
                    <SoTTh>Date</SoTTh>
                    <SoTTh>Worker</SoTTh>
                    <SoTTh>Window</SoTTh>
                    <SoTTh>Status</SoTTh>
                    <SoTTh>Review</SoTTh>
                  </SoTTableRow>
                </SoTTableHead>
                <tbody>
                  {schedules.length === 0 ? (
                    <SoTTableEmptyRow
                      colSpan={5}
                      message="No schedules in this range yet. Generate draft rows first."
                    />
                  ) : (
                    schedules.map((schedule) => (
                      <SoTTableRow key={schedule.id}>
                        <SoTTd>{formatDateLabel(schedule.scheduleDate)}</SoTTd>
                        <SoTTd>
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {buildWorkerLabel(schedule.worker)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {schedule.worker.user?.role ?? schedule.role}
                              {schedule.templateAssignment?.template?.templateName
                                ? ` · ${schedule.templateAssignment.template.templateName}`
                                : ""}
                            </div>
                          </div>
                        </SoTTd>
                        <SoTTd>
                          {formatTimeInput(schedule.startAt)} - {formatTimeInput(schedule.endAt)}
                        </SoTTd>
                        <SoTTd>
                          <div className="space-y-1">
                            <SoTStatusBadge tone={statusTone(schedule.status)}>
                              {schedule.status}
                            </SoTStatusBadge>
                            {schedule.attendanceDutyResult ? (
                              <div className="text-xs text-slate-500">
                                Attendance: {schedule.attendanceDutyResult.attendanceResult}
                              </div>
                            ) : null}
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <Link
                            to={buildPlannerRedirect({
                              rangeStart,
                              rangeEnd,
                              scheduleId: schedule.id,
                            })}
                            className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {selectedSchedule?.id === schedule.id ? "Selected" : "Open"}
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
            {selectedSchedule ? (
              <>
                <SoTCard interaction="form" className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        Selected schedule
                      </h2>
                      <p className="text-xs text-slate-500">
                        {buildWorkerLabel(selectedSchedule.worker)} · {formatDateLabel(selectedSchedule.scheduleDate)}
                      </p>
                    </div>
                    <SoTStatusBadge tone={statusTone(selectedSchedule.status)}>
                      {selectedSchedule.status}
                    </SoTStatusBadge>
                  </div>

                  <Form method="post" className="space-y-3">
                    <input type="hidden" name="_intent" value="update-schedule" />
                    <input type="hidden" name="scheduleId" value={selectedSchedule.id} />
                    <input type="hidden" name="rangeStart" value={rangeStart} />
                    <input type="hidden" name="rangeEnd" value={rangeEnd} />

                    <div className="grid gap-3 md:grid-cols-2">
                      <SoTFormField label="Start time">
                        <SoTInput
                          type="time"
                          name="startTime"
                          defaultValue={formatTimeInput(selectedSchedule.startAt)}
                          required
                        />
                      </SoTFormField>
                      <SoTFormField label="End time">
                        <SoTInput
                          type="time"
                          name="endTime"
                          defaultValue={formatTimeInput(selectedSchedule.endAt)}
                          required
                        />
                      </SoTFormField>
                    </div>

                    <SoTFormField label="Manager note">
                      <SoTInput
                        name="note"
                        defaultValue={selectedSchedule.note ?? ""}
                        placeholder="Reason for this one-off change"
                      />
                    </SoTFormField>

                    <div className="flex flex-wrap gap-2">
                      <SoTButton type="submit" variant="primary">
                        Save one-off edit
                      </SoTButton>
                    </div>
                  </Form>

                  <Form method="post" className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/50 p-3">
                    <input type="hidden" name="_intent" value="cancel-schedule" />
                    <input type="hidden" name="scheduleId" value={selectedSchedule.id} />
                    <input type="hidden" name="rangeStart" value={rangeStart} />
                    <input type="hidden" name="rangeEnd" value={rangeEnd} />

                    <SoTFormField label="Cancellation note">
                      <SoTInput
                        name="note"
                        placeholder="Why this schedule row is cancelled"
                        required
                      />
                    </SoTFormField>

                    <SoTButton type="submit" variant="danger">
                      Cancel schedule row
                    </SoTButton>
                  </Form>
                </SoTCard>

                <SoTCard interaction="form" className="space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Append staffing event
                    </h2>
                    <p className="text-xs text-slate-500">
                      Use this for replacement, on-call, or manager notes without overwriting history.
                    </p>
                  </div>

                  <Form method="post" className="space-y-3">
                    <input type="hidden" name="_intent" value="append-event" />
                    <input type="hidden" name="scheduleId" value={selectedSchedule.id} />
                    <input type="hidden" name="rangeStart" value={rangeStart} />
                    <input type="hidden" name="rangeEnd" value={rangeEnd} />

                    <SoTFormField label="Event type">
                      <SelectInput
                        name="eventType"
                        defaultValue={WorkerScheduleEventType.MANAGER_NOTE_ADDED}
                        options={EVENT_OPTIONS}
                      />
                    </SoTFormField>

                    <SoTFormField label="Related worker (optional)">
                      <SelectInput
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
                    </SoTFormField>

                    <SoTFormField label="Event note">
                      <SoTInput
                        name="note"
                        placeholder="Explain the coverage or note decision"
                        required
                      />
                    </SoTFormField>

                    <SoTButton type="submit" variant="primary">
                      Append event
                    </SoTButton>
                  </Form>
                </SoTCard>

                <SoTCard className="space-y-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">Event history</h2>
                    <p className="text-xs text-slate-500">
                      Append-only schedule timeline for this row.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {selectedEvents.length === 0 ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        No schedule events yet.
                      </div>
                    ) : (
                      selectedEvents.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <SoTStatusBadge tone="info">{event.eventType}</SoTStatusBadge>
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
                </SoTCard>
              </>
            ) : (
              <SoTCard>
                <p className="text-sm text-slate-600">
                  Load a range and select a schedule row to review or edit it.
                </p>
              </SoTCard>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  tone = "info",
}: {
  label: string;
  value: string;
  tone?: "info" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50/40"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/40"
        : tone === "danger"
          ? "border-rose-200 bg-rose-50/40"
          : "border-sky-200 bg-sky-50/40";

  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}
