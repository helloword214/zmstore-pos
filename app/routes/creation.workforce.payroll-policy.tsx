import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useOutlet } from "@remix-run/react";
import { SoTCard } from "~/components/ui/SoTCard";
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
import {
  getEffectiveCompanyPayrollPolicy,
  listCompanyPayrollPolicies,
} from "~/services/worker-payroll-policy.server";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type NormalizedPolicy = {
  id: number;
  effectiveFrom: string;
  payFrequency: string;
  customCutoffNote: string | null;
  attendanceIncentiveEnabled: boolean;
  attendanceIncentiveAmount: number;
  attendanceIncentiveRequireNoLate: boolean;
  attendanceIncentiveRequireNoAbsent: boolean;
  attendanceIncentiveRequireNoSuspension: boolean;
  sssDeductionEnabled: boolean;
  philhealthDeductionEnabled: boolean;
  pagIbigDeductionEnabled: boolean;
  allowManagerOverride: boolean;
  sickLeavePayTreatment: string;
  restDayWorkedPremiumPercent: number;
  regularHolidayWorkedPremiumPercent: number;
  specialHolidayWorkedPremiumPercent: number;
  updatedByLabel: string;
};

function parseCalendarDateParts(value: Date | string) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid date input.");
    }

    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  const trimmed = value.trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(trimmed);
  if (dateOnlyMatch) {
    const [, yearRaw, monthRaw, dayRaw] = dateOnlyMatch;
    return {
      year: Number(yearRaw),
      month: Number(monthRaw),
      day: Number(dayRaw),
    };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }

  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
  };
}

function toDateOnly(value: Date | string) {
  const { year, month, day } = parseCalendarDateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateLabel(value: Date | string) {
  return toDateOnly(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function peso(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number.isFinite(value) ? value : 0);
}

function boolLabel(value: boolean) {
  return value ? "Yes" : "No";
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

function statusMeta(
  policy: Pick<NormalizedPolicy, "id" | "effectiveFrom">,
  currentPolicyId: number | null,
  today: Date,
) {
  if (policy.id === currentPolicyId) {
    return { label: "CURRENT", tone: "success" as const };
  }

  if (toDateOnly(policy.effectiveFrom).getTime() > today.getTime()) {
    return { label: "FUTURE", tone: "info" as const };
  }

  return { label: "HISTORY", tone: "warning" as const };
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);

  const today = toDateOnly(new Date());
  const [policiesRaw, currentPolicyRaw] = await Promise.all([
    listCompanyPayrollPolicies(),
    getEffectiveCompanyPayrollPolicy(db, today),
  ]);

  const policies = policiesRaw.map((policy) => ({
    id: policy.id,
    effectiveFrom: policy.effectiveFrom.toISOString(),
    payFrequency: policy.payFrequency,
    customCutoffNote: policy.customCutoffNote ?? null,
    attendanceIncentiveEnabled: policy.attendanceIncentiveEnabled,
    attendanceIncentiveAmount: Number(policy.attendanceIncentiveAmount),
    attendanceIncentiveRequireNoLate: policy.attendanceIncentiveRequireNoLate,
    attendanceIncentiveRequireNoAbsent:
      policy.attendanceIncentiveRequireNoAbsent,
    attendanceIncentiveRequireNoSuspension:
      policy.attendanceIncentiveRequireNoSuspension,
    sssDeductionEnabled: policy.sssDeductionEnabled,
    philhealthDeductionEnabled: policy.philhealthDeductionEnabled,
    pagIbigDeductionEnabled: policy.pagIbigDeductionEnabled,
    allowManagerOverride: policy.allowManagerOverride,
    sickLeavePayTreatment: policy.sickLeavePayTreatment,
    restDayWorkedPremiumPercent: Number(policy.restDayWorkedPremiumPercent),
    regularHolidayWorkedPremiumPercent: Number(
      policy.regularHolidayWorkedPremiumPercent,
    ),
    specialHolidayWorkedPremiumPercent: Number(
      policy.specialHolidayWorkedPremiumPercent,
    ),
    updatedByLabel: actorLabel(policy.updatedBy),
  }));

  const currentPolicy =
    policies.find((policy) => policy.id === currentPolicyRaw?.id) ?? null;

  return json({
    policies,
    currentPolicy,
    currentPolicyId: currentPolicyRaw?.id ?? null,
    todayIso: today.toISOString(),
  });
}

export default function PayrollPolicyDirectoryRoute() {
  const outlet = useOutlet();
  const { policies, currentPolicy, currentPolicyId, todayIso } =
    useLoaderData<typeof loader>();

  if (outlet) {
    return outlet;
  }

  const today = toDateOnly(todayIso);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Payroll Policy History"
        subtitle="Overview of effective-dated payroll policy rows. Create a new policy row for future effectivity, or open an existing row only when you need to correct it."
        backTo="/"
        backLabel="Admin Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        <div className="grid gap-5 lg:grid-cols-12">
          <section className="space-y-5 lg:col-span-7">
            <SoTCard className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Current payroll defaults
                  </h2>
                  <p className="text-xs text-slate-500">
                    This is the policy row payroll will snapshot today. New rows
                    should be used for future effectivity changes.
                  </p>
                </div>
                <Link
                  to="/creation/workforce/payroll-policy/new"
                  className="inline-flex h-9 items-center rounded-xl bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Add policy row
                </Link>
              </div>

              {currentPolicy ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Effective from
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {formatDateLabel(currentPolicy.effectiveFrom)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Frequency {currentPolicy.payFrequency} · Sick leave{" "}
                      {currentPolicy.sickLeavePayTreatment.toLowerCase()}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Government deductions
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      SSS {boolLabel(currentPolicy.sssDeductionEnabled)} · PH{" "}
                      {boolLabel(currentPolicy.philhealthDeductionEnabled)} · PI{" "}
                      {boolLabel(currentPolicy.pagIbigDeductionEnabled)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Manager override {boolLabel(currentPolicy.allowManagerOverride)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Attendance incentive
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      {boolLabel(currentPolicy.attendanceIncentiveEnabled)} ·{" "}
                      {peso(currentPolicy.attendanceIncentiveAmount)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      No late {boolLabel(currentPolicy.attendanceIncentiveRequireNoLate)}
                      {" · "}No absent{" "}
                      {boolLabel(currentPolicy.attendanceIncentiveRequireNoAbsent)}
                      {" · "}No suspension{" "}
                      {boolLabel(
                        currentPolicy.attendanceIncentiveRequireNoSuspension,
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Premiums
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      Rest {currentPolicy.restDayWorkedPremiumPercent}% · Regular{" "}
                      {currentPolicy.regularHolidayWorkedPremiumPercent}% · Special{" "}
                      {currentPolicy.specialHolidayWorkedPremiumPercent}%
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Last updated by {currentPolicy.updatedByLabel}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                  No payroll policy row exists yet. Create the first one before
                  managers build payroll runs.
                </div>
              )}
            </SoTCard>
          </section>

          <aside className="lg:col-span-5">
            <SoTCard className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Policy history
                </h2>
                <p className="text-xs text-slate-500">
                  Open an existing row only when you need to correct that exact
                  record. Use a new row for future policy changes.
                </p>
              </div>

              <SoTTable>
                <SoTTableHead>
                  <SoTTableRow>
                    <SoTTh>Effective</SoTTh>
                    <SoTTh>Defaults</SoTTh>
                    <SoTTh>Action</SoTTh>
                  </SoTTableRow>
                </SoTTableHead>
                <tbody>
                  {policies.length === 0 ? (
                    <SoTTableEmptyRow
                      colSpan={3}
                      message="No payroll policy rows yet."
                    />
                  ) : (
                    policies.map((policy) => {
                      const status = statusMeta(policy, currentPolicyId, today);
                      return (
                        <SoTTableRow key={policy.id}>
                          <SoTTd>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span>{formatDateLabel(policy.effectiveFrom)}</span>
                                <SoTStatusBadge tone={status.tone}>
                                  {status.label}
                                </SoTStatusBadge>
                              </div>
                              <div className="text-xs text-slate-500">
                                Updated by {policy.updatedByLabel}
                              </div>
                            </div>
                          </SoTTd>
                          <SoTTd>
                            <div className="space-y-1 text-xs text-slate-600">
                              <div>{policy.payFrequency}</div>
                              <div>
                                Incentive {boolLabel(policy.attendanceIncentiveEnabled)} ·{" "}
                                {peso(policy.attendanceIncentiveAmount)}
                              </div>
                              <div>
                                Govt deductions: SSS{" "}
                                {boolLabel(policy.sssDeductionEnabled)} · PH{" "}
                                {boolLabel(policy.philhealthDeductionEnabled)} · PI{" "}
                                {boolLabel(policy.pagIbigDeductionEnabled)}
                              </div>
                              {policy.customCutoffNote ? (
                                <div>Note: {policy.customCutoffNote}</div>
                              ) : null}
                            </div>
                          </SoTTd>
                          <SoTTd>
                            <Link
                              to={`/creation/workforce/payroll-policy/${policy.id}/edit`}
                              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Edit row
                            </Link>
                          </SoTTd>
                        </SoTTableRow>
                      );
                    })
                  )}
                </tbody>
              </SoTTable>
            </SoTCard>
          </aside>
        </div>
      </div>
    </main>
  );
}
