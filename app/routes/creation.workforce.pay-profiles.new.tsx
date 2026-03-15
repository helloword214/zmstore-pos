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
import { SoTTextarea } from "~/components/ui/SoTTextarea";
import { SelectInput } from "~/components/ui/SelectInput";
import {
  listEmployeePayProfiles,
  listEmployeeStatutoryDeductionProfiles,
  upsertEmployeePayProfile,
  upsertEmployeeStatutoryDeductionProfile,
} from "~/services/worker-payroll-policy.server";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

type NormalizedPayProfile = {
  id: number;
  employeeId: number;
  dailyRate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
};

type NormalizedStatutoryProfile = {
  id: number;
  employeeId: number;
  sssAmount: number;
  philhealthAmount: number;
  pagIbigAmount: number;
  totalAmount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
};

function parseOptionalInt(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toDateOnly(value: Date | string) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const trimmed = value.trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (dateOnlyMatch) {
    const [, yearRaw, monthRaw, dayRaw] = dateOnlyMatch;
    return new Date(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }

  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  );
}

function addDays(value: Date | string, days: number) {
  const date = toDateOnly(value);
  date.setDate(date.getDate() + days);
  return date;
}

function formatDateInput(value: Date | string) {
  const date = toDateOnly(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(value: Date | string) {
  return toDateOnly(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function buildWorkerLabel(worker: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  const fullName = `${worker.firstName} ${worker.lastName}`.trim();
  return `${fullName}${worker.alias ? ` (${worker.alias})` : ""}`;
}

function peso(value: number | null) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function isEffectiveOnDate(
  profile: Pick<NormalizedPayProfile | NormalizedStatutoryProfile, "effectiveFrom" | "effectiveTo">,
  referenceDate: Date | string,
) {
  const date = toDateOnly(referenceDate).getTime();
  const start = toDateOnly(profile.effectiveFrom).getTime();
  const end =
    profile.effectiveTo == null
      ? Number.POSITIVE_INFINITY
      : toDateOnly(profile.effectiveTo).getTime();

  return date >= start && date <= end;
}

function toInputValue(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function suggestNextEffectiveFrom(
  profiles: Array<Pick<NormalizedPayProfile | NormalizedStatutoryProfile, "effectiveFrom">>,
  referenceDate: Date | string,
) {
  const usedDates = new Set(
    profiles.map((profile) => formatDateInput(profile.effectiveFrom)),
  );
  let candidate = toDateOnly(referenceDate);

  while (usedDates.has(formatDateInput(candidate))) {
    candidate = addDays(candidate, 1);
  }

  return formatDateInput(candidate);
}

function parsePositiveNumber(rawValue: string, label: string) {
  if (!rawValue.trim()) {
    throw new Error(`${label} is required.`);
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }

  return parsed;
}

function parseNonNegativeNumber(rawValue: string, label: string) {
  if (!rawValue.trim()) {
    return 0;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }

  return parsed;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);
  const requestedEmployeeId = parseOptionalInt(url.searchParams.get("employeeId"));
  const saved = url.searchParams.get("saved");

  const workersRaw = await db.employee.findMany({
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

  const selectedEmployee =
    workersRaw.find((worker) => worker.id === requestedEmployeeId) ??
    workersRaw[0] ??
    null;

  const [payProfilesRaw, statutoryProfilesRaw] = selectedEmployee
    ? await Promise.all([
        listEmployeePayProfiles({ employeeId: selectedEmployee.id }),
        listEmployeeStatutoryDeductionProfiles({
          employeeId: selectedEmployee.id,
        }),
      ])
    : [[], []];

  const payProfiles = payProfilesRaw.map((profile) => ({
    id: profile.id,
    employeeId: profile.employeeId,
    dailyRate: Number(profile.dailyRate),
    effectiveFrom: profile.effectiveFrom.toISOString(),
    effectiveTo: profile.effectiveTo?.toISOString() ?? null,
    note: profile.note ?? null,
  }));
  const statutoryProfiles = statutoryProfilesRaw.map((profile) => {
    const sssAmount = Number(profile.sssAmount);
    const philhealthAmount = Number(profile.philhealthAmount);
    const pagIbigAmount = Number(profile.pagIbigAmount);
    return {
      id: profile.id,
      employeeId: profile.employeeId,
      sssAmount,
      philhealthAmount,
      pagIbigAmount,
      totalAmount: sssAmount + philhealthAmount + pagIbigAmount,
      effectiveFrom: profile.effectiveFrom.toISOString(),
      effectiveTo: profile.effectiveTo?.toISOString() ?? null,
      note: profile.note ?? null,
    };
  });

  const currentPayProfile =
    payProfiles.find((profile) => isEffectiveOnDate(profile, new Date())) ?? null;
  const latestPayProfile = payProfiles[0] ?? null;
  const currentStatutoryProfile =
    statutoryProfiles.find((profile) => isEffectiveOnDate(profile, new Date())) ??
    null;
  const latestStatutoryProfile = statutoryProfiles[0] ?? null;

  return json({
    saved,
    workers: workersRaw.map((worker) => ({
      id: worker.id,
      label: buildWorkerLabel(worker),
      role: worker.user?.role ?? "UNASSIGNED",
    })),
    selectedEmployee: selectedEmployee
      ? {
          id: selectedEmployee.id,
          label: buildWorkerLabel(selectedEmployee),
          role: selectedEmployee.user?.role ?? "UNASSIGNED",
        }
      : null,
    payProfiles,
    latestPayProfile,
    currentPayProfile,
    statutoryProfiles,
    latestStatutoryProfile,
    currentStatutoryProfile,
    suggestedPayEffectiveFrom: suggestNextEffectiveFrom(payProfiles, new Date()),
    suggestedStatutoryEffectiveFrom: suggestNextEffectiveFrom(
      statutoryProfiles,
      new Date(),
    ),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");

  try {
    if (intent === "create-pay-profile") {
      const employeeId = parseOptionalInt(String(fd.get("employeeId") || ""));
      const dailyRateRaw = String(fd.get("dailyRate") || "").trim();
      const effectiveFrom = String(fd.get("effectiveFrom") || "").trim();
      const effectiveTo = String(fd.get("effectiveTo") || "").trim();
      const note = String(fd.get("note") || "");

      if (!employeeId) {
        throw new Error("Select an employee before creating a salary row.");
      }
      if (!effectiveFrom) {
        throw new Error("Effective-from date is required.");
      }

      const effectiveFromDate = toDateOnly(effectiveFrom);
      const effectiveToDate = effectiveTo ? toDateOnly(effectiveTo) : null;
      if (effectiveToDate && effectiveToDate < effectiveFromDate) {
        throw new Error("Effective-to date must be on or after effective-from date.");
      }

      const profile = await upsertEmployeePayProfile({
        employeeId,
        dailyRate: parsePositiveNumber(dailyRateRaw, "Daily rate"),
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        note,
        actorUserId: me.userId,
      });

      return redirect(
        `/creation/workforce/pay-profiles/${profile.id}/edit?saved=salary-created`,
      );
    }

    if (intent === "create-statutory-profile") {
      const employeeId = parseOptionalInt(String(fd.get("employeeId") || ""));
      const sssAmountRaw = String(fd.get("sssAmount") || "").trim();
      const philhealthAmountRaw = String(fd.get("philhealthAmount") || "").trim();
      const pagIbigAmountRaw = String(fd.get("pagIbigAmount") || "").trim();
      const effectiveFrom = String(fd.get("effectiveFrom") || "").trim();
      const effectiveTo = String(fd.get("effectiveTo") || "").trim();
      const note = String(fd.get("note") || "");

      if (!employeeId) {
        throw new Error(
          "Select an employee before creating a government-deduction row.",
        );
      }
      if (!effectiveFrom) {
        throw new Error("Effective-from date is required.");
      }

      const effectiveFromDate = toDateOnly(effectiveFrom);
      const effectiveToDate = effectiveTo ? toDateOnly(effectiveTo) : null;
      if (effectiveToDate && effectiveToDate < effectiveFromDate) {
        throw new Error("Effective-to date must be on or after effective-from date.");
      }

      await upsertEmployeeStatutoryDeductionProfile({
        employeeId,
        sssAmount: parseNonNegativeNumber(sssAmountRaw, "SSS amount"),
        philhealthAmount: parseNonNegativeNumber(
          philhealthAmountRaw,
          "PhilHealth amount",
        ),
        pagIbigAmount: parseNonNegativeNumber(
          pagIbigAmountRaw,
          "Pag-IBIG amount",
        ),
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        note,
        actorUserId: me.userId,
      });

      return redirect(
        `/creation/workforce/pay-profiles/new?employeeId=${employeeId}&saved=deduction-created`,
      );
    }

    return json<ActionData>({
      ok: false,
      error: "Unsupported action.",
      action: intent,
    });
  } catch (error) {
    return json<ActionData>({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save payroll setup.",
      action: intent,
    });
  }
}

export default function PayProfilesCreateRoute() {
  const {
    saved,
    workers,
    selectedEmployee,
    payProfiles,
    latestPayProfile,
    currentPayProfile,
    statutoryProfiles,
    latestStatutoryProfile,
    currentStatutoryProfile,
    suggestedPayEffectiveFrom,
    suggestedStatutoryEffectiveFrom,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const formKey = selectedEmployee?.id ?? "none";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Add Salary Change"
        subtitle="Create a new daily salary row for one employee. Government deductions are tracked in their own section below."
        backTo="/creation/workforce/pay-profiles"
        backLabel="Payroll Setup List"
      />

      <div className="mx-auto max-w-5xl space-y-5 px-5 py-6">
        {saved === "deduction-created" ? (
          <SoTAlert tone="success">Government-deduction row saved.</SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <SoTCard className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Employee</h2>
              <p className="text-xs text-slate-500">
                Pick the employee first, then create the next daily salary row
                or the next government-deduction row.
              </p>
            </div>
            <Form
              method="get"
              className="grid gap-3 md:grid-cols-[minmax(0,320px),auto]"
            >
              <SoTFormField label="Employee">
                <SelectInput
                  name="employeeId"
                  defaultValue={selectedEmployee?.id ?? ""}
                  options={workers.map((worker) => ({
                    value: worker.id,
                    label: `${worker.label} · ${worker.role}`,
                  }))}
                />
              </SoTFormField>
              <div className="flex items-end">
                <SoTButton type="submit" variant="primary">
                  Open employee
                </SoTButton>
              </div>
            </Form>
          </div>
        </SoTCard>

        {selectedEmployee ? (
          <>
            <SoTCard className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {selectedEmployee.label}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {selectedEmployee.role}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SoTStatusBadge
                    tone={currentPayProfile ? "success" : latestPayProfile ? "info" : "warning"}
                  >
                    {currentPayProfile
                      ? "HAS CURRENT SALARY"
                      : latestPayProfile
                        ? "HAS SALARY HISTORY"
                        : "NO SALARY YET"}
                  </SoTStatusBadge>
                  <SoTStatusBadge
                    tone={
                      currentStatutoryProfile
                        ? "success"
                        : latestStatutoryProfile
                          ? "info"
                          : "warning"
                    }
                  >
                    {currentStatutoryProfile
                      ? "HAS CURRENT DEDUCTIONS"
                      : latestStatutoryProfile
                        ? "HAS DEDUCTION HISTORY"
                        : "NO DEDUCTIONS YET"}
                  </SoTStatusBadge>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Current salary
                  </div>
                  <div className="mt-1 text-sm text-slate-900">
                    {currentPayProfile
                      ? `Daily rate ${peso(currentPayProfile.dailyRate)}`
                      : "None"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {currentPayProfile
                      ? `Effective ${formatDateLabel(currentPayProfile.effectiveFrom)}`
                      : "No active salary row today."}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Current deductions
                  </div>
                  <div className="mt-1 text-sm text-slate-900">
                    {currentStatutoryProfile
                      ? `Total ${peso(currentStatutoryProfile.totalAmount)}`
                      : "None"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {currentStatutoryProfile
                      ? `SSS ${peso(currentStatutoryProfile.sssAmount)} · PhilHealth ${peso(
                          currentStatutoryProfile.philhealthAmount,
                        )} · Pag-IBIG ${peso(currentStatutoryProfile.pagIbigAmount)}`
                      : "No active government-deduction row today."}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Correction lane
                  </div>
                  <div className="mt-1 text-sm text-slate-900">
                    {latestPayProfile
                      ? "Need to correct the latest salary row?"
                      : "First salary setup is created below."}
                  </div>
                  <div className="mt-2">
                    {latestPayProfile ? (
                      <Link
                        to={`/creation/workforce/pay-profiles/${latestPayProfile.id}/edit`}
                        className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit latest row
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500">
                        Save the first salary row below.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </SoTCard>

            <SoTCard className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  New daily salary row
                </h2>
                <p className="text-xs text-slate-500">
                  Salary setup is now daily-rate only. Half-day payroll stays on
                  the fixed `0.5` factor behind the scenes.
                </p>
              </div>

              <Form key={formKey} method="post" className="space-y-4">
                <input type="hidden" name="_intent" value="create-pay-profile" />
                <input type="hidden" name="employeeId" value={selectedEmployee.id} />

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Daily rate">
                    <SoTInput
                      name="dailyRate"
                      inputMode="decimal"
                      defaultValue={toInputValue(latestPayProfile?.dailyRate)}
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Effective from">
                    <SoTInput
                      type="date"
                      name="effectiveFrom"
                      defaultValue={suggestedPayEffectiveFrom}
                      required
                    />
                  </SoTFormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Effective to">
                    <SoTInput type="date" name="effectiveTo" defaultValue="" />
                  </SoTFormField>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    Open-ended is the default. When you add a new current salary
                    row later, the system will auto-close the previous open row
                    to the day before the new effectivity starts.
                  </div>
                </div>

                <SoTTextarea
                  name="note"
                  label="Salary note"
                  rows={3}
                  defaultValue=""
                  placeholder="Reason for onboarding rate, increase, or approved daily-rate change"
                />

                <div className="flex flex-wrap gap-2">
                  <SoTButton type="submit" variant="primary">
                    {latestPayProfile
                      ? "Add salary change"
                      : "Create initial salary"}
                  </SoTButton>
                  <Link
                    to="/creation/workforce/pay-profiles"
                    className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Back to list
                  </Link>
                </div>
              </Form>
            </SoTCard>

            <SoTCard className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Government deductions
                </h2>
                <p className="text-xs text-slate-500">
                  These are employee-specific amounts. Company policy only
                  decides whether SSS, PhilHealth, and Pag-IBIG are included in
                  payroll runs.
                </p>
              </div>

              <Form method="post" className="space-y-4">
                <input
                  type="hidden"
                  name="_intent"
                  value="create-statutory-profile"
                />
                <input type="hidden" name="employeeId" value={selectedEmployee.id} />

                <div className="grid gap-3 md:grid-cols-3">
                  <SoTFormField label="SSS amount">
                    <SoTInput
                      name="sssAmount"
                      inputMode="decimal"
                      defaultValue={toInputValue(latestStatutoryProfile?.sssAmount)}
                    />
                  </SoTFormField>
                  <SoTFormField label="PhilHealth amount">
                    <SoTInput
                      name="philhealthAmount"
                      inputMode="decimal"
                      defaultValue={toInputValue(
                        latestStatutoryProfile?.philhealthAmount,
                      )}
                    />
                  </SoTFormField>
                  <SoTFormField label="Pag-IBIG amount">
                    <SoTInput
                      name="pagIbigAmount"
                      inputMode="decimal"
                      defaultValue={toInputValue(latestStatutoryProfile?.pagIbigAmount)}
                    />
                  </SoTFormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Effective from">
                    <SoTInput
                      type="date"
                      name="effectiveFrom"
                      defaultValue={suggestedStatutoryEffectiveFrom}
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Effective to">
                    <SoTInput type="date" name="effectiveTo" defaultValue="" />
                  </SoTFormField>
                </div>

                <SoTTextarea
                  name="note"
                  label="Government deduction note"
                  rows={3}
                  defaultValue=""
                  placeholder="Reason for contribution change or new approved employee share"
                />

                <SoTButton type="submit" variant="primary">
                  {latestStatutoryProfile
                    ? "Add deduction change"
                    : "Create deduction setup"}
                </SoTButton>
              </Form>
            </SoTCard>

            <div className="grid gap-5 lg:grid-cols-2">
              <SoTCard className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Salary history
                  </h2>
                  <p className="text-xs text-slate-500">
                    Review earlier daily-rate rows before creating another one.
                  </p>
                </div>

                <SoTTable compact>
                  <SoTTableHead>
                    <SoTTableRow>
                      <SoTTh>Effective</SoTTh>
                      <SoTTh>Daily rate</SoTTh>
                      <SoTTh>Action</SoTTh>
                    </SoTTableRow>
                  </SoTTableHead>
                  <tbody>
                    {payProfiles.length === 0 ? (
                      <SoTTableEmptyRow
                        colSpan={3}
                        message="No salary rows for this employee yet."
                      />
                    ) : (
                      payProfiles.map((profile) => (
                        <SoTTableRow key={profile.id}>
                          <SoTTd>
                            <div className="space-y-1">
                              <div className="font-medium text-slate-900">
                                {formatDateLabel(profile.effectiveFrom)}
                              </div>
                              <div className="text-xs text-slate-500">
                                {profile.effectiveTo
                                  ? `to ${formatDateLabel(profile.effectiveTo)}`
                                  : "open-ended"}
                              </div>
                              {currentPayProfile?.id === profile.id ? (
                                <SoTStatusBadge tone="success">CURRENT</SoTStatusBadge>
                              ) : null}
                            </div>
                          </SoTTd>
                          <SoTTd>{peso(profile.dailyRate)}</SoTTd>
                          <SoTTd>
                            <Link
                              to={`/creation/workforce/pay-profiles/${profile.id}/edit`}
                              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Edit row
                            </Link>
                          </SoTTd>
                        </SoTTableRow>
                      ))
                    )}
                  </tbody>
                </SoTTable>
              </SoTCard>

              <SoTCard className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Deduction history
                  </h2>
                  <p className="text-xs text-slate-500">
                    These rows are separate from salary changes and use their own
                    effectivity window.
                  </p>
                </div>

                <SoTTable compact>
                  <SoTTableHead>
                    <SoTTableRow>
                      <SoTTh>Effective</SoTTh>
                      <SoTTh>Total</SoTTh>
                      <SoTTh>Breakdown</SoTTh>
                    </SoTTableRow>
                  </SoTTableHead>
                  <tbody>
                    {statutoryProfiles.length === 0 ? (
                      <SoTTableEmptyRow
                        colSpan={3}
                        message="No government-deduction rows for this employee yet."
                      />
                    ) : (
                      statutoryProfiles.map((profile) => (
                        <SoTTableRow key={profile.id}>
                          <SoTTd>
                            <div className="space-y-1">
                              <div className="font-medium text-slate-900">
                                {formatDateLabel(profile.effectiveFrom)}
                              </div>
                              <div className="text-xs text-slate-500">
                                {profile.effectiveTo
                                  ? `to ${formatDateLabel(profile.effectiveTo)}`
                                  : "open-ended"}
                              </div>
                              {currentStatutoryProfile?.id === profile.id ? (
                                <SoTStatusBadge tone="success">CURRENT</SoTStatusBadge>
                              ) : null}
                            </div>
                          </SoTTd>
                          <SoTTd>{peso(profile.totalAmount)}</SoTTd>
                          <SoTTd>
                            <div className="space-y-1 text-xs text-slate-600">
                              <div>SSS {peso(profile.sssAmount)}</div>
                              <div>PhilHealth {peso(profile.philhealthAmount)}</div>
                              <div>Pag-IBIG {peso(profile.pagIbigAmount)}</div>
                            </div>
                          </SoTTd>
                        </SoTTableRow>
                      ))
                    )}
                  </tbody>
                </SoTTable>
              </SoTCard>
            </div>
          </>
        ) : (
          <SoTCard>
            <p className="text-sm text-slate-600">
              No active employees were found, so payroll setup is unavailable.
            </p>
          </SoTCard>
        )}
      </div>
    </main>
  );
}
