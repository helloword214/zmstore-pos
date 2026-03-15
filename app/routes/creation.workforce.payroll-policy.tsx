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

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);
  const selectedPolicyId = parseOptionalInt(url.searchParams.get("policyId"));
  const saved = url.searchParams.get("saved");

  const policiesRaw = await listCompanyPayrollPolicies();
  const policies = policiesRaw.map((policy) => ({
    id: policy.id,
    effectiveFrom: policy.effectiveFrom,
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
    allowManagerOverride: policy.allowManagerOverride,
    createdByLabel: actorLabel(policy.createdBy),
    updatedByLabel: actorLabel(policy.updatedBy),
    updatedAt: policy.updatedAt,
  }));

  const selectedPolicy =
    policies.find((policy) => policy.id === selectedPolicyId) ?? policies[0] ?? null;

  return json({
    policies,
    selectedPolicy,
    saved,
    today: formatDateInput(new Date()),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");

  try {
    if (intent !== "save-policy") {
      return json<ActionData>(
        { ok: false, error: "Unsupported action.", action: intent },
        { status: 400 },
      );
    }

    const policyId = parseOptionalInt(String(fd.get("policyId") || ""));
    const effectiveFrom = String(fd.get("effectiveFrom") || "");
    const payFrequency = String(fd.get("payFrequency") || "");
    const sickLeavePayTreatment = String(fd.get("sickLeavePayTreatment") || "");

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
      id: policyId ?? undefined,
      effectiveFrom,
      payFrequency,
      customCutoffNote: String(fd.get("customCutoffNote") || ""),
      restDayWorkedPremiumPercent: Number(
        fd.get("restDayWorkedPremiumPercent") || 0,
      ),
      regularHolidayWorkedPremiumPercent: Number(
        fd.get("regularHolidayWorkedPremiumPercent") || 0,
      ),
      specialHolidayWorkedPremiumPercent: Number(
        fd.get("specialHolidayWorkedPremiumPercent") || 0,
      ),
      sickLeavePayTreatment,
      attendanceIncentiveEnabled: String(fd.get("attendanceIncentiveEnabled") || "") === "1",
      attendanceIncentiveAmount: Number(fd.get("attendanceIncentiveAmount") || 0),
      attendanceIncentiveRequireNoLate:
        String(fd.get("attendanceIncentiveRequireNoLate") || "") === "1",
      attendanceIncentiveRequireNoAbsent:
        String(fd.get("attendanceIncentiveRequireNoAbsent") || "") === "1",
      attendanceIncentiveRequireNoSuspension:
        String(fd.get("attendanceIncentiveRequireNoSuspension") || "") === "1",
      allowManagerOverride:
        String(fd.get("allowManagerOverride") || "") === "1",
      actorUserId: me.userId,
    });

    return redirect(
      `/creation/workforce/payroll-policy?policyId=${policy.id}&saved=policy`,
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

export default function PayrollPolicyCreationRoute() {
  const { policies, selectedPolicy, saved, today } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Payroll Policy Setup"
        subtitle="Admin-owned company payroll defaults for cutoffs, premiums, sick leave treatment, and attendance incentive rules."
        backTo="/"
        backLabel="Admin Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {saved === "policy" ? (
          <SoTAlert tone="success">Payroll policy saved.</SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-12">
          <section className="lg:col-span-7">
            <SoTCard interaction="form" className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Company payroll policy
                </h2>
                <p className="text-xs text-slate-500">
                  Every new payroll run snapshots the policy effective on its pay
                  date. Editing here affects future runs only.
                </p>
              </div>

              <Form method="post" className="space-y-3">
                <input type="hidden" name="_intent" value="save-policy" />
                <input type="hidden" name="policyId" value={selectedPolicy?.id ?? ""} />

                <div className="grid gap-3 md:grid-cols-2">
                  <SoTFormField label="Effective from">
                    <SoTInput
                      type="date"
                      name="effectiveFrom"
                      defaultValue={selectedPolicy?.effectiveFrom ? formatDateInput(selectedPolicy.effectiveFrom) : today}
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Pay frequency">
                    <SelectInput
                      name="payFrequency"
                      defaultValue={
                        selectedPolicy?.payFrequency ?? PAYROLL_FREQUENCY.SEMI_MONTHLY
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
                  defaultValue={selectedPolicy?.customCutoffNote ?? ""}
                  placeholder="Use only when pay frequency is custom or needs clarification"
                />

                <div className="grid gap-3 md:grid-cols-3">
                  <SoTFormField label="Rest-day premium %">
                    <SoTInput
                      name="restDayWorkedPremiumPercent"
                      inputMode="decimal"
                      defaultValue={selectedPolicy?.restDayWorkedPremiumPercent ?? 0}
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Regular holiday %">
                    <SoTInput
                      name="regularHolidayWorkedPremiumPercent"
                      inputMode="decimal"
                      defaultValue={
                        selectedPolicy?.regularHolidayWorkedPremiumPercent ?? 0
                      }
                      required
                    />
                  </SoTFormField>
                  <SoTFormField label="Special holiday %">
                    <SoTInput
                      name="specialHolidayWorkedPremiumPercent"
                      inputMode="decimal"
                      defaultValue={
                        selectedPolicy?.specialHolidayWorkedPremiumPercent ?? 0
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
                        selectedPolicy?.sickLeavePayTreatment ??
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
                      defaultValue={selectedPolicy?.attendanceIncentiveAmount ?? 0}
                      required
                    />
                  </SoTFormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <CheckboxField
                    name="attendanceIncentiveEnabled"
                    label="Enable attendance incentive"
                    defaultChecked={
                      selectedPolicy?.attendanceIncentiveEnabled ?? true
                    }
                  />
                  <CheckboxField
                    name="allowManagerOverride"
                    label="Allow manager override"
                    defaultChecked={
                      selectedPolicy?.allowManagerOverride ?? true
                    }
                  />
                  <CheckboxField
                    name="attendanceIncentiveRequireNoLate"
                    label="Require no late flags"
                    defaultChecked={
                      selectedPolicy?.attendanceIncentiveRequireNoLate ?? true
                    }
                  />
                  <CheckboxField
                    name="attendanceIncentiveRequireNoAbsent"
                    label="Require no absences"
                    defaultChecked={
                      selectedPolicy?.attendanceIncentiveRequireNoAbsent ?? true
                    }
                  />
                  <CheckboxField
                    name="attendanceIncentiveRequireNoSuspension"
                    label="Require no suspension"
                    defaultChecked={
                      selectedPolicy?.attendanceIncentiveRequireNoSuspension ?? true
                    }
                  />
                </div>

                <SoTButton type="submit" variant="primary">
                  Save payroll policy
                </SoTButton>
              </Form>
            </SoTCard>
          </section>

          <aside className="space-y-5 lg:col-span-5">
            <SoTCard className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Policy history
                  </h2>
                  <p className="text-xs text-slate-500">
                    Effective-dated records remain available for audit and future runs.
                  </p>
                </div>
                <Link
                  to="/creation/workforce/pay-profiles"
                  className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Pay profiles
                </Link>
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
                      message="No payroll policy records yet."
                    />
                  ) : (
                    policies.map((policy) => (
                      <SoTTableRow key={policy.id}>
                        <SoTTd>
                          <div className="space-y-1">
                            <div className="font-medium text-slate-900">
                              {formatDateLabel(policy.effectiveFrom)}
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
                              Sick leave {policy.sickLeavePayTreatment.toLowerCase()}
                            </div>
                            <div>
                              Incentive {boolLabel(policy.attendanceIncentiveEnabled)} ·{" "}
                              PHP {policy.attendanceIncentiveAmount.toFixed(2)}
                            </div>
                          </div>
                        </SoTTd>
                        <SoTTd>
                          <Link
                            to={`/creation/workforce/payroll-policy?policyId=${policy.id}`}
                            className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium ${
                              selectedPolicy?.id === policy.id
                                ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                                : "border-slate-300 bg-white text-slate-700"
                            }`}
                          >
                            {selectedPolicy?.id === policy.id ? "Selected" : "Open"}
                          </Link>
                        </SoTTd>
                      </SoTTableRow>
                    ))
                  )}
                </tbody>
              </SoTTable>
            </SoTCard>

            {selectedPolicy ? (
              <SoTCard className="space-y-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Selected policy summary
                </h2>
                <div className="space-y-1 text-sm text-slate-700">
                  <div>
                    <SoTStatusBadge tone="info">
                      {selectedPolicy.payFrequency}
                    </SoTStatusBadge>
                  </div>
                  <div>
                    Rest-day premium: {selectedPolicy.restDayWorkedPremiumPercent}%
                  </div>
                  <div>
                    Regular holiday premium:{" "}
                    {selectedPolicy.regularHolidayWorkedPremiumPercent}%
                  </div>
                  <div>
                    Special holiday premium:{" "}
                    {selectedPolicy.specialHolidayWorkedPremiumPercent}%
                  </div>
                  <div>
                    No late required:{" "}
                    {boolLabel(selectedPolicy.attendanceIncentiveRequireNoLate)}
                  </div>
                  <div>
                    No absent required:{" "}
                    {boolLabel(selectedPolicy.attendanceIncentiveRequireNoAbsent)}
                  </div>
                  <div>
                    No suspension required:{" "}
                    {boolLabel(
                      selectedPolicy.attendanceIncentiveRequireNoSuspension,
                    )}
                  </div>
                </div>
              </SoTCard>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}

function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
      <input
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={defaultChecked}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-300"
      />
      <span>{label}</span>
    </label>
  );
}
