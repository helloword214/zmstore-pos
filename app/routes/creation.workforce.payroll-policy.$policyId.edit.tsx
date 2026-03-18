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
import { SoTTextarea } from "~/components/ui/SoTTextarea";
import {
  getEffectiveCompanyPayrollPolicy,
  listCompanyPayrollPolicies,
  upsertCompanyPayrollPolicy,
} from "~/services/worker-payroll-policy.server";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type ActionData = {
  ok: false;
  error: string;
  action?: string;
};

type NormalizedPolicy = {
  id: number;
  effectiveFrom: string;
  payFrequency: string;
  customCutoffNote: string | null;
  restDayWorkedPremiumPercent: number;
  regularHolidayWorkedPremiumPercent: number;
  specialHolidayWorkedPremiumPercent: number;
  sickLeavePayTreatment: string;
  attendanceIncentiveEnabled: boolean;
  attendanceIncentiveAmount: number;
  attendanceIncentiveRequireNoLate: boolean;
  attendanceIncentiveRequireNoAbsent: boolean;
  attendanceIncentiveRequireNoSuspension: boolean;
  sssDeductionEnabled: boolean;
  philhealthDeductionEnabled: boolean;
  pagIbigDeductionEnabled: boolean;
  allowManagerOverride: boolean;
  updatedByLabel: string;
};

const PAYROLL_FREQUENCY = {
  WEEKLY: "WEEKLY",
  BIWEEKLY: "BIWEEKLY",
  SEMI_MONTHLY: "SEMI_MONTHLY",
  CUSTOM: "CUSTOM",
} as const;

const SICK_LEAVE_PAY_TREATMENT = {
  PAID: "PAID",
  UNPAID: "UNPAID",
} as const;

function parseOptionalInt(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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

function formatDateInput(value: Date | string) {
  const { year, month, day } = parseCalendarDateParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDateLabel(value: Date | string) {
  return toDateOnly(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
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

function boolLabel(value: boolean) {
  return value ? "Yes" : "No";
}

function peso(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number.isFinite(value) ? value : 0);
}

function parseNonNegativeNumber(rawValue: string, label: string) {
  const parsed = Number(rawValue || 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
}

function normalizePolicy(policy: Awaited<ReturnType<typeof listCompanyPayrollPolicies>>[number]): NormalizedPolicy {
  return {
    id: policy.id,
    effectiveFrom: policy.effectiveFrom.toISOString(),
    payFrequency: policy.payFrequency,
    customCutoffNote: policy.customCutoffNote ?? null,
    restDayWorkedPremiumPercent: Number(policy.restDayWorkedPremiumPercent),
    regularHolidayWorkedPremiumPercent: Number(
      policy.regularHolidayWorkedPremiumPercent,
    ),
    specialHolidayWorkedPremiumPercent: Number(
      policy.specialHolidayWorkedPremiumPercent,
    ),
    sickLeavePayTreatment: policy.sickLeavePayTreatment,
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
    updatedByLabel: actorLabel(policy.updatedBy),
  };
}

function statusMeta(policyId: number, currentPolicyId: number | null, effectiveFrom: string) {
  if (policyId === currentPolicyId) {
    return { label: "CURRENT POLICY", tone: "success" as const };
  }

  if (toDateOnly(effectiveFrom).getTime() > toDateOnly(new Date()).getTime()) {
    return { label: "FUTURE POLICY", tone: "info" as const };
  }

  return { label: "HISTORY ROW", tone: "warning" as const };
}

function CheckboxField(props: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
      <input type="checkbox" name={props.name} value="1" defaultChecked={props.defaultChecked} />
      <span>{props.label}</span>
    </label>
  );
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);
  const saved = url.searchParams.get("saved");
  const policyId = parseOptionalInt(params.policyId ?? null);

  if (!policyId) {
    throw new Response("Payroll policy row not found.", { status: 404 });
  }

  const [policiesRaw, currentPolicyRaw] = await Promise.all([
    listCompanyPayrollPolicies(),
    getEffectiveCompanyPayrollPolicy(db, new Date()),
  ]);

  const policies = policiesRaw.map(normalizePolicy);
  const selectedPolicy =
    policies.find((policy) => policy.id === policyId) ?? null;

  if (!selectedPolicy) {
    throw new Response("Payroll policy row not found.", { status: 404 });
  }

  return json({
    saved,
    policies,
    selectedPolicy,
    currentPolicyId: currentPolicyRaw?.id ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const me = await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  const routePolicyId = parseOptionalInt(params.policyId ?? null);

  try {
    if (intent !== "save-policy") {
      return json<ActionData>(
        { ok: false, error: "Unsupported action.", action: intent },
        { status: 400 },
      );
    }

    const policyId = parseOptionalInt(String(fd.get("policyId") || ""));
    const effectiveFrom = String(fd.get("effectiveFrom") || "").trim();
    const payFrequency = String(fd.get("payFrequency") || "");
    const sickLeavePayTreatment = String(fd.get("sickLeavePayTreatment") || "");

    if (!routePolicyId || !policyId || routePolicyId !== policyId) {
      throw new Error("Selected payroll policy row is missing.");
    }
    if (!effectiveFrom) {
      throw new Error("Effective-from date is required.");
    }

    if (
      payFrequency !== PAYROLL_FREQUENCY.WEEKLY &&
      payFrequency !== PAYROLL_FREQUENCY.BIWEEKLY &&
      payFrequency !== PAYROLL_FREQUENCY.SEMI_MONTHLY &&
      payFrequency !== PAYROLL_FREQUENCY.CUSTOM
    ) {
      throw new Error("Invalid payroll frequency.");
    }

    if (
      sickLeavePayTreatment !== SICK_LEAVE_PAY_TREATMENT.PAID &&
      sickLeavePayTreatment !== SICK_LEAVE_PAY_TREATMENT.UNPAID
    ) {
      throw new Error("Invalid sick leave treatment.");
    }

    await upsertCompanyPayrollPolicy({
      id: policyId,
      effectiveFrom,
      payFrequency,
      customCutoffNote: String(fd.get("customCutoffNote") || ""),
      restDayWorkedPremiumPercent: parseNonNegativeNumber(
        String(fd.get("restDayWorkedPremiumPercent") || ""),
        "Rest-day premium %",
      ),
      regularHolidayWorkedPremiumPercent: parseNonNegativeNumber(
        String(fd.get("regularHolidayWorkedPremiumPercent") || ""),
        "Regular holiday premium %",
      ),
      specialHolidayWorkedPremiumPercent: parseNonNegativeNumber(
        String(fd.get("specialHolidayWorkedPremiumPercent") || ""),
        "Special holiday premium %",
      ),
      sickLeavePayTreatment,
      attendanceIncentiveEnabled:
        String(fd.get("attendanceIncentiveEnabled") || "") === "1",
      attendanceIncentiveAmount: parseNonNegativeNumber(
        String(fd.get("attendanceIncentiveAmount") || ""),
        "Attendance incentive amount",
      ),
      attendanceIncentiveRequireNoLate:
        String(fd.get("attendanceIncentiveRequireNoLate") || "") === "1",
      attendanceIncentiveRequireNoAbsent:
        String(fd.get("attendanceIncentiveRequireNoAbsent") || "") === "1",
      attendanceIncentiveRequireNoSuspension:
        String(fd.get("attendanceIncentiveRequireNoSuspension") || "") === "1",
      sssDeductionEnabled: String(fd.get("sssDeductionEnabled") || "") === "1",
      philhealthDeductionEnabled:
        String(fd.get("philhealthDeductionEnabled") || "") === "1",
      pagIbigDeductionEnabled:
        String(fd.get("pagIbigDeductionEnabled") || "") === "1",
      allowManagerOverride:
        String(fd.get("allowManagerOverride") || "") === "1",
      actorUserId: me.userId,
    });

    return redirect(
      `/creation/workforce/payroll-policy/${policyId}/edit?saved=policy-updated`,
    );
  } catch (error) {
    return json<ActionData>(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save payroll policy.",
        action: intent,
      },
      { status: 400 },
    );
  }
}

export default function PayrollPolicyEditRoute() {
  const { saved, policies, selectedPolicy, currentPolicyId } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const status = statusMeta(
    selectedPolicy.id,
    currentPolicyId,
    selectedPolicy.effectiveFrom,
  );

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Edit Payroll Policy Row"
        subtitle="Correct the selected policy row only. Use a new policy row when the business approves a new future effectivity."
        backTo="/creation/workforce/payroll-policy"
        backLabel="Payroll Policy History"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {saved === "policy-created" ? (
          <SoTAlert tone="success">New payroll policy row saved.</SoTAlert>
        ) : null}
        {saved === "policy-updated" ? (
          <SoTAlert tone="success">Payroll policy row updated.</SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-12">
          <section className="space-y-5 lg:col-span-7">
            <SoTCard className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Selected policy row
                  </h2>
                  <p className="text-xs text-slate-500">
                    This page corrects the exact row you opened. It does not
                    create a new effectivity version.
                  </p>
                </div>
                <SoTStatusBadge tone={status.tone}>{status.label}</SoTStatusBadge>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Effective from
                  </div>
                  <div className="mt-1 text-sm text-slate-900">
                    {formatDateLabel(selectedPolicy.effectiveFrom)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {selectedPolicy.payFrequency}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Government deductions
                  </div>
                  <div className="mt-1 text-sm text-slate-900">
                    SSS {boolLabel(selectedPolicy.sssDeductionEnabled)} · PH{" "}
                    {boolLabel(selectedPolicy.philhealthDeductionEnabled)} · PI{" "}
                    {boolLabel(selectedPolicy.pagIbigDeductionEnabled)}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Override {boolLabel(selectedPolicy.allowManagerOverride)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Next action
                  </div>
                  <div className="mt-1 text-sm text-slate-900">
                    Need a future policy change instead?
                  </div>
                  <div className="mt-2">
                    <Link
                      to="/creation/workforce/payroll-policy/new"
                      className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Add policy row
                    </Link>
                  </div>
                </div>
              </div>
            </SoTCard>

            <SoTCard className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Edit selected policy row
                </h2>
                <p className="text-xs text-slate-500">
                  Use this only to correct the row you opened. New approved
                  policy changes should be created as a new row.
                </p>
              </div>

              <Form method="post" className="space-y-3">
                <input type="hidden" name="_intent" value="save-policy" />
                <input type="hidden" name="policyId" value={selectedPolicy.id} />

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Effective from">
                    <SoTInput
                      type="date"
                      name="effectiveFrom"
                      defaultValue={formatDateInput(selectedPolicy.effectiveFrom)}
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Pay frequency">
                    <SelectInput
                      name="payFrequency"
                      defaultValue={selectedPolicy.payFrequency}
                      options={[
                        {
                          value: PAYROLL_FREQUENCY.SEMI_MONTHLY,
                          label: "Semi-monthly",
                        },
                        { value: PAYROLL_FREQUENCY.WEEKLY, label: "Weekly" },
                        { value: PAYROLL_FREQUENCY.BIWEEKLY, label: "Biweekly" },
                        { value: PAYROLL_FREQUENCY.CUSTOM, label: "Custom" },
                      ]}
                    />
                  </SoTFormField>
                </div>

                <SoTTextarea
                  name="customCutoffNote"
                  label="Custom cutoff note"
                  rows={2}
                  defaultValue={selectedPolicy.customCutoffNote ?? ""}
                  placeholder="Use only when pay frequency is custom or needs clarification"
                />

                <div className="grid gap-3 md:grid-cols-3">
                  <SoTFormField label="Rest-day premium %">
                    <SoTInput
                      name="restDayWorkedPremiumPercent"
                      inputMode="decimal"
                      defaultValue={String(selectedPolicy.restDayWorkedPremiumPercent)}
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Regular holiday %">
                    <SoTInput
                      name="regularHolidayWorkedPremiumPercent"
                      inputMode="decimal"
                      defaultValue={String(
                        selectedPolicy.regularHolidayWorkedPremiumPercent,
                      )}
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Special holiday %">
                    <SoTInput
                      name="specialHolidayWorkedPremiumPercent"
                      inputMode="decimal"
                      defaultValue={String(
                        selectedPolicy.specialHolidayWorkedPremiumPercent,
                      )}
                      required
                    />
                  </SoTFormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Sick leave treatment">
                    <SelectInput
                      name="sickLeavePayTreatment"
                      defaultValue={selectedPolicy.sickLeavePayTreatment}
                      options={[
                        {
                          value: SICK_LEAVE_PAY_TREATMENT.UNPAID,
                          label: "Unpaid",
                        },
                        { value: SICK_LEAVE_PAY_TREATMENT.PAID, label: "Paid" },
                      ]}
                    />
                  </SoTFormField>
                  <SoTFormField label="Attendance incentive amount">
                    <SoTInput
                      name="attendanceIncentiveAmount"
                      inputMode="decimal"
                      defaultValue={String(selectedPolicy.attendanceIncentiveAmount)}
                      required
                    />
                  </SoTFormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <CheckboxField
                    name="attendanceIncentiveEnabled"
                    label="Enable attendance incentive"
                    defaultChecked={selectedPolicy.attendanceIncentiveEnabled}
                  />
                  <CheckboxField
                    name="allowManagerOverride"
                    label="Allow manager override"
                    defaultChecked={selectedPolicy.allowManagerOverride}
                  />
                  <CheckboxField
                    name="attendanceIncentiveRequireNoLate"
                    label="Require no late flags"
                    defaultChecked={selectedPolicy.attendanceIncentiveRequireNoLate}
                  />
                  <CheckboxField
                    name="attendanceIncentiveRequireNoAbsent"
                    label="Require no absences"
                    defaultChecked={selectedPolicy.attendanceIncentiveRequireNoAbsent}
                  />
                  <CheckboxField
                    name="attendanceIncentiveRequireNoSuspension"
                    label="Require no suspension"
                    defaultChecked={
                      selectedPolicy.attendanceIncentiveRequireNoSuspension
                    }
                  />
                </div>

                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Government deduction switches
                    </h3>
                    <p className="text-xs text-slate-500">
                      These toggles decide whether the employee-specific SSS,
                      PhilHealth, and Pag-IBIG setup is included during payroll
                      rebuild and review.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <CheckboxField
                      name="sssDeductionEnabled"
                      label="Include SSS"
                      defaultChecked={selectedPolicy.sssDeductionEnabled}
                    />
                    <CheckboxField
                      name="philhealthDeductionEnabled"
                      label="Include PhilHealth"
                      defaultChecked={selectedPolicy.philhealthDeductionEnabled}
                    />
                    <CheckboxField
                      name="pagIbigDeductionEnabled"
                      label="Include Pag-IBIG"
                      defaultChecked={selectedPolicy.pagIbigDeductionEnabled}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <SoTButton type="submit" variant="primary">
                    Save policy corrections
                  </SoTButton>
                  <Link
                    to="/creation/workforce/payroll-policy"
                    className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Back to history
                  </Link>
                </div>
              </Form>
            </SoTCard>
          </section>

          <aside className="lg:col-span-5">
            <SoTCard className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Policy history
                </h2>
                <p className="text-xs text-slate-500">
                  Jump to any row from here without losing the split create/edit
                  flow.
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
                    policies.map((policy) => (
                      <SoTTableRow key={policy.id}>
                        <SoTTd>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span>{formatDateLabel(policy.effectiveFrom)}</span>
                              {policy.id === selectedPolicy.id ? (
                                <SoTStatusBadge tone="info">OPEN</SoTStatusBadge>
                              ) : null}
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
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <Link
                            to={`/creation/workforce/payroll-policy/${policy.id}/edit`}
                            className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {policy.id === selectedPolicy.id ? "Open" : "Edit row"}
                          </Link>
                        </SoTTd>
                      </SoTTableRow>
                    ))
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
