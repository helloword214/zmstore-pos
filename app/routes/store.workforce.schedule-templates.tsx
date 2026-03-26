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
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  assignWorkerScheduleTemplateToWorkers,
  listWorkerScheduleTemplates,
  setWorkerScheduleTemplateAssignmentStatus,
  setWorkerScheduleTemplateStatus,
  upsertWorkerScheduleTemplate,
} from "~/services/worker-schedule-template.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

const WORKER_SCHEDULE_ASSIGNMENT_STATUS = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ENDED: "ENDED",
} as const;

type WorkerScheduleAssignmentStatusValue =
  (typeof WORKER_SCHEDULE_ASSIGNMENT_STATUS)[keyof typeof WORKER_SCHEDULE_ASSIGNMENT_STATUS];

const WORKER_SCHEDULE_ROLE = {
  CASHIER: "CASHIER",
  STORE_MANAGER: "STORE_MANAGER",
  EMPLOYEE: "EMPLOYEE",
} as const;

type WorkerScheduleRoleValue =
  (typeof WORKER_SCHEDULE_ROLE)[keyof typeof WORKER_SCHEDULE_ROLE];

const WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK = {
  MONDAY: "MONDAY",
  TUESDAY: "TUESDAY",
  WEDNESDAY: "WEDNESDAY",
  THURSDAY: "THURSDAY",
  FRIDAY: "FRIDAY",
  SATURDAY: "SATURDAY",
  SUNDAY: "SUNDAY",
} as const;

type WorkerScheduleTemplateDayOfWeekValue =
  (typeof WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK)[keyof typeof WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK];

const WORKER_SCHEDULE_TEMPLATE_STATUS = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ENDED: "ENDED",
} as const;

type WorkerScheduleTemplateStatusValue =
  (typeof WORKER_SCHEDULE_TEMPLATE_STATUS)[keyof typeof WORKER_SCHEDULE_TEMPLATE_STATUS];

const WORKER_SCHEDULE_ROLE_VALUES = [
  WORKER_SCHEDULE_ROLE.CASHIER,
  WORKER_SCHEDULE_ROLE.STORE_MANAGER,
  WORKER_SCHEDULE_ROLE.EMPLOYEE,
] as const;

const WORKER_SCHEDULE_ASSIGNMENT_STATUS_VALUES = [
  WORKER_SCHEDULE_ASSIGNMENT_STATUS.ACTIVE,
  WORKER_SCHEDULE_ASSIGNMENT_STATUS.PAUSED,
  WORKER_SCHEDULE_ASSIGNMENT_STATUS.ENDED,
] as const;

const WORKER_SCHEDULE_TEMPLATE_STATUS_VALUES = [
  WORKER_SCHEDULE_TEMPLATE_STATUS.ACTIVE,
  WORKER_SCHEDULE_TEMPLATE_STATUS.PAUSED,
  WORKER_SCHEDULE_TEMPLATE_STATUS.ENDED,
] as const;

type DayConfig = {
  dayOfWeek: WorkerScheduleTemplateDayOfWeekValue;
  label: string;
};

type WorkerOption = {
  id: number;
  label: string;
  lane: string;
};

const DAY_CONFIGS: DayConfig[] = [
  { dayOfWeek: WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK.MONDAY, label: "Monday" },
  { dayOfWeek: WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK.TUESDAY, label: "Tuesday" },
  { dayOfWeek: WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK.WEDNESDAY, label: "Wednesday" },
  { dayOfWeek: WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK.THURSDAY, label: "Thursday" },
  { dayOfWeek: WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK.FRIDAY, label: "Friday" },
  { dayOfWeek: WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK.SATURDAY, label: "Saturday" },
  { dayOfWeek: WORKER_SCHEDULE_TEMPLATE_DAY_OF_WEEK.SUNDAY, label: "Sunday" },
];

const TEMPLATE_ROLE_OPTIONS = [
  { value: "", label: "Any role" },
  { value: WORKER_SCHEDULE_ROLE.CASHIER, label: "Cashier" },
  { value: WORKER_SCHEDULE_ROLE.STORE_MANAGER, label: "Store manager" },
  { value: WORKER_SCHEDULE_ROLE.EMPLOYEE, label: "Employee" },
];

const ASSIGNMENT_STATUS_OPTIONS = [
  { value: WORKER_SCHEDULE_ASSIGNMENT_STATUS.ACTIVE, label: "Active" },
  { value: WORKER_SCHEDULE_ASSIGNMENT_STATUS.PAUSED, label: "Paused" },
  { value: WORKER_SCHEDULE_ASSIGNMENT_STATUS.ENDED, label: "Ended" },
];

const TEMPLATE_STATUS_OPTIONS = [
  { value: WORKER_SCHEDULE_TEMPLATE_STATUS.ACTIVE, label: "Active" },
  { value: WORKER_SCHEDULE_TEMPLATE_STATUS.PAUSED, label: "Paused" },
  { value: WORKER_SCHEDULE_TEMPLATE_STATUS.ENDED, label: "Ended" },
];

function parseOptionalInt(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTimeToMinute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error("Time must use HH:MM format.");
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
  return hour * 60 + minute;
}

function minuteToTimeInput(value: number) {
  const hour = String(Math.floor(value / 60)).padStart(2, "0");
  const minute = String(value % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function buildEmployeeLabel(args: {
  firstName: string;
  lastName: string;
  alias: string | null;
  role: string | null;
}) {
  const fullName = `${args.firstName} ${args.lastName}`.trim();
  const aliasPart = args.alias ? ` (${args.alias})` : "";
  const lane = args.role ?? "UNASSIGNED";
  return `${fullName}${aliasPart}`;
}

function statusTone(status: string) {
  if (status === "ACTIVE" || status === "PUBLISHED") return "success" as const;
  if (status === "PAUSED" || status === "DRAFT") return "warning" as const;
  if (status === "ENDED" || status === "CANCELLED") return "danger" as const;
  return "info" as const;
}

function isWorkerScheduleRoleValue(value: string): value is WorkerScheduleRoleValue {
  return WORKER_SCHEDULE_ROLE_VALUES.includes(value as WorkerScheduleRoleValue);
}

function isWorkerScheduleAssignmentStatusValue(
  value: string,
): value is WorkerScheduleAssignmentStatusValue {
  return WORKER_SCHEDULE_ASSIGNMENT_STATUS_VALUES.includes(
    value as WorkerScheduleAssignmentStatusValue,
  );
}

function isWorkerScheduleTemplateStatusValue(
  value: string,
): value is WorkerScheduleTemplateStatusValue {
  return WORKER_SCHEDULE_TEMPLATE_STATUS_VALUES.includes(
    value as WorkerScheduleTemplateStatusValue,
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);
  const url = new URL(request.url);
  const selectedTemplateId = parseOptionalInt(url.searchParams.get("templateId"));
  const saved = url.searchParams.get("saved");

  const [templates, workers] = await Promise.all([
    listWorkerScheduleTemplates(),
    db.employee.findMany({
      where: {
        active: true,
        user: {
          is: { active: true },
        },
      },
      include: {
        user: {
          select: { role: true },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  const selectedTemplate =
    selectedTemplateId == null
      ? null
      : templates.find((template) => template.id === selectedTemplateId) ?? null;

  const workerOptions: WorkerOption[] = workers.map((worker) => ({
    id: worker.id,
    label: buildEmployeeLabel({
      firstName: worker.firstName,
      lastName: worker.lastName,
      alias: worker.alias ?? null,
      role: worker.user?.role ?? null,
    }),
    lane: worker.user?.role ?? "UNASSIGNED",
  }));

  return json({
    templates,
    selectedTemplate,
    workers: workerOptions,
    saved,
    today: new Date().toISOString().slice(0, 10),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");

  try {
    if (intent === "save-template") {
      const templateId = parseOptionalInt(String(fd.get("templateId") || ""));
      const templateName = String(fd.get("templateName") || "").trim();
      const effectiveFrom = String(fd.get("effectiveFrom") || "");
      const effectiveToRaw = String(fd.get("effectiveTo") || "").trim();
      const roleRaw = String(fd.get("role") || "").trim();

      const days = DAY_CONFIGS.flatMap((config) => {
        if (String(fd.get(`day_${config.dayOfWeek}_enabled`) || "") !== "1") {
          return [];
        }
        return [
          {
            dayOfWeek: config.dayOfWeek,
            startMinute: parseTimeToMinute(
              String(fd.get(`day_${config.dayOfWeek}_start`) || ""),
            ),
            endMinute: parseTimeToMinute(
              String(fd.get(`day_${config.dayOfWeek}_end`) || ""),
            ),
            note: String(fd.get(`day_${config.dayOfWeek}_note`) || "").trim(),
          },
        ];
      });

      const savedTemplate = await upsertWorkerScheduleTemplate({
        id: templateId ?? undefined,
        templateName,
        role: isWorkerScheduleRoleValue(roleRaw) ? roleRaw : null,
        effectiveFrom,
        effectiveTo: effectiveToRaw || null,
        actorUserId: me.userId,
        days,
      });

      return redirect(
        `/store/workforce/schedule-templates?templateId=${savedTemplate.id}&saved=template`,
      );
    }

    if (intent === "set-template-status") {
      const templateId = parseOptionalInt(String(fd.get("templateId") || ""));
      const status = String(fd.get("status") || "");
      if (!templateId) throw new Error("Template is required.");
      if (!isWorkerScheduleTemplateStatusValue(status)) {
        throw new Error("Invalid template status.");
      }

      await setWorkerScheduleTemplateStatus(templateId, status, me.userId);
      return redirect(
        `/store/workforce/schedule-templates?templateId=${templateId}&saved=status`,
      );
    }

    if (intent === "assign-workers") {
      const templateId = parseOptionalInt(String(fd.get("templateId") || ""));
      const effectiveFrom = String(fd.get("effectiveFrom") || "");
      const effectiveToRaw = String(fd.get("effectiveTo") || "").trim();
      const workerIds = fd
        .getAll("workerIds")
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);

      if (!templateId) throw new Error("Select a template first.");

      await assignWorkerScheduleTemplateToWorkers({
        templateId,
        workerIds,
        effectiveFrom,
        effectiveTo: effectiveToRaw || null,
        actorUserId: me.userId,
      });

      return redirect(
        `/store/workforce/schedule-templates?templateId=${templateId}&saved=assignment`,
      );
    }

    if (intent === "set-assignment-status") {
      const assignmentId = parseOptionalInt(String(fd.get("assignmentId") || ""));
      const templateId = parseOptionalInt(String(fd.get("templateId") || ""));
      const status = String(fd.get("status") || "");
      if (!assignmentId || !templateId) {
        throw new Error("Assignment context is missing.");
      }
      if (!isWorkerScheduleAssignmentStatusValue(status)) {
        throw new Error("Invalid assignment status.");
      }

      await setWorkerScheduleTemplateAssignmentStatus(assignmentId, status, me.userId);
      return redirect(
        `/store/workforce/schedule-templates?templateId=${templateId}&saved=assignment-status`,
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

export default function WorkforceScheduleTemplatesRoute() {
  const { templates, selectedTemplate, workers, saved, today } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const selectedDays = new Map(
    (selectedTemplate?.days ?? []).map((day) => [day.dayOfWeek, day]),
  );

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Workforce Schedule Templates"
        subtitle="Manager-owned weekly templates, reusable day patterns, and many-worker assignments."
        backTo="/store"
        backLabel="Manager Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {saved ? (
          <SoTAlert tone="success">
            {saved === "template" && "Schedule template saved."}
            {saved === "status" && "Template status updated."}
            {saved === "assignment" && "Workers assigned to template."}
            {saved === "assignment-status" && "Assignment status updated."}
          </SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-12">
          <section className="space-y-5 lg:col-span-7">
            <SoTCard interaction="form" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {selectedTemplate ? "Edit Template" : "Create Template"}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {selectedTemplate
                      ? "Weekly-only patterns. Generated rows stay separate and auditable."
                      : "Start from a blank weekly pattern here. Open a library row only when you want to edit that specific template."}
                  </p>
                </div>
                {selectedTemplate ? (
                  <SoTStatusBadge tone={statusTone(selectedTemplate.status)}>
                    {selectedTemplate.status}
                  </SoTStatusBadge>
                ) : null}
              </div>

              <Form
                key={selectedTemplate?.id ?? "new"}
                method="post"
                className="space-y-4"
              >
                <input type="hidden" name="_intent" value="save-template" />
                <input
                  type="hidden"
                  name="templateId"
                  value={selectedTemplate?.id ?? ""}
                />

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Template name">
                    <SoTInput
                      name="templateName"
                      defaultValue={selectedTemplate?.templateName ?? ""}
                      placeholder="Example: Cashier Weekday AM"
                      required
                    />
                  </SoTFormField>

                  <SoTFormField label="Role scope">
                    <SelectInput
                      name="role"
                      defaultValue={selectedTemplate?.role ?? ""}
                      options={TEMPLATE_ROLE_OPTIONS}
                    />
                  </SoTFormField>

                  <SoTFormField label="Effective from">
                    <SoTInput
                      type="date"
                      name="effectiveFrom"
                      defaultValue={
                        selectedTemplate?.effectiveFrom?.slice?.(0, 10) ??
                        selectedTemplate?.effectiveFrom?.toString?.().slice(0, 10) ??
                        today
                      }
                      required
                    />
                  </SoTFormField>

                  <SoTFormField label="Effective to">
                    <SoTInput
                      type="date"
                      name="effectiveTo"
                      defaultValue={
                        selectedTemplate?.effectiveTo
                          ? String(selectedTemplate.effectiveTo).slice(0, 10)
                          : ""
                      }
                    />
                  </SoTFormField>
                </div>

                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Weekly work days
                    </h3>
                    <p className="text-xs text-slate-500">
                      Enable only the days this template should generate as `WORK_DAY`.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {DAY_CONFIGS.map((config) => {
                      const current = selectedDays.get(config.dayOfWeek);
                      return (
                        <div
                          key={config.dayOfWeek}
                          className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[120px,1fr,1fr,2fr]"
                        >
                          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                            <input
                              type="checkbox"
                              name={`day_${config.dayOfWeek}_enabled`}
                              value="1"
                              defaultChecked={Boolean(current)}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                            {config.label}
                          </label>

                          <SoTFormField label="Start">
                            <SoTInput
                              type="time"
                              name={`day_${config.dayOfWeek}_start`}
                              defaultValue={
                                current ? minuteToTimeInput(current.startMinute) : "08:00"
                              }
                            />
                          </SoTFormField>

                          <SoTFormField label="End">
                            <SoTInput
                              type="time"
                              name={`day_${config.dayOfWeek}_end`}
                              defaultValue={
                                current ? minuteToTimeInput(current.endMinute) : "17:00"
                              }
                            />
                          </SoTFormField>

                          <SoTFormField label="Note">
                            <SoTInput
                              name={`day_${config.dayOfWeek}_note`}
                              defaultValue={current?.note ?? ""}
                              placeholder="Optional note for this generated day"
                            />
                          </SoTFormField>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <SoTButton type="submit" variant="primary">
                    {selectedTemplate ? "Save template" : "Create template"}
                  </SoTButton>
                  {selectedTemplate ? (
                    <Link
                      to="/store/workforce/schedule-templates"
                      className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      New template
                    </Link>
                  ) : null}
                </div>
              </Form>
            </SoTCard>

            <SoTCard interaction="form" className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Template Assignment
                </h2>
                <p className="text-xs text-slate-500">
                  Assign one template to many workers without rewriting prior generated rows.
                </p>
              </div>

              {selectedTemplate ? (
                <>
                  <Form method="post" className="space-y-4">
                    <input type="hidden" name="_intent" value="assign-workers" />
                    <input type="hidden" name="templateId" value={selectedTemplate.id} />

                    <div className="grid gap-3 md:grid-cols-2">
                      <SoTFormField label="Assignment effective from">
                        <SoTInput type="date" name="effectiveFrom" defaultValue={today} required />
                      </SoTFormField>

                      <SoTFormField label="Assignment effective to">
                        <SoTInput type="date" name="effectiveTo" />
                      </SoTFormField>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Workers
                      </div>
                      <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                        {workers.map((worker) => (
                          <label
                            key={worker.id}
                            className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          >
                            <input
                              type="checkbox"
                              name="workerIds"
                              value={worker.id}
                              className="mt-1 h-4 w-4 rounded border-slate-300"
                            />
                            <span>
                              <span className="block font-medium">{worker.label}</span>
                              <span className="block text-xs text-slate-500">
                                {worker.lane}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <SoTButton type="submit" variant="primary">
                      Assign selected workers
                    </SoTButton>
                  </Form>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Current assignments
                    </h3>
                    <SoTTable>
                      <SoTTableHead>
                        <SoTTableRow>
                          <SoTTh>Worker</SoTTh>
                          <SoTTh>Role</SoTTh>
                          <SoTTh>Effective range</SoTTh>
                          <SoTTh>Status</SoTTh>
                          <SoTTh>Action</SoTTh>
                        </SoTTableRow>
                      </SoTTableHead>
                      <tbody>
                        {selectedTemplate.assignments.length === 0 ? (
                          <SoTTableEmptyRow
                            colSpan={5}
                            message="No worker assignments yet."
                          />
                        ) : (
                          selectedTemplate.assignments.map((assignment) => (
                            <SoTTableRow key={assignment.id}>
                              <SoTTd>
                                {buildEmployeeLabel({
                                  firstName: assignment.worker.firstName,
                                  lastName: assignment.worker.lastName,
                                  alias: assignment.worker.alias ?? null,
                                  role: assignment.worker.user?.role ?? null,
                                })}
                              </SoTTd>
                              <SoTTd>{assignment.worker.user?.role ?? "UNASSIGNED"}</SoTTd>
                              <SoTTd>
                                {String(assignment.effectiveFrom).slice(0, 10)}
                                {" -> "}
                                {assignment.effectiveTo
                                  ? String(assignment.effectiveTo).slice(0, 10)
                                  : "open"}
                              </SoTTd>
                              <SoTTd>
                                <SoTStatusBadge tone={statusTone(assignment.status)}>
                                  {assignment.status}
                                </SoTStatusBadge>
                              </SoTTd>
                              <SoTTd>
                                <Form method="post" className="flex items-center gap-2">
                                  <input
                                    type="hidden"
                                    name="_intent"
                                    value="set-assignment-status"
                                  />
                                  <input
                                    type="hidden"
                                    name="assignmentId"
                                    value={assignment.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="templateId"
                                    value={selectedTemplate.id}
                                  />
                                  <SelectInput
                                    name="status"
                                    defaultValue={assignment.status}
                                    options={ASSIGNMENT_STATUS_OPTIONS}
                                  />
                                  <SoTButton type="submit" size="compact">
                                    Save
                                  </SoTButton>
                                </Form>
                              </SoTTd>
                            </SoTTableRow>
                          ))
                        )}
                      </tbody>
                    </SoTTable>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  Create or select a template first before assigning workers.
                </p>
              )}
            </SoTCard>
          </section>

          <aside className="space-y-5 lg:col-span-5">
            <SoTCard className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">Template Library</h2>
                <SoTStatusBadge tone="info">{templates.length} templates</SoTStatusBadge>
              </div>

              <SoTTable>
                <SoTTableHead>
                  <SoTTableRow>
                    <SoTTh>Template</SoTTh>
                    <SoTTh>Status</SoTTh>
                    <SoTTh>Actions</SoTTh>
                  </SoTTableRow>
                </SoTTableHead>
                <tbody>
                  {templates.length === 0 ? (
                    <SoTTableEmptyRow
                      colSpan={3}
                      message="No schedule templates yet."
                    />
                  ) : (
                    templates.map((template) => (
                      <SoTTableRow key={template.id}>
                        <SoTTd>
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {template.templateName}
                            </div>
                            <div className="text-xs text-slate-500">
                              {template.role ?? "ANY ROLE"} · {template.days.length} work day(s)
                            </div>
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <SoTStatusBadge tone={statusTone(template.status)}>
                            {template.status}
                          </SoTStatusBadge>
                        </SoTTd>
                        <SoTTd>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              to={`/store/workforce/schedule-templates?templateId=${template.id}`}
                              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Open
                            </Link>
                            <Form method="post">
                              <input type="hidden" name="_intent" value="set-template-status" />
                              <input type="hidden" name="templateId" value={template.id} />
                              <input
                                type="hidden"
                                name="status"
                                value={
                                  template.status === WORKER_SCHEDULE_TEMPLATE_STATUS.ACTIVE
                                    ? WORKER_SCHEDULE_TEMPLATE_STATUS.PAUSED
                                    : WORKER_SCHEDULE_TEMPLATE_STATUS.ACTIVE
                                }
                              />
                              <SoTButton type="submit" size="compact">
                                {template.status === WORKER_SCHEDULE_TEMPLATE_STATUS.ACTIVE
                                  ? "Pause"
                                  : "Activate"}
                              </SoTButton>
                            </Form>
                            <Form method="post">
                              <input type="hidden" name="_intent" value="set-template-status" />
                              <input type="hidden" name="templateId" value={template.id} />
                              <input
                                type="hidden"
                                name="status"
                                value={WORKER_SCHEDULE_TEMPLATE_STATUS.ENDED}
                              />
                              <SoTButton type="submit" size="compact" variant="danger">
                                End
                              </SoTButton>
                            </Form>
                          </div>
                        </SoTTd>
                      </SoTTableRow>
                    ))
                  )}
                </tbody>
              </SoTTable>
            </SoTCard>

            {selectedTemplate ? (
              <SoTCard className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-900">Selected template days</h2>
                <div className="space-y-2">
                  {selectedTemplate.days.map((day) => (
                    <div
                      key={day.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    >
                      <div className="font-medium">{day.dayOfWeek}</div>
                      <div className="text-xs text-slate-500">
                        {minuteToTimeInput(day.startMinute)} - {minuteToTimeInput(day.endMinute)}
                      </div>
                      {day.note ? (
                        <div className="mt-1 text-xs text-slate-500">{day.note}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </SoTCard>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
