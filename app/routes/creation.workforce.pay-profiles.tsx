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
  listEmployeePayProfiles,
  listEmployeeStatutoryDeductionProfiles,
} from "~/services/worker-payroll-policy.server";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type NormalizedPayProfile = {
  id: number;
  employeeId: number;
  dailyRate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
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
};

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

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);

  const [workersRaw, payProfilesRaw, statutoryProfilesRaw] = await Promise.all([
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
    listEmployeePayProfiles(),
    listEmployeeStatutoryDeductionProfiles(),
  ]);

  const payProfilesByEmployeeId = new Map<number, NormalizedPayProfile[]>();
  for (const profile of payProfilesRaw) {
    const bucket = payProfilesByEmployeeId.get(profile.employeeId) ?? [];
    bucket.push({
      id: profile.id,
      employeeId: profile.employeeId,
      dailyRate: Number(profile.dailyRate),
      effectiveFrom: profile.effectiveFrom.toISOString(),
      effectiveTo: profile.effectiveTo?.toISOString() ?? null,
    });
    payProfilesByEmployeeId.set(profile.employeeId, bucket);
  }

  const statutoryProfilesByEmployeeId = new Map<
    number,
    NormalizedStatutoryProfile[]
  >();
  for (const profile of statutoryProfilesRaw) {
    const bucket = statutoryProfilesByEmployeeId.get(profile.employeeId) ?? [];
    const sssAmount = Number(profile.sssAmount);
    const philhealthAmount = Number(profile.philhealthAmount);
    const pagIbigAmount = Number(profile.pagIbigAmount);
    bucket.push({
      id: profile.id,
      employeeId: profile.employeeId,
      sssAmount,
      philhealthAmount,
      pagIbigAmount,
      totalAmount: sssAmount + philhealthAmount + pagIbigAmount,
      effectiveFrom: profile.effectiveFrom.toISOString(),
      effectiveTo: profile.effectiveTo?.toISOString() ?? null,
    });
    statutoryProfilesByEmployeeId.set(profile.employeeId, bucket);
  }

  const today = new Date();

  const rows = workersRaw.map((worker) => {
    const payProfiles = payProfilesByEmployeeId.get(worker.id) ?? [];
    const currentPayProfile =
      payProfiles.find((profile) => isEffectiveOnDate(profile, today)) ?? null;
    const latestPayProfile = payProfiles[0] ?? null;

    const statutoryProfiles = statutoryProfilesByEmployeeId.get(worker.id) ?? [];
    const currentStatutoryProfile =
      statutoryProfiles.find((profile) => isEffectiveOnDate(profile, today)) ?? null;
    const latestStatutoryProfile = statutoryProfiles[0] ?? null;

    return {
      id: worker.id,
      label: buildWorkerLabel(worker),
      role: worker.user?.role ?? "UNASSIGNED",
      currentPayProfile,
      latestPayProfile,
      currentStatutoryProfile,
      latestStatutoryProfile,
      payProfileCount: payProfiles.length,
      statutoryProfileCount: statutoryProfiles.length,
    };
  });

  return json({ rows });
}

export default function PayProfilesDirectoryRoute() {
  const outlet = useOutlet();
  const { rows } = useLoaderData<typeof loader>();

  if (outlet) {
    return outlet;
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Employee Payroll Setup"
        subtitle="Overview of each employee's daily salary row and current government deduction setup. Open the dedicated pages to add a salary change or correct the latest row."
        backTo="/"
        backLabel="Admin Dashboard"
      />

      <div className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        <SoTCard className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Employee payroll list
              </h2>
              <p className="text-xs text-slate-500">
                Keep this page for overview only. Salary changes use effective
                history, and government deductions are tracked separately per
                employee.
              </p>
            </div>
            <Link
              to="/creation/workforce/payroll-policy"
              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Payroll policy
            </Link>
          </div>

          <SoTTable>
            <SoTTableHead>
              <SoTTableRow>
                <SoTTh>Employee</SoTTh>
                <SoTTh>Daily salary</SoTTh>
                <SoTTh>Government deductions</SoTTh>
                <SoTTh>History</SoTTh>
                <SoTTh>Actions</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {rows.length === 0 ? (
                <SoTTableEmptyRow
                  colSpan={5}
                  message="No active employees found."
                />
              ) : (
                rows.map((row) => {
                  const primaryPayProfile = row.currentPayProfile ?? row.latestPayProfile;
                  const primaryStatutoryProfile =
                    row.currentStatutoryProfile ?? row.latestStatutoryProfile;

                  return (
                    <SoTTableRow key={row.id}>
                      <SoTTd>
                        <div className="space-y-1">
                          <div className="font-medium text-slate-900">
                            {row.label}
                          </div>
                          <div className="text-xs text-slate-500">{row.role}</div>
                        </div>
                      </SoTTd>
                      <SoTTd>
                        {primaryPayProfile ? (
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <SoTStatusBadge
                                tone={row.currentPayProfile ? "success" : "info"}
                              >
                                {row.currentPayProfile ? "CURRENT" : "LATEST"}
                              </SoTStatusBadge>
                              <span className="text-xs text-slate-500">
                                Effective {formatDateLabel(primaryPayProfile.effectiveFrom)}
                              </span>
                            </div>
                            <div className="text-sm text-slate-700">
                              Daily rate {peso(primaryPayProfile.dailyRate)}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <SoTStatusBadge tone="warning">NO SALARY</SoTStatusBadge>
                            <div className="text-sm text-slate-600">
                              No daily salary setup yet.
                            </div>
                          </div>
                        )}
                      </SoTTd>
                      <SoTTd>
                        {primaryStatutoryProfile ? (
                          <div className="space-y-1 text-xs text-slate-600">
                            <div className="flex flex-wrap items-center gap-2">
                              <SoTStatusBadge
                                tone={row.currentStatutoryProfile ? "success" : "info"}
                              >
                                {row.currentStatutoryProfile ? "CURRENT" : "LATEST"}
                              </SoTStatusBadge>
                              <span>
                                Total {peso(primaryStatutoryProfile.totalAmount)}
                              </span>
                            </div>
                            <div>
                              SSS {peso(primaryStatutoryProfile.sssAmount)} ·
                              PhilHealth {peso(primaryStatutoryProfile.philhealthAmount)}
                            </div>
                            <div>
                              Pag-IBIG {peso(primaryStatutoryProfile.pagIbigAmount)}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <SoTStatusBadge tone="warning">NO DEDUCTIONS</SoTStatusBadge>
                            <div className="text-sm text-slate-600">
                              No employee deduction setup yet.
                            </div>
                          </div>
                        )}
                      </SoTTd>
                      <SoTTd>
                        <div className="space-y-1 text-xs text-slate-600">
                          <div>{row.payProfileCount} salary row(s)</div>
                          <div>{row.statutoryProfileCount} deduction row(s)</div>
                        </div>
                      </SoTTd>
                      <SoTTd>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            to={`/creation/workforce/pay-profiles/new?employeeId=${row.id}`}
                            className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            {row.latestPayProfile
                              ? "Add salary change"
                              : "Create initial salary"}
                          </Link>
                          {row.latestPayProfile ? (
                            <Link
                              to={`/creation/workforce/pay-profiles/${row.latestPayProfile.id}/edit`}
                              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Edit latest row
                            </Link>
                          ) : null}
                        </div>
                      </SoTTd>
                    </SoTTableRow>
                  );
                })
              )}
            </tbody>
          </SoTTable>
        </SoTCard>
      </div>
    </main>
  );
}
