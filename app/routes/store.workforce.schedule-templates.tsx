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
import { SelectInput } from "~/components/ui/SelectInput";
import { requireRole } from "~/utils/auth.server";
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

function humanizeEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRoleLabel(value: string | null) {
  if (!value) return "Any role";
  if (value === "UNASSIGNED") return "Unassigned";
  return humanizeEnumLabel(value);
}

function formatDayShortLabel(dayOfWeek: WorkerScheduleTemplateDayOfWeekValue) {
  const label = DAY_CONFIGS.find((config) => config.dayOfWeek === dayOfWeek)?.label;
  return label ? label.slice(0, 3) : humanizeEnumLabel(dayOfWeek).slice(0, 3);
}

function formatMinuteRange(startMinute: number, endMinute: number) {
  return `${minuteToTimeInput(startMinute)} - ${minuteToTimeInput(endMinute)}`;
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
  const isCreateMode = url.searchParams.get("create") === "1";
  const saved = url.searchParams.get("saved");

  const templates = await listWorkerScheduleTemplates();

  const selectedTemplate =
    selectedTemplateId == null
      ? null
      : templates.find((template) => template.id === selectedTemplateId) ?? null;

  return json({
    templates,
    selectedTemplate,
    saved,
    today: new Date().toISOString().slice(0, 10),
    isCreateMode,
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
      if (!templateId) throw new Error("Pattern is required.");
      if (!isWorkerScheduleTemplateStatusValue(status)) {
        throw new Error("Invalid pattern status.");
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

      if (!templateId) throw new Error("Select a pattern first.");

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
  const { templates, selectedTemplate, saved, today, isCreateMode } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const selectedDays = new Map(
    (selectedTemplate?.days ?? []).map((day) => [day.dayOfWeek, day]),
  );
  const editorOpen = isCreateMode || Boolean(selectedTemplate);
  const baseHref = "/store/workforce/schedule-templates";
  const savedMessage =
    saved === "template"
      ? "Staffing pattern saved."
      : saved === "status"
        ? "Pattern status updated."
        : null;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Named Staffing Pattern Library"
        subtitle="Reusable weekly staffing patterns for repeat shifts."
        backTo="/store"
        backLabel="Manager Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {savedMessage && !editorOpen ? (
          <SoTAlert tone="success">{savedMessage}</SoTAlert>
        ) : null}
        {actionData && !actionData.ok && !editorOpen ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <SoTCard className="border border-slate-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Pattern helper
              </div>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Use this only for repeat staffing patterns. Apply them later from the planner for
                the week window you want to build.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`${baseHref}?create=1`}
                className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Create pattern
              </Link>
              <Link
                to="/store/workforce/schedule-planner?preset=next-week"
                className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open planner to apply
              </Link>
            </div>
          </div>
        </SoTCard>

        <SoTCard className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Pattern library</h2>
              <p className="text-xs text-slate-500">
                Keep reusable shift patterns here, then adjust exceptions in the planner.
              </p>
            </div>
            <SoTStatusBadge tone="info">{templates.length} patterns</SoTStatusBadge>
          </div>

          {templates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
              <div>No staffing patterns yet.</div>
              <div className="mt-3">
                <Link
                  to={`${baseHref}?create=1`}
                  className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Create pattern
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={`rounded-2xl border p-4 ${
                    template.id === selectedTemplate?.id
                      ? "border-indigo-200 bg-indigo-50/50"
                      : "border-slate-200 bg-slate-50/70"
                  }`.trim()}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">{template.templateName}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatRoleLabel(template.role)} · {template.days.length} work day(s)
                      </div>
                    </div>
                    <SoTStatusBadge tone={statusTone(template.status)}>
                      {template.status}
                    </SoTStatusBadge>
                  </div>

                  {template.days.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {template.days.map((day) => (
                        <span
                          key={day.id}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600"
                        >
                          {formatDayShortLabel(day.dayOfWeek)} ·{" "}
                          {formatMinuteRange(day.startMinute, day.endMinute)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-slate-500">No days configured yet.</div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      to={`${baseHref}?templateId=${template.id}`}
                      className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {template.id === selectedTemplate?.id ? "Editing" : "Edit"}
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
                </div>
              ))}
            </div>
          )}
        </SoTCard>
      </div>

      {editorOpen ? (
        <>
          <Link
            to={baseHref}
            aria-label="Close pattern editor"
            className="fixed inset-0 z-40 bg-slate-900/35"
          />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="staffing-pattern-editor-title"
              className="relative max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl"
            >
              <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-2xl">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
                      Named staffing pattern
                    </div>
                    <h2
                      id="staffing-pattern-editor-title"
                      className="mt-1 text-xl font-semibold text-slate-900"
                    >
                      {selectedTemplate ? "Edit staffing pattern" : "Create staffing pattern"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Build the weekly shift pattern here. Apply it later from the planner where
                      the actual worker and date window are chosen.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    {selectedTemplate ? (
                      <SoTStatusBadge tone={statusTone(selectedTemplate.status)}>
                        {selectedTemplate.status}
                      </SoTStatusBadge>
                    ) : null}
                    <Link
                      to="/store/workforce/schedule-planner?preset=next-week"
                      className="inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open planner
                    </Link>
                    <Link
                      to={baseHref}
                      className="inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Close
                    </Link>
                  </div>
                </div>

                {savedMessage ? (
                  <div className="mt-4">
                    <SoTAlert tone="success">{savedMessage}</SoTAlert>
                  </div>
                ) : null}
                {actionData && !actionData.ok ? (
                  <div className="mt-4">
                    <SoTAlert tone="warning">{actionData.error}</SoTAlert>
                  </div>
                ) : null}
              </div>

              <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-5 py-5 sm:px-6">
                <Form
                  key={selectedTemplate?.id ?? "new"}
                  method="post"
                  className="space-y-5"
                >
                  <input type="hidden" name="_intent" value="save-template" />
                  <input type="hidden" name="templateId" value={selectedTemplate?.id ?? ""} />

                  <div className="grid gap-3 md:grid-cols-2">
                    <SoTFormField label="Pattern name">
                      <SoTInput
                        name="templateName"
                        defaultValue={selectedTemplate?.templateName ?? ""}
                        placeholder="Example: Opening Duty"
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
                      <h3 className="text-sm font-semibold text-slate-900">Weekly pattern</h3>
                      <p className="text-xs text-slate-500">
                        Turn on only the shift days this pattern should generate.
                      </p>
                    </div>

                    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50">
                      {DAY_CONFIGS.map((config, index) => {
                        const current = selectedDays.get(config.dayOfWeek);
                        return (
                          <div
                            key={config.dayOfWeek}
                            className={`px-4 py-4 ${
                              index > 0 ? "border-t border-slate-200" : ""
                            }`.trim()}
                          >
                            <div className="grid gap-4 lg:grid-cols-[140px,1fr] lg:items-start">
                              <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                  <input
                                    type="checkbox"
                                    name={`day_${config.dayOfWeek}_enabled`}
                                    value="1"
                                    defaultChecked={Boolean(current)}
                                    className="h-4 w-4 rounded border-slate-300"
                                  />
                                  {config.label}
                                </label>
                                <div className="pl-6">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                      current
                                        ? "bg-emerald-50 text-emerald-700"
                                        : "bg-slate-100 text-slate-500"
                                    }`}
                                  >
                                    {current ? "Shift day" : "Off"}
                                  </span>
                                </div>
                              </div>

                              <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4">
                                <div className="grid gap-3 md:grid-cols-[140px,140px] md:items-end">
                                  <SoTFormField label="Start time">
                                    <SoTInput
                                      type="time"
                                      name={`day_${config.dayOfWeek}_start`}
                                      defaultValue={
                                        current ? minuteToTimeInput(current.startMinute) : "08:00"
                                      }
                                    />
                                  </SoTFormField>

                                  <SoTFormField label="End time">
                                    <SoTInput
                                      type="time"
                                      name={`day_${config.dayOfWeek}_end`}
                                      defaultValue={
                                        current ? minuteToTimeInput(current.endMinute) : "17:00"
                                      }
                                    />
                                  </SoTFormField>
                                </div>

                                <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                    Shift note
                                  </div>
                                  <div className="mt-2">
                                    <SoTInput
                                      name={`day_${config.dayOfWeek}_note`}
                                      defaultValue={current?.note ?? ""}
                                      placeholder="Optional note"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
                    <SoTButton type="submit" variant="primary">
                      {selectedTemplate ? "Save pattern" : "Create pattern"}
                    </SoTButton>
                    <Link
                      to={baseHref}
                      className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </Link>
                  </div>
                </Form>

              </div>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
