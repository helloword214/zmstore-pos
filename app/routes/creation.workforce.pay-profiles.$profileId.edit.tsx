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
  employeeLabel: string;
  employeeRole: string;
  dailyRate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  updatedByLabel: string;
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
  updatedByLabel: string;
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

function actorLabel(actor: {
  email: string | null;
  employee: { firstName: string; lastName: string; alias: string | null } | null;
} | null) {
  if (!actor) return "Unknown actor";
  if (actor.employee) {
    const fullName =
      `${actor.employee.firstName} ${actor.employee.lastName}`.trim();
    return actor.employee.alias
      ? `${actor.employee.alias} (${fullName})`
      : fullName;
  }
  return actor.email ?? "Unknown actor";
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

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);
  const saved = url.searchParams.get("saved");
  const profileId = parseOptionalInt(params.profileId ?? null);

  if (!profileId) {
    throw new Response("Salary row not found.", { status: 404 });
  }

  const selectedRaw = await db.employeePayProfile.findUnique({
    where: { id: profileId },
    include: {
      employee: {
        include: {
          user: {
            select: { role: true },
          },
        },
      },
      updatedBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
    },
  });

  if (!selectedRaw) {
    throw new Response("Salary row not found.", { status: 404 });
  }

  const [payProfilesRaw, statutoryProfilesRaw] = await Promise.all([
    listEmployeePayProfiles({
      employeeId: selectedRaw.employeeId,
    }),
    listEmployeeStatutoryDeductionProfiles({
      employeeId: selectedRaw.employeeId,
    }),
  ]);

  const payProfiles = payProfilesRaw.map((profile) => ({
    id: profile.id,
    employeeId: profile.employeeId,
    employeeLabel: buildWorkerLabel(profile.employee),
    employeeRole: profile.employee.user?.role ?? "UNASSIGNED",
    dailyRate: Number(profile.dailyRate),
    effectiveFrom: profile.effectiveFrom.toISOString(),
    effectiveTo: profile.effectiveTo?.toISOString() ?? null,
    note: profile.note ?? null,
    updatedByLabel: actorLabel(profile.updatedBy),
  }));
  const selectedProfile =
    payProfiles.find((profile) => profile.id === profileId) ?? null;
  if (!selectedProfile) {
    throw new Response("Salary row not found.", { status: 404 });
  }

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
      updatedByLabel: actorLabel(profile.updatedBy),
    };
  });

  const currentPayProfileId =
    payProfiles.find((profile) => isEffectiveOnDate(profile, new Date()))?.id ?? null;
  const selectedStatutoryProfile =
    statutoryProfiles.find((profile) => isEffectiveOnDate(profile, new Date())) ??
    statutoryProfiles[0] ??
    null;

  return json({
    saved,
    selectedProfile,
    payProfiles,
    currentPayProfileId,
    selectedStatutoryProfile,
    statutoryProfiles,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const me = await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  const routeProfileId = parseOptionalInt(params.profileId ?? null);

  try {
    if (intent === "save-pay-profile") {
      const profileId = parseOptionalInt(String(fd.get("profileId") || ""));
      const employeeId = parseOptionalInt(String(fd.get("employeeId") || ""));
      const dailyRateRaw = String(fd.get("dailyRate") || "").trim();
      const effectiveFrom = String(fd.get("effectiveFrom") || "").trim();
      const effectiveTo = String(fd.get("effectiveTo") || "").trim();
      const note = String(fd.get("note") || "");

      if (!routeProfileId || !profileId || routeProfileId !== profileId) {
        throw new Error("Selected salary row is missing.");
      }
      if (!employeeId) {
        throw new Error("Employee is required.");
      }
      if (!effectiveFrom) {
        throw new Error("Effective-from date is required.");
      }

      const effectiveFromDate = toDateOnly(effectiveFrom);
      const effectiveToDate = effectiveTo ? toDateOnly(effectiveTo) : null;
      if (effectiveToDate && effectiveToDate < effectiveFromDate) {
        throw new Error("Effective-to date must be on or after effective-from date.");
      }

      await upsertEmployeePayProfile({
        id: profileId,
        employeeId,
        dailyRate: parsePositiveNumber(dailyRateRaw, "Daily rate"),
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        note,
        actorUserId: me.userId,
      });

      return redirect(
        `/creation/workforce/pay-profiles/${profileId}/edit?saved=salary-updated`,
      );
    }

    if (intent === "save-statutory-profile") {
      if (!routeProfileId) {
        throw new Error("Selected salary row is missing.");
      }

      const profileId = parseOptionalInt(String(fd.get("profileId") || ""));
      const employeeId = parseOptionalInt(String(fd.get("employeeId") || ""));
      const sssAmountRaw = String(fd.get("sssAmount") || "").trim();
      const philhealthAmountRaw = String(fd.get("philhealthAmount") || "").trim();
      const pagIbigAmountRaw = String(fd.get("pagIbigAmount") || "").trim();
      const effectiveFrom = String(fd.get("effectiveFrom") || "").trim();
      const effectiveTo = String(fd.get("effectiveTo") || "").trim();
      const note = String(fd.get("note") || "");

      if (!employeeId) {
        throw new Error("Employee is required.");
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
        id: profileId ?? undefined,
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
        `/creation/workforce/pay-profiles/${routeProfileId}/edit?saved=deduction-updated`,
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

export default function PayProfilesEditRoute() {
  const {
    saved,
    selectedProfile,
    payProfiles,
    currentPayProfileId,
    selectedStatutoryProfile,
    statutoryProfiles,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Edit Salary Row"
        subtitle="Correct the selected salary row only. Government deductions are managed separately below for the same employee."
        backTo="/creation/workforce/pay-profiles"
        backLabel="Payroll Setup List"
      />

      <div className="mx-auto max-w-5xl space-y-5 px-5 py-6">
        {saved === "salary-created" ? (
          <SoTAlert tone="success">New salary change saved.</SoTAlert>
        ) : null}
        {saved === "salary-updated" ? (
          <SoTAlert tone="success">Salary row updated.</SoTAlert>
        ) : null}
        {saved === "deduction-updated" ? (
          <SoTAlert tone="success">
            Government-deduction setup saved.
          </SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <SoTCard className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-slate-900">
                {selectedProfile.employeeLabel}
              </h2>
              <p className="text-xs text-slate-500">
                {selectedProfile.employeeRole}
              </p>
            </div>
            <SoTStatusBadge
              tone={currentPayProfileId === selectedProfile.id ? "success" : "info"}
            >
              {currentPayProfileId === selectedProfile.id
                ? "CURRENT SALARY ROW"
                : "HISTORICAL SALARY ROW"}
            </SoTStatusBadge>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Salary window
              </div>
              <div className="mt-1 text-sm text-slate-900">
                {formatDateLabel(selectedProfile.effectiveFrom)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {selectedProfile.effectiveTo
                  ? `Until ${formatDateLabel(selectedProfile.effectiveTo)}`
                  : "Open-ended"}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Daily rate
              </div>
              <div className="mt-1 text-sm text-slate-900">
                {peso(selectedProfile.dailyRate)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Last updated by {selectedProfile.updatedByLabel}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Next action
              </div>
              <div className="mt-1 text-sm text-slate-900">
                Need a new approved rate instead of a correction?
              </div>
              <div className="mt-2">
                <Link
                  to={`/creation/workforce/pay-profiles/new?employeeId=${selectedProfile.employeeId}`}
                  className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Add salary change
                </Link>
              </div>
            </div>
          </div>
        </SoTCard>

        <SoTCard className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Edit selected salary row
            </h2>
            <p className="text-xs text-slate-500">
              This page corrects the salary row you opened. It does not create a
              new salary effectivity version.
            </p>
          </div>

          <Form key={selectedProfile.id} method="post" className="space-y-4">
            <input type="hidden" name="_intent" value="save-pay-profile" />
            <input type="hidden" name="profileId" value={selectedProfile.id} />
            <input type="hidden" name="employeeId" value={selectedProfile.employeeId} />

            <div className="grid gap-3 md:grid-cols-2">
              <SoTFormField label="Daily rate">
                <SoTInput
                  name="dailyRate"
                  inputMode="decimal"
                  defaultValue={String(selectedProfile.dailyRate)}
                  required
                />
              </SoTFormField>
              <SoTFormField label="Effective from">
                <SoTInput
                  type="date"
                  name="effectiveFrom"
                  defaultValue={formatDateInput(selectedProfile.effectiveFrom)}
                  required
                />
              </SoTFormField>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <SoTFormField label="Effective to">
                <SoTInput
                  type="date"
                  name="effectiveTo"
                  defaultValue={
                    selectedProfile.effectiveTo
                      ? formatDateInput(selectedProfile.effectiveTo)
                      : ""
                  }
                />
              </SoTFormField>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                Half-day payroll remains fixed at `0.5`. Daily-rate changes are
                what you edit here.
              </div>
            </div>

            <SoTTextarea
              name="note"
              label="Salary note"
              rows={3}
              defaultValue={selectedProfile.note ?? ""}
              placeholder="Reason for correction or approved salary adjustment"
            />

            <div className="flex flex-wrap gap-2">
              <SoTButton type="submit" variant="primary">
                Save salary changes
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
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Government deductions for this employee
              </h2>
              <p className="text-xs text-slate-500">
                These rows are employee-level payroll deductions. They are not
                tied to the salary row you opened above.
              </p>
            </div>
            {selectedStatutoryProfile ? (
              <SoTStatusBadge tone="info">
                Editing {formatDateLabel(selectedStatutoryProfile.effectiveFrom)}
              </SoTStatusBadge>
            ) : (
              <SoTStatusBadge tone="warning">NO DEDUCTION ROW</SoTStatusBadge>
            )}
          </div>

          <Form method="post" className="space-y-4">
            <input type="hidden" name="_intent" value="save-statutory-profile" />
            <input
              type="hidden"
              name="profileId"
              value={selectedStatutoryProfile?.id ?? ""}
            />
            <input type="hidden" name="employeeId" value={selectedProfile.employeeId} />

            <div className="grid gap-3 md:grid-cols-3">
              <SoTFormField label="SSS amount">
                <SoTInput
                  name="sssAmount"
                  inputMode="decimal"
                  defaultValue={String(selectedStatutoryProfile?.sssAmount ?? 0)}
                />
              </SoTFormField>
              <SoTFormField label="PhilHealth amount">
                <SoTInput
                  name="philhealthAmount"
                  inputMode="decimal"
                  defaultValue={String(selectedStatutoryProfile?.philhealthAmount ?? 0)}
                />
              </SoTFormField>
              <SoTFormField label="Pag-IBIG amount">
                <SoTInput
                  name="pagIbigAmount"
                  inputMode="decimal"
                  defaultValue={String(selectedStatutoryProfile?.pagIbigAmount ?? 0)}
                />
              </SoTFormField>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <SoTFormField label="Effective from">
                <SoTInput
                  type="date"
                  name="effectiveFrom"
                  defaultValue={
                    selectedStatutoryProfile
                      ? formatDateInput(selectedStatutoryProfile.effectiveFrom)
                      : formatDateInput(new Date())
                  }
                  required
                />
              </SoTFormField>
              <SoTFormField label="Effective to">
                <SoTInput
                  type="date"
                  name="effectiveTo"
                  defaultValue={
                    selectedStatutoryProfile?.effectiveTo
                      ? formatDateInput(selectedStatutoryProfile.effectiveTo)
                      : ""
                  }
                />
              </SoTFormField>
            </div>

            <SoTTextarea
              name="note"
              label="Government deduction note"
              rows={3}
              defaultValue={selectedStatutoryProfile?.note ?? ""}
              placeholder="Reason for contribution correction or approved new employee share"
            />

            <div className="flex flex-wrap gap-2">
              <SoTButton type="submit" variant="primary">
                {selectedStatutoryProfile
                  ? "Save government deductions"
                  : "Create deduction setup"}
              </SoTButton>
              <Link
                to={`/creation/workforce/pay-profiles/new?employeeId=${selectedProfile.employeeId}`}
                className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Add deduction change
              </Link>
            </div>
          </Form>
        </SoTCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <SoTCard className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Salary history
              </h2>
              <p className="text-xs text-slate-500">
                Open another row only when you want to correct that exact salary
                history record.
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
                    message="No salary rows found for this employee."
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
                          {currentPayProfileId === profile.id ? (
                            <SoTStatusBadge tone="success">CURRENT</SoTStatusBadge>
                          ) : null}
                        </div>
                      </SoTTd>
                      <SoTTd>{peso(profile.dailyRate)}</SoTTd>
                      <SoTTd>
                        {profile.id === selectedProfile.id ? (
                          <span className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm font-medium text-slate-600">
                            Editing
                          </span>
                        ) : (
                          <Link
                            to={`/creation/workforce/pay-profiles/${profile.id}/edit`}
                            className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Edit row
                          </Link>
                        )}
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
                This panel helps you review the employee&apos;s deduction history
                while editing salary data.
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
                    message="No government-deduction rows found for this employee."
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
                          {selectedStatutoryProfile?.id === profile.id ? (
                            <SoTStatusBadge tone="info">OPEN IN FORM</SoTStatusBadge>
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
      </div>
    </main>
  );
}
