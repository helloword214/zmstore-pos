import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
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
import {
  applyWorkerSuspensionRecordAndOverlay,
  liftWorkerSuspensionRecord,
  listWorkerSuspensionRecords,
} from "~/services/worker-suspension-record.server";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

const SUSPENSION_RECORD_STATUS = {
  ACTIVE: "ACTIVE",
  LIFTED: "LIFTED",
} as const;

const WORKER_SCHEDULE_STATUS = {
  CANCELLED: "CANCELLED",
  PUBLISHED: "PUBLISHED",
} as const;

const WORKER_SCHEDULE_ENTRY_TYPE = {
  WORK: "WORK",
} as const;

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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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

function formatDateTimeLabel(value: Date | string | null | undefined) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTimeWindow(startAt: Date | string, endAt: Date | string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return `${String(start.getHours()).padStart(2, "0")}:${String(
    start.getMinutes(),
  ).padStart(2, "0")} - ${String(end.getHours()).padStart(2, "0")}:${String(
    end.getMinutes(),
  ).padStart(2, "0")}`;
}

function buildWorkerLabel(worker: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  const fullName = `${worker.firstName} ${worker.lastName}`.trim();
  return `${fullName}${worker.alias ? ` (${worker.alias})` : ""}`;
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

function statusTone(status: string) {
  if (status === SUSPENSION_RECORD_STATUS.ACTIVE) return "warning" as const;
  if (status === SUSPENSION_RECORD_STATUS.LIFTED) return "success" as const;
  return "info" as const;
}

function buildSuspensionRedirect(args: {
  workerId?: number | null;
  saved?: string;
}) {
  const params = new URLSearchParams();
  if (args.workerId) {
    params.set("workerId", String(args.workerId));
  }
  if (args.saved) {
    params.set("saved", args.saved);
  }
  const suffix = params.toString();
  return suffix
    ? `/store/workforce/suspension-records?${suffix}`
    : "/store/workforce/suspension-records";
}

function dateFallsWithinRange(
  date: Date | string,
  startDate: Date | string,
  endDate: Date | string,
) {
  const target = toDateOnly(date).getTime();
  return (
    target >= toDateOnly(startDate).getTime() &&
    target <= toDateOnly(endDate).getTime()
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);
  const url = new URL(request.url);
  const selectedWorkerId = parseOptionalInt(url.searchParams.get("workerId"));
  const saved = url.searchParams.get("saved");
  const today = toDateOnly(new Date());

  const workers = await db.employee.findMany({
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
  });

  const selectedWorker =
    workers.find((worker) => worker.id === selectedWorkerId) ?? workers[0] ?? null;

  const [records, upcomingSchedules] = await Promise.all([
    listWorkerSuspensionRecords(
      selectedWorkerId ? { workerId: selectedWorkerId } : undefined,
    ),
    selectedWorker
      ? db.workerSchedule.findMany({
          where: {
            workerId: selectedWorker.id,
            entryType: WORKER_SCHEDULE_ENTRY_TYPE.WORK,
            status: { not: WORKER_SCHEDULE_STATUS.CANCELLED },
            scheduleDate: {
              gte: today,
              lte: addDays(today, 30),
            },
          },
          orderBy: [{ scheduleDate: "asc" }, { startAt: "asc" }],
          take: 12,
        })
      : Promise.resolve([]),
  ]);

  const activeSuspension =
    records.find(
      (record) =>
        record.workerId === selectedWorker?.id &&
        record.status === SUSPENSION_RECORD_STATUS.ACTIVE,
    ) ?? null;

  return json({
    selectedWorker,
    workers: workers.map((worker) => ({
      id: worker.id,
      label: buildWorkerLabel(worker),
      role: worker.user?.role ?? "UNASSIGNED",
    })),
    records,
    upcomingSchedules,
    activeSuspension,
    saved,
    today: formatDateInput(today),
    defaultEndDate: formatDateInput(addDays(today, 6)),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");

  try {
    if (intent === "apply-suspension") {
      const workerId = parseOptionalInt(String(fd.get("workerId") || ""));
      const startDate = String(fd.get("startDate") || "");
      const endDate = String(fd.get("endDate") || "");
      const reasonType = String(fd.get("reasonType") || "").trim();
      const managerNote = String(fd.get("managerNote") || "");

      if (!workerId) throw new Error("Worker is required.");
      if (!startDate || !endDate) {
        throw new Error("Start and end dates are required.");
      }
      if (!reasonType) {
        throw new Error("Reason type is required.");
      }

      await applyWorkerSuspensionRecordAndOverlay({
        workerId,
        startDate,
        endDate,
        reasonType,
        managerNote,
        appliedById: me.userId,
      });

      return redirect(
        buildSuspensionRedirect({
          workerId,
          saved: "applied",
        }),
      );
    }

    if (intent === "lift-suspension") {
      const suspensionRecordId = parseOptionalInt(
        String(fd.get("suspensionRecordId") || ""),
      );
      const workerId = parseOptionalInt(String(fd.get("workerId") || ""));

      if (!suspensionRecordId) {
        throw new Error("Suspension record is required.");
      }

      await liftWorkerSuspensionRecord(suspensionRecordId, me.userId);

      return redirect(
        buildSuspensionRedirect({
          workerId,
          saved: "lifted",
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
        error:
          error instanceof Error
            ? error.message
            : "Unable to save suspension changes.",
        action: intent,
      },
      { status: 400 },
    );
  }
}

export default function WorkforceSuspensionRecordsRoute() {
  const {
    selectedWorker,
    workers,
    records,
    upcomingSchedules,
    activeSuspension,
    saved,
    today,
    defaultEndDate,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const safeUpcomingSchedules = upcomingSchedules.filter(
    (schedule): schedule is NonNullable<(typeof upcomingSchedules)[number]> =>
      schedule != null,
  );

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Workforce Suspension Records"
        subtitle="Apply or lift suspension windows and preserve an auditable record of the attendance overlay placed on scheduled work days."
        backTo="/store"
        backLabel="Manager Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {saved === "applied" ? (
          <SoTAlert tone="success">
            Suspension recorded and scheduled duty rows were overlaid where applicable.
          </SoTAlert>
        ) : null}
        {saved === "lifted" ? (
          <SoTAlert tone="success">
            Suspension lifted and future overlay rows were cleared for the remaining range.
          </SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <SoTCard interaction="form" className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Worker focus</h2>
            <p className="text-xs text-slate-500">
              Filter the audit table and preload the apply form for one worker at a time.
            </p>
          </div>

          <Form method="get" className="grid gap-3 md:grid-cols-[1fr,auto]">
            <SoTFormField label="Worker">
              <SelectInput
                name="workerId"
                defaultValue={selectedWorker?.id ?? ""}
                options={workers.map((worker) => ({
                  value: worker.id,
                  label: `${worker.label} · ${worker.role}`,
                }))}
              />
            </SoTFormField>
            <div className="flex items-end">
              <SoTButton type="submit" variant="primary">
                Load worker
              </SoTButton>
            </div>
          </Form>
        </SoTCard>

        <div className="grid gap-5 lg:grid-cols-12">
          <section className="lg:col-span-7">
            <SoTCard className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Suspension record history
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedWorker
                    ? `Showing records for ${selectedWorker.firstName} ${selectedWorker.lastName}.`
                    : "Showing all recorded suspension windows."}
                </p>
              </div>

              <SoTTable>
                <SoTTableHead>
                  <SoTTableRow>
                    <SoTTh>Worker</SoTTh>
                    <SoTTh>Window</SoTTh>
                    <SoTTh>Reason</SoTTh>
                    <SoTTh>Status</SoTTh>
                    <SoTTh>Audit</SoTTh>
                    <SoTTh>Action</SoTTh>
                  </SoTTableRow>
                </SoTTableHead>
                <tbody>
                  {records.length === 0 ? (
                    <SoTTableEmptyRow
                      colSpan={6}
                      message="No suspension records found for the current filter."
                    />
                  ) : (
                    records.map((record) => (
                      <SoTTableRow key={record.id}>
                        <SoTTd>
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {buildWorkerLabel(record.worker)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {record.worker.user?.role ?? "UNASSIGNED"}
                            </div>
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <div className="space-y-1 text-sm text-slate-700">
                            <div>
                              {formatDateLabel(record.startDate)} to{" "}
                              {formatDateLabel(record.endDate)}
                            </div>
                            <div className="text-xs text-slate-500">
                              Applied {formatDateTimeLabel(record.appliedAt)}
                            </div>
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {record.reasonType}
                            </div>
                            <div className="text-xs text-slate-500">
                              {record.managerNote || "No manager note"}
                            </div>
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <SoTStatusBadge tone={statusTone(record.status)}>
                            {record.status}
                          </SoTStatusBadge>
                        </SoTTd>
                        <SoTTd>
                          <div className="space-y-1 text-xs text-slate-500">
                            <div>Applied by {actorLabel(record.appliedBy)}</div>
                            {record.liftedAt ? (
                              <div>
                                Lifted by {actorLabel(record.liftedBy)} on{" "}
                                {formatDateTimeLabel(record.liftedAt)}
                              </div>
                            ) : (
                              <div>Lift not recorded yet</div>
                            )}
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              to={buildSuspensionRedirect({ workerId: record.workerId })}
                              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Open worker
                            </Link>
                            {record.status === SUSPENSION_RECORD_STATUS.ACTIVE ? (
                              <Form method="post">
                                <input
                                  type="hidden"
                                  name="_intent"
                                  value="lift-suspension"
                                />
                                <input
                                  type="hidden"
                                  name="suspensionRecordId"
                                  value={record.id}
                                />
                                <input
                                  type="hidden"
                                  name="workerId"
                                  value={record.workerId}
                                />
                                <SoTButton type="submit" variant="danger">
                                  Lift
                                </SoTButton>
                              </Form>
                            ) : null}
                          </div>
                        </SoTTd>
                      </SoTTableRow>
                    ))
                  )}
                </tbody>
              </SoTTable>
            </SoTCard>
          </section>

          <aside className="space-y-5 lg:col-span-5">
            {selectedWorker ? (
              <>
                <SoTCard interaction="form" className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        Selected worker
                      </h2>
                      <p className="text-xs text-slate-500">
                        {buildWorkerLabel(selectedWorker)} ·{" "}
                        {selectedWorker.user?.role ?? "UNASSIGNED"}
                      </p>
                    </div>
                    {activeSuspension ? (
                      <SoTStatusBadge tone="warning">ACTIVE</SoTStatusBadge>
                    ) : (
                      <SoTStatusBadge tone="info">CLEAR</SoTStatusBadge>
                    )}
                  </div>

                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <div>
                      Current active suspension:{" "}
                      {activeSuspension
                        ? `${formatDateLabel(activeSuspension.startDate)} to ${formatDateLabel(activeSuspension.endDate)}`
                        : "none"}
                    </div>
                    <div>
                      Reason: {activeSuspension?.reasonType ?? "n/a"}
                    </div>
                    <div>
                      Note: {activeSuspension?.managerNote ?? "No active manager note"}
                    </div>
                  </div>

                  <Form method="post" className="space-y-3">
                    <input type="hidden" name="_intent" value="apply-suspension" />
                    <input type="hidden" name="workerId" value={selectedWorker.id} />

                    <div className="grid gap-3 md:grid-cols-2">
                      <SoTFormField label="Start date">
                        <SoTInput
                          type="date"
                          name="startDate"
                          defaultValue={today}
                          required
                        />
                      </SoTFormField>
                      <SoTFormField label="End date">
                        <SoTInput
                          type="date"
                          name="endDate"
                          defaultValue={defaultEndDate}
                          required
                        />
                      </SoTFormField>
                    </div>

                    <SoTFormField label="Reason type">
                      <SoTInput
                        name="reasonType"
                        placeholder="Policy violation, misconduct, administrative hold"
                        required
                      />
                    </SoTFormField>

                    <SoTFormField label="Manager note">
                      <SoTInput
                        name="managerNote"
                        placeholder="Why the suspension was applied and any handling notes"
                      />
                    </SoTFormField>

                    <div className="flex flex-wrap gap-2">
                      <SoTButton type="submit" variant="primary">
                        Apply suspension
                      </SoTButton>
                      <Link
                        to={`/store/workforce/attendance-review?date=${encodeURIComponent(
                          today,
                        )}&workerId=${selectedWorker.id}`}
                        className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Open attendance review
                      </Link>
                    </div>
                  </Form>
                </SoTCard>

                <SoTCard className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        Upcoming scheduled work rows
                      </h2>
                      <p className="text-xs text-slate-500">
                        Preview of the next 30 days of planned work that could be affected by a suspension overlay.
                      </p>
                    </div>
                    <Link
                      to="/store/workforce/schedule-planner?preset=next-cutoff"
                      className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Planner
                    </Link>
                  </div>

                  <SoTTable>
                    <SoTTableHead>
                      <SoTTableRow>
                        <SoTTh>Date</SoTTh>
                        <SoTTh>Window</SoTTh>
                        <SoTTh>Status</SoTTh>
                      </SoTTableRow>
                    </SoTTableHead>
                    <tbody>
                      {safeUpcomingSchedules.length === 0 ? (
                          <SoTTableEmptyRow
                            colSpan={3}
                            message="No upcoming scheduled work rows for this worker."
                          />
                      ) : (
                        safeUpcomingSchedules.map((schedule) => (
                          <SoTTableRow key={schedule.id}>
                            <SoTTd>{formatDateLabel(schedule.scheduleDate)}</SoTTd>
                            <SoTTd>
                              {formatTimeWindow(schedule.startAt, schedule.endAt)}
                            </SoTTd>
                            <SoTTd>
                              <div className="space-y-1">
                                <SoTStatusBadge
                                  tone={
                                    activeSuspension &&
                                    dateFallsWithinRange(
                                      schedule.scheduleDate,
                                      activeSuspension.startDate,
                                      activeSuspension.endDate,
                                    )
                                      ? "warning"
                                      : schedule.status === WORKER_SCHEDULE_STATUS.PUBLISHED
                                        ? "success"
                                        : "info"
                                  }
                                >
                                  {activeSuspension &&
                                  dateFallsWithinRange(
                                    schedule.scheduleDate,
                                    activeSuspension.startDate,
                                    activeSuspension.endDate,
                                  )
                                    ? "SUSPENSION RANGE"
                                    : schedule.status}
                                </SoTStatusBadge>
                                <div className="text-xs text-slate-500">
                                  {schedule.note || "No schedule note"}
                                </div>
                              </div>
                            </SoTTd>
                          </SoTTableRow>
                        ))
                      )}
                    </tbody>
                  </SoTTable>
                </SoTCard>
              </>
            ) : (
              <SoTCard>
                <p className="text-sm text-slate-600">
                  No active workers were found, so suspension operations are unavailable.
                </p>
              </SoTCard>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
