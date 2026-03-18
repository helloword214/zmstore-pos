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
  listCompanyPayrollPolicies,
  upsertCompanyPayrollPolicy,
} from "~/services/worker-payroll-policy.server";
import { requireRole } from "~/utils/auth.server";

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

function addDays(value: Date | string, days: number) {
  const date = toDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
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

function suggestNextEffectiveFrom(policies: Array<Pick<NormalizedPolicy, "effectiveFrom">>) {
  const used = new Set(policies.map((policy) => formatDateInput(policy.effectiveFrom)));
  let candidate =
    policies.length > 0
      ? addDays(policies[0].effectiveFrom, 1)
      : toDateOnly(new Date());

  while (used.has(formatDateInput(candidate))) {
    candidate = addDays(candidate, 1);
  }

  return formatDateInput(candidate);
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

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);

  const policies = (await listCompanyPayrollPolicies()).map(normalizePolicy);
  const latestPolicy = policies[0] ?? null;

  return json({
    policies,
    latestPolicy,
    suggestedEffectiveFrom: suggestNextEffectiveFrom(policies),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");

  try {
    if (intent !== "create-policy") {
      return json<ActionData>(
        { ok: false, error: "Unsupported action.", action: intent },
        { status: 400 },
      );
    }

    const effectiveFrom = String(fd.get("effectiveFrom") || "").trim();
    const payFrequency = String(fd.get("payFrequency") || "");
    const sickLeavePayTreatment = String(fd.get("sickLeavePayTreatment") || "");

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

    const policy = await upsertCompanyPayrollPolicy({
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
      `/creation/workforce/payroll-policy/${policy.id}/edit?saved=policy-created`,
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

export default function PayrollPolicyCreateRoute() {
  const { policies, latestPolicy, suggestedEffectiveFrom } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Add Payroll Policy Row"
        subtitle="Create a new future effectivity row. This should be used for approved policy changes instead of editing the current row in place."
        backTo="/creation/workforce/payroll-policy"
        backLabel="Payroll Policy History"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-12">
          <section className="space-y-5 lg:col-span-7">
            <SoTCard className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  New effectivity row
                </h2>
                <p className="text-xs text-slate-500">
                  Saving here creates a new payroll policy row. It does not
                  overwrite an existing history record.
                </p>
              </div>

              <Form method="post" className="space-y-3">
                <input type="hidden" name="_intent" value="create-policy" />

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Effective from">
                    <SoTInput
                      type="date"
                      name="effectiveFrom"
                      defaultValue={suggestedEffectiveFrom}
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Pay frequency">
                    <SelectInput
                      name="payFrequency"
                      defaultValue={
                        latestPolicy?.payFrequency ?? PAYROLL_FREQUENCY.SEMI_MONTHLY
                      }
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
                  defaultValue={latestPolicy?.customCutoffNote ?? ""}
                  placeholder="Use only when pay frequency is custom or needs clarification"
                />

                <div className="grid gap-3 md:grid-cols-3">
                  <SoTFormField label="Rest-day premium %">
                    <SoTInput
                      name="restDayWorkedPremiumPercent"
                      inputMode="decimal"
                      defaultValue={
                        String(latestPolicy?.restDayWorkedPremiumPercent ?? 0)
                      }
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Regular holiday %">
                    <SoTInput
                      name="regularHolidayWorkedPremiumPercent"
                      inputMode="decimal"
                      defaultValue={
                        String(latestPolicy?.regularHolidayWorkedPremiumPercent ?? 0)
                      }
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Special holiday %">
                    <SoTInput
                      name="specialHolidayWorkedPremiumPercent"
                      inputMode="decimal"
                      defaultValue={
                        String(latestPolicy?.specialHolidayWorkedPremiumPercent ?? 0)
                      }
                      required
                    />
                  </SoTFormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Sick leave treatment">
                    <SelectInput
                      name="sickLeavePayTreatment"
                      defaultValue={
                        latestPolicy?.sickLeavePayTreatment ??
                        SICK_LEAVE_PAY_TREATMENT.UNPAID
                      }
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
                      defaultValue={String(latestPolicy?.attendanceIncentiveAmount ?? 0)}
                      required
                    />
                  </SoTFormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <CheckboxField
                    name="attendanceIncentiveEnabled"
                    label="Enable attendance incentive"
                    defaultChecked={latestPolicy?.attendanceIncentiveEnabled ?? true}
                  />
                  <CheckboxField
                    name="allowManagerOverride"
                    label="Allow manager override"
                    defaultChecked={latestPolicy?.allowManagerOverride ?? true}
                  />
                  <CheckboxField
                    name="attendanceIncentiveRequireNoLate"
                    label="Require no late flags"
                    defaultChecked={
                      latestPolicy?.attendanceIncentiveRequireNoLate ?? true
                    }
                  />
                  <CheckboxField
                    name="attendanceIncentiveRequireNoAbsent"
                    label="Require no absences"
                    defaultChecked={
                      latestPolicy?.attendanceIncentiveRequireNoAbsent ?? true
                    }
                  />
                  <CheckboxField
                    name="attendanceIncentiveRequireNoSuspension"
                    label="Require no suspension"
                    defaultChecked={
                      latestPolicy?.attendanceIncentiveRequireNoSuspension ?? true
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
                      defaultChecked={latestPolicy?.sssDeductionEnabled ?? false}
                    />
                    <CheckboxField
                      name="philhealthDeductionEnabled"
                      label="Include PhilHealth"
                      defaultChecked={
                        latestPolicy?.philhealthDeductionEnabled ?? false
                      }
                    />
                    <CheckboxField
                      name="pagIbigDeductionEnabled"
                      label="Include Pag-IBIG"
                      defaultChecked={latestPolicy?.pagIbigDeductionEnabled ?? false}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <SoTButton type="submit" variant="primary">
                    Save new policy row
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

          <aside className="space-y-5 lg:col-span-5">
            {latestPolicy ? (
              <SoTCard className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Latest policy row
                    </h2>
                    <p className="text-xs text-slate-500">
                      Use this as your baseline when creating the next row.
                    </p>
                  </div>
                  <SoTStatusBadge tone="info">REFERENCE</SoTStatusBadge>
                </div>
                <div className="space-y-1 text-sm text-slate-700">
                  <div>Effective {formatDateLabel(latestPolicy.effectiveFrom)}</div>
                  <div>{latestPolicy.payFrequency}</div>
                  <div>
                    Incentive {boolLabel(latestPolicy.attendanceIncentiveEnabled)} ·{" "}
                    {peso(latestPolicy.attendanceIncentiveAmount)}
                  </div>
                  <div>
                    Govt deductions: SSS {boolLabel(latestPolicy.sssDeductionEnabled)} ·
                    {" "}PH {boolLabel(latestPolicy.philhealthDeductionEnabled)} · PI{" "}
                    {boolLabel(latestPolicy.pagIbigDeductionEnabled)}
                  </div>
                </div>
              </SoTCard>
            ) : null}

            <SoTCard className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Existing history
                </h2>
                <p className="text-xs text-slate-500">
                  Open any row only when you need to correct that exact record.
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
                      message="No existing policy rows yet."
                    />
                  ) : (
                    policies.map((policy) => (
                      <SoTTableRow key={policy.id}>
                        <SoTTd>
                          <div className="space-y-1">
                            <div>{formatDateLabel(policy.effectiveFrom)}</div>
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
                            Edit row
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
