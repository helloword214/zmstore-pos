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
  getPayrollTaggedChargeSummaryForEmployee,
  listUnresolvedCashierPayrollCharges,
} from "~/services/worker-payroll-identity.server";
import { getEffectiveCompanyPayrollPolicy } from "~/services/worker-payroll-policy.server";
import {
  applyWorkerPayrollChargeDeduction,
  createWorkerPayrollRunDraft,
  finalizeWorkerPayrollRun,
  getWorkerPayrollRunDetail,
  getWorkerPayrollRunEmployeeOverride,
  listWorkerPayrollRuns,
  markWorkerPayrollRunPaid,
  parsePayrollAttendanceSnapshotIds,
  parsePayrollDeductionSnapshot,
  parsePayrollRunLineAdditionSnapshot,
  parsePayrollStatutoryDeductionSnapshot,
  parsePolicySnapshot,
  rebuildWorkerPayrollRunLines,
  saveWorkerPayrollRunEmployeeOverride,
} from "~/services/worker-payroll-run.server";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

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

type PayrollFrequencyValue =
  (typeof PAYROLL_FREQUENCY)[keyof typeof PAYROLL_FREQUENCY];

const PAYROLL_RUN_STATUS = {
  DRAFT: "DRAFT",
  FINALIZED: "FINALIZED",
  PAID: "PAID",
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

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfWeek(reference: Date) {
  const date = toDateOnly(reference);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function endOfWeek(reference: Date) {
  return addDays(startOfWeek(reference), 6);
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

function peso(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number.isFinite(value) ? value : 0);
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

function buildWorkerLabel(worker: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  const fullName = `${worker.firstName} ${worker.lastName}`.trim();
  return `${fullName}${worker.alias ? ` (${worker.alias})` : ""}`;
}

function statusTone(status: string) {
  if (status === PAYROLL_RUN_STATUS.PAID) return "success" as const;
  if (status === PAYROLL_RUN_STATUS.FINALIZED) return "info" as const;
  if (status === PAYROLL_RUN_STATUS.DRAFT) return "warning" as const;
  return "danger" as const;
}

function buildPayrollRedirect(args: {
  runId?: number | null;
  employeeId?: number | null;
  saved?: string;
}) {
  const params = new URLSearchParams();
  if (args.runId) {
    params.set("runId", String(args.runId));
  }
  if (args.employeeId) {
    params.set("employeeId", String(args.employeeId));
  }
  if (args.saved) {
    params.set("saved", args.saved);
  }
  const suffix = params.toString();
  return suffix ? `/store/payroll?${suffix}` : "/store/payroll";
}

function resolveSuggestedDraftWindow(
  payFrequency: PayrollFrequencyValue | null | undefined,
  referenceDate: Date,
) {
  const today = toDateOnly(referenceDate);

  if (payFrequency === PAYROLL_FREQUENCY.SEMI_MONTHLY) {
    if (today.getDate() <= 15) {
      return {
        periodStart: formatDateInput(
          new Date(today.getFullYear(), today.getMonth(), 1),
        ),
        periodEnd: formatDateInput(
          new Date(today.getFullYear(), today.getMonth(), 15),
        ),
      };
    }

    return {
      periodStart: formatDateInput(
        new Date(today.getFullYear(), today.getMonth(), 16),
      ),
      periodEnd: formatDateInput(
        new Date(today.getFullYear(), today.getMonth() + 1, 0),
      ),
    };
  }

  if (payFrequency === PAYROLL_FREQUENCY.WEEKLY) {
    return {
      periodStart: formatDateInput(startOfWeek(today)),
      periodEnd: formatDateInput(endOfWeek(today)),
    };
  }

  if (payFrequency === PAYROLL_FREQUENCY.BIWEEKLY) {
    return {
      periodStart: formatDateInput(addDays(today, -13)),
      periodEnd: formatDateInput(today),
    };
  }

  return {
    periodStart: formatDateInput(addDays(today, -13)),
    periodEnd: formatDateInput(today),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);
  const url = new URL(request.url);
  const selectedRunId = parseOptionalInt(url.searchParams.get("runId"));
  const selectedEmployeeId = parseOptionalInt(url.searchParams.get("employeeId"));
  const saved = url.searchParams.get("saved");

  const [runsRaw, effectivePolicy, unresolvedCashierChargesRaw] =
    await Promise.all([
      listWorkerPayrollRuns(),
      getEffectiveCompanyPayrollPolicy(db, new Date()),
      listUnresolvedCashierPayrollCharges(),
    ]);

  const runs = runsRaw.map((run) => ({
    id: run.id,
    status: run.status,
    payFrequency: run.payFrequency,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    payDate: run.payDate,
    note: run.note ?? null,
    createdAt: run.createdAt,
    finalizedAt: run.finalizedAt,
    paidAt: run.paidAt,
    createdByLabel: actorLabel(run.createdBy),
    finalizedByLabel: actorLabel(run.finalizedBy),
    paidByLabel: actorLabel(run.paidBy),
    lineCount: run.payrollRunLines.length,
    grossTotal: run.payrollRunLines.reduce(
      (sum, line) => sum + Number(line.grossPay),
      0,
    ),
    deductionTotal: run.payrollRunLines.reduce(
      (sum, line) => sum + Number(line.totalDeductions),
      0,
    ),
    netTotal: run.payrollRunLines.reduce(
      (sum, line) => sum + Number(line.netPay),
      0,
    ),
  }));

  const activeRunId = selectedRunId ?? runs[0]?.id ?? null;
  const selectedRunRaw = activeRunId
    ? await getWorkerPayrollRunDetail(activeRunId)
    : null;

  const selectedRun = selectedRunRaw
    ? (() => {
        const lines = selectedRunRaw.payrollRunLines.map((line) => ({
          id: line.id,
          employeeId: line.employeeId,
          employeeLabel: buildWorkerLabel(line.employee),
          employeeRole: line.employee.user?.role ?? "UNASSIGNED",
          baseAttendancePay: Number(line.baseAttendancePay),
          attendanceIncentiveAmount: Number(line.attendanceIncentiveAmount),
          totalAdditions: Number(line.totalAdditions),
          grossPay: Number(line.grossPay),
          chargeDeductionAmount: Number(line.chargeDeductionAmount),
          statutoryDeductionAmount: Number(line.statutoryDeductionAmount),
          totalDeductions: Number(line.totalDeductions),
          netPay: Number(line.netPay),
          managerOverrideNote: line.managerOverrideNote ?? null,
          attendanceSnapshotIds: parsePayrollAttendanceSnapshotIds(
            line.attendanceSnapshotIds,
          ),
          policySnapshot: parsePolicySnapshot(line.policySnapshot),
          additionSnapshot: parsePayrollRunLineAdditionSnapshot(
            line.additionSnapshot,
          ),
          statutoryDeductionSnapshot: parsePayrollStatutoryDeductionSnapshot(
            line.statutoryDeductionSnapshot,
          ),
          deductionSnapshot: parsePayrollDeductionSnapshot(
            line.deductionSnapshot,
          ),
        }));
        const attendanceBackedLineCount = lines.filter(
          (line) => line.attendanceSnapshotIds.length > 0,
        ).length;

        return {
          id: selectedRunRaw.id,
          status: selectedRunRaw.status,
          payFrequency: selectedRunRaw.payFrequency,
          periodStart: selectedRunRaw.periodStart,
          periodEnd: selectedRunRaw.periodEnd,
          payDate: selectedRunRaw.payDate,
          note: selectedRunRaw.note ?? null,
          createdAt: selectedRunRaw.createdAt,
          finalizedAt: selectedRunRaw.finalizedAt,
          paidAt: selectedRunRaw.paidAt,
          createdByLabel: actorLabel(selectedRunRaw.createdBy),
          finalizedByLabel: actorLabel(selectedRunRaw.finalizedBy),
          paidByLabel: actorLabel(selectedRunRaw.paidBy),
          basePolicySnapshot:
            parsePolicySnapshot(selectedRunRaw.policySnapshot) ?? null,
          lines,
          attendanceBackedLineCount,
          nonAttendanceBackedLineCount: lines.length - attendanceBackedLineCount,
          totals: {
            grossTotal: selectedRunRaw.payrollRunLines.reduce(
              (sum, line) => sum + Number(line.grossPay),
              0,
            ),
            deductionTotal: selectedRunRaw.payrollRunLines.reduce(
              (sum, line) => sum + Number(line.totalDeductions),
              0,
            ),
            netTotal: selectedRunRaw.payrollRunLines.reduce(
              (sum, line) => sum + Number(line.netPay),
              0,
            ),
          },
        };
      })()
    : null;

  const selectedLine =
    selectedRun?.lines.find((line) => line.employeeId === selectedEmployeeId) ??
    selectedRun?.lines[0] ??
    null;

  const [selectedAttendanceRowsRaw, selectedChargeSummaryRaw] =
    selectedRun && selectedLine
      ? await Promise.all([
          db.attendanceDutyResult.findMany({
            where: {
              workerId: selectedLine.employeeId,
              dutyDate: {
                gte: selectedRunRaw!.periodStart,
                lte: selectedRunRaw!.periodEnd,
              },
            },
            orderBy: [{ dutyDate: "asc" }, { id: "asc" }],
          }),
          getPayrollTaggedChargeSummaryForEmployee(selectedLine.employeeId),
        ])
      : [[], { itemCount: 0, totalRemaining: 0, items: [] }];

  const selectedOverride =
    selectedRunRaw && selectedLine
      ? getWorkerPayrollRunEmployeeOverride(
          selectedRunRaw.managerOverrideSnapshot,
          selectedLine.employeeId,
        )
      : null;

  return json({
    runs,
    selectedRun,
    selectedLine,
    selectedAttendanceRows: selectedAttendanceRowsRaw.map((row) => ({
      id: row.id,
      dutyDate: row.dutyDate,
      dayType: row.dayType,
      attendanceResult: row.attendanceResult,
      workContext: row.workContext,
      leaveType: row.leaveType ?? null,
      lateFlag: row.lateFlag,
      dailyRate: row.dailyRate == null ? null : Number(row.dailyRate),
      halfDayFactor: row.halfDayFactor == null ? null : Number(row.halfDayFactor),
      note: row.note ?? null,
    })),
    selectedChargeSummary: {
      itemCount: selectedChargeSummaryRaw.itemCount,
      totalRemaining: selectedChargeSummaryRaw.totalRemaining,
      items: selectedChargeSummaryRaw.items.map((item) => ({
        chargeKind: item.chargeKind,
        chargeId: item.chargeId,
        employeeLabel: item.employeeLabel,
        amount: item.amount,
        paid: item.paid,
        remaining: item.remaining,
        status: item.status,
        note: item.note ?? null,
        createdAt: item.createdAt,
        varianceId: item.varianceId ?? null,
        runId: item.runId ?? null,
        shiftId: item.shiftId ?? null,
      })),
    },
    selectedOverride,
    unresolvedCashierCharges: unresolvedCashierChargesRaw.map((item) => ({
      chargeId: item.chargeId,
      cashierUserId: item.cashierUserId,
      cashierLabel: item.cashierLabel,
      amount: item.amount,
      paid: item.paid,
      remaining: item.remaining,
      status: item.status,
      note: item.note ?? null,
      createdAt: item.createdAt,
      reason: item.reason,
    })),
    saved,
    suggestedDraft: {
      ...resolveSuggestedDraftWindow(
        effectivePolicy?.payFrequency ?? null,
        new Date(),
      ),
      payDate: formatDateInput(new Date()),
      payFrequency: effectivePolicy?.payFrequency ?? null,
      customCutoffNote: effectivePolicy?.customCutoffNote ?? null,
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);
  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");

  try {
    if (intent === "create-run") {
      const periodStart = String(fd.get("periodStart") || "");
      const periodEnd = String(fd.get("periodEnd") || "");
      const payDate = String(fd.get("payDate") || "");
      const note = String(fd.get("note") || "");

      const run = await createWorkerPayrollRunDraft({
        periodStart,
        periodEnd,
        payDate,
        note,
        createdById: me.userId,
      });

      return redirect(
        buildPayrollRedirect({
          runId: run.id,
          saved: "created",
        }),
      );
    }

    if (intent === "rebuild-run") {
      const payrollRunId = parseOptionalInt(String(fd.get("payrollRunId") || ""));
      const employeeId = parseOptionalInt(String(fd.get("employeeId") || ""));
      if (!payrollRunId) throw new Error("Payroll run is required.");

      await rebuildWorkerPayrollRunLines(payrollRunId);
      return redirect(
        buildPayrollRedirect({
          runId: payrollRunId,
          employeeId,
          saved: "rebuilt",
        }),
      );
    }

    if (intent === "save-override") {
      const payrollRunId = parseOptionalInt(String(fd.get("payrollRunId") || ""));
      const employeeId = parseOptionalInt(String(fd.get("employeeId") || ""));
      if (!payrollRunId || !employeeId) {
        throw new Error("Run and employee are required.");
      }

      const sickLeavePayTreatment = String(
        fd.get("sickLeavePayTreatment") || "",
      );
      const attendanceIncentiveMode = String(
        fd.get("attendanceIncentiveMode") || "DEFAULT",
      );
      const restDayWorkedPremiumPercentRaw = String(
        fd.get("restDayWorkedPremiumPercent") || "",
      ).trim();
      const regularHolidayWorkedPremiumPercentRaw = String(
        fd.get("regularHolidayWorkedPremiumPercent") || "",
      ).trim();
      const specialHolidayWorkedPremiumPercentRaw = String(
        fd.get("specialHolidayWorkedPremiumPercent") || "",
      ).trim();
      const attendanceIncentiveAmountRaw = String(
        fd.get("attendanceIncentiveAmount") || "",
      ).trim();
      const note = String(fd.get("note") || "");

      await saveWorkerPayrollRunEmployeeOverride({
        payrollRunId,
        employeeId,
        sickLeavePayTreatment:
          sickLeavePayTreatment === SICK_LEAVE_PAY_TREATMENT.PAID ||
          sickLeavePayTreatment === SICK_LEAVE_PAY_TREATMENT.UNPAID
            ? sickLeavePayTreatment
            : null,
        restDayWorkedPremiumPercent:
          restDayWorkedPremiumPercentRaw.length > 0
            ? Number(restDayWorkedPremiumPercentRaw)
            : null,
        regularHolidayWorkedPremiumPercent:
          regularHolidayWorkedPremiumPercentRaw.length > 0
            ? Number(regularHolidayWorkedPremiumPercentRaw)
            : null,
        specialHolidayWorkedPremiumPercent:
          specialHolidayWorkedPremiumPercentRaw.length > 0
            ? Number(specialHolidayWorkedPremiumPercentRaw)
            : null,
        attendanceIncentiveMode:
          attendanceIncentiveMode === "FORCE_ALLOW" ||
          attendanceIncentiveMode === "FORCE_BLOCK"
            ? attendanceIncentiveMode
            : "DEFAULT",
        attendanceIncentiveAmount:
          attendanceIncentiveAmountRaw.length > 0
            ? Number(attendanceIncentiveAmountRaw)
            : null,
        note,
        actorUserId: me.userId,
      });
      await rebuildWorkerPayrollRunLines(payrollRunId);

      return redirect(
        buildPayrollRedirect({
          runId: payrollRunId,
          employeeId,
          saved: "override",
        }),
      );
    }

    if (intent === "apply-deduction") {
      const payrollRunId = parseOptionalInt(String(fd.get("payrollRunId") || ""));
      const payrollRunLineId = parseOptionalInt(
        String(fd.get("payrollRunLineId") || ""),
      );
      const employeeId = parseOptionalInt(String(fd.get("employeeId") || ""));
      const amount = Number(fd.get("amount") || 0);
      const note = String(fd.get("note") || "");

      if (!payrollRunId || !payrollRunLineId || !employeeId) {
        throw new Error("Payroll deduction context is incomplete.");
      }

      await applyWorkerPayrollChargeDeduction({
        employeeId,
        amount,
        note,
        payrollRunLineId,
        recordedByUserId: me.userId,
      });

      return redirect(
        buildPayrollRedirect({
          runId: payrollRunId,
          employeeId,
          saved: "deduction",
        }),
      );
    }

    if (intent === "finalize-run") {
      const payrollRunId = parseOptionalInt(String(fd.get("payrollRunId") || ""));
      if (!payrollRunId) throw new Error("Payroll run is required.");

      await finalizeWorkerPayrollRun(payrollRunId, me.userId);
      return redirect(
        buildPayrollRedirect({
          runId: payrollRunId,
          saved: "finalized",
        }),
      );
    }

    if (intent === "mark-paid") {
      const payrollRunId = parseOptionalInt(String(fd.get("payrollRunId") || ""));
      if (!payrollRunId) throw new Error("Payroll run is required.");

      await markWorkerPayrollRunPaid(payrollRunId, me.userId);
      return redirect(
        buildPayrollRedirect({
          runId: payrollRunId,
          saved: "paid",
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
            : "Unable to save payroll changes.",
        action: intent,
      },
      { status: 400 },
    );
  }
}

export default function StorePayrollPage() {
  const {
    runs,
    selectedRun,
    selectedLine,
    selectedAttendanceRows,
    selectedChargeSummary,
    selectedOverride,
    unresolvedCashierCharges,
    saved,
    suggestedDraft,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const hasAttendanceBackedLineGap = Boolean(
    selectedRun &&
      (selectedRun.attendanceBackedLineCount === 0 ||
        selectedRun.nonAttendanceBackedLineCount > 0),
  );
  const finalizeBlockedByAttendance = hasAttendanceBackedLineGap;
  const finalizeBlocked =
    finalizeBlockedByAttendance || unresolvedCashierCharges.length > 0;
  const payrollAttendanceGuardMessage = selectedRun
    ? selectedRun.attendanceBackedLineCount === 0
      ? selectedRun.status === PAYROLL_RUN_STATUS.DRAFT
        ? "This draft has no attendance-backed payroll lines yet. Rebuild after attendance review. Payroll-tagged charges stay open for a future payroll until a worker has attendance facts in this cutoff."
        : "This run has no attendance-backed payroll lines, so payout updates stay blocked."
      : selectedRun.nonAttendanceBackedLineCount > 0
        ? `This run still contains ${selectedRun.nonAttendanceBackedLineCount} line(s) without attendance facts. Rebuild after fixing attendance or salary setup before payout.`
        : null
    : null;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Payroll Runs"
        subtitle="Review attendance-backed daily pay, include employee statutory deductions when policy enables them, apply tagged charge deductions, and freeze payroll snapshots per cutoff."
        backTo="/store"
        backLabel="Manager Dashboard"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {saved ? (
          <SoTAlert tone="success">
            {saved === "created" && "Payroll run draft created."}
            {saved === "rebuilt" && "Payroll lines rebuilt from attendance facts."}
            {saved === "override" && "Manager override saved and payroll lines rebuilt."}
            {saved === "deduction" && "Payroll deduction posted to the charge ledgers."}
            {saved === "finalized" && "Payroll run finalized and frozen."}
            {saved === "paid" && "Payroll run marked paid."}
          </SoTAlert>
        ) : null}
        {actionData && !actionData.ok ? (
          <SoTAlert tone="warning">{actionData.error}</SoTAlert>
        ) : null}

        {unresolvedCashierCharges.length > 0 ? (
          <SoTCard tone="warning" className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Cashier identity blocker
              </h2>
              <p className="text-xs text-slate-600">
                Payroll finalization is blocked while payroll-tagged cashier charges
                still point to users without linked employee records.
              </p>
            </div>
            <div className="grid gap-2">
              {unresolvedCashierCharges.slice(0, 4).map((charge) => (
                <div
                  key={charge.chargeId}
                  className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  Charge #{charge.chargeId} · {charge.cashierLabel} · Remaining{" "}
                  <span className="font-semibold text-amber-900">
                    {peso(charge.remaining)}
                  </span>
                </div>
              ))}
            </div>
          </SoTCard>
        ) : null}
        {payrollAttendanceGuardMessage ? (
          <SoTCard tone="warning" className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Attendance-backed payroll guard
              </h2>
              <p className="text-xs text-slate-600">{payrollAttendanceGuardMessage}</p>
            </div>
          </SoTCard>
        ) : null}

        <SoTCard interaction="form" className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Create payroll draft
              </h2>
              <p className="text-xs text-slate-500">
                Suggested range follows the current company payroll policy.
                {suggestedDraft.payFrequency
                  ? ` Current pay frequency: ${suggestedDraft.payFrequency}.`
                  : ""}
              </p>
            </div>
            <Link
              to="/store/rider-ar"
              className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Rider AR
            </Link>
          </div>

          <Form method="post" className="grid gap-3 md:grid-cols-4">
            <input type="hidden" name="_intent" value="create-run" />
            <SoTFormField label="Period start">
              <SoTInput
                type="date"
                name="periodStart"
                defaultValue={suggestedDraft.periodStart}
                required
              />
            </SoTFormField>
            <SoTFormField label="Period end">
              <SoTInput
                type="date"
                name="periodEnd"
                defaultValue={suggestedDraft.periodEnd}
                required
              />
            </SoTFormField>
            <SoTFormField label="Pay date">
              <SoTInput
                type="date"
                name="payDate"
                defaultValue={suggestedDraft.payDate}
                required
              />
            </SoTFormField>
            <SoTFormField label="Draft note">
              <SoTInput
                name="note"
                placeholder={
                  suggestedDraft.customCutoffNote || "Cutoff note or manager context"
                }
              />
            </SoTFormField>
            <div className="md:col-span-4">
              <SoTButton type="submit" variant="primary">
                Create payroll draft
              </SoTButton>
            </div>
          </Form>
        </SoTCard>

        <SoTCard className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Payroll run library</h2>
            <p className="text-xs text-slate-500">
              Open a draft to rebuild lines, review payroll, apply deductions, and finalize.
            </p>
          </div>

          <SoTTable>
            <SoTTableHead>
              <SoTTableRow>
                <SoTTh>Cutoff</SoTTh>
                <SoTTh>Status</SoTTh>
                <SoTTh align="right">Employees</SoTTh>
                <SoTTh align="right">Gross</SoTTh>
                <SoTTh align="right">Net</SoTTh>
                <SoTTh>Action</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {runs.length === 0 ? (
                <SoTTableEmptyRow
                  colSpan={6}
                  message="No payroll runs yet. Create the first draft above."
                />
              ) : (
                runs.map((run) => (
                  <SoTTableRow key={run.id}>
                    <SoTTd>
                      <div className="space-y-1">
                        <div className="font-medium text-slate-900">
                          {formatDateLabel(run.periodStart)} to{" "}
                          {formatDateLabel(run.periodEnd)}
                        </div>
                        <div className="text-xs text-slate-500">
                          Pay date {formatDateLabel(run.payDate)} · {run.payFrequency}
                        </div>
                      </div>
                    </SoTTd>
                    <SoTTd>
                      <div className="space-y-1">
                        <SoTStatusBadge tone={statusTone(run.status)}>
                          {run.status}
                        </SoTStatusBadge>
                        <div className="text-xs text-slate-500">
                          Created by {run.createdByLabel}
                        </div>
                      </div>
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums">
                      {run.lineCount}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums">
                      {peso(run.grossTotal)}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums">
                      {peso(run.netTotal)}
                    </SoTTd>
                    <SoTTd>
                      <Link
                        to={buildPayrollRedirect({ runId: run.id })}
                        className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium ${
                          selectedRun?.id === run.id
                            ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                            : "border-slate-300 bg-white text-slate-700"
                        }`}
                      >
                        {selectedRun?.id === run.id ? "Selected" : "Open"}
                      </Link>
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>
        </SoTCard>

        {selectedRun ? (
          <>
            <SoTCard className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Selected payroll run
                  </h2>
                  <p className="text-xs text-slate-500">
                    {formatDateLabel(selectedRun.periodStart)} to{" "}
                    {formatDateLabel(selectedRun.periodEnd)} · Pay date{" "}
                    {formatDateLabel(selectedRun.payDate)}
                  </p>
                </div>
                <SoTStatusBadge tone={statusTone(selectedRun.status)}>
                  {selectedRun.status}
                </SoTStatusBadge>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard
                  label="Employees"
                  value={String(selectedRun.lines.length)}
                  tone="info"
                />
                <MetricCard
                  label="Gross pay"
                  value={peso(selectedRun.totals.grossTotal)}
                  tone="success"
                />
                <MetricCard
                  label="Deductions"
                  value={peso(selectedRun.totals.deductionTotal)}
                  tone="warning"
                />
                <MetricCard
                  label="Net pay"
                  value={peso(selectedRun.totals.netTotal)}
                  tone="info"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedRun.status === PAYROLL_RUN_STATUS.DRAFT ? (
                  <>
                    <Form method="post">
                      <input type="hidden" name="_intent" value="rebuild-run" />
                      <input type="hidden" name="payrollRunId" value={selectedRun.id} />
                      {selectedLine ? (
                        <input
                          type="hidden"
                          name="employeeId"
                          value={selectedLine.employeeId}
                        />
                      ) : null}
                      <SoTButton type="submit" variant="primary">
                        Rebuild payroll lines
                      </SoTButton>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="_intent" value="finalize-run" />
                      <input type="hidden" name="payrollRunId" value={selectedRun.id} />
                      <SoTButton type="submit" disabled={finalizeBlocked}>
                        Finalize run
                      </SoTButton>
                    </Form>
                  </>
                ) : null}
                {selectedRun.status === PAYROLL_RUN_STATUS.FINALIZED ? (
                  <Form method="post">
                    <input type="hidden" name="_intent" value="mark-paid" />
                    <input type="hidden" name="payrollRunId" value={selectedRun.id} />
                    <SoTButton
                      type="submit"
                      variant="primary"
                      disabled={finalizeBlockedByAttendance}
                    >
                      Mark paid
                    </SoTButton>
                  </Form>
                ) : null}
              </div>
              {selectedRun.status === PAYROLL_RUN_STATUS.DRAFT && finalizeBlocked ? (
                <p className="text-xs text-amber-700">
                  Finalization stays disabled until this run has attendance-backed
                  payroll lines only.
                </p>
              ) : null}
              {selectedRun.status === PAYROLL_RUN_STATUS.FINALIZED &&
              finalizeBlockedByAttendance ? (
                <p className="text-xs text-amber-700">
                  Paid-state updates stay disabled until the run is corrected into an
                  attendance-backed payroll snapshot.
                </p>
              ) : null}

              <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 md:grid-cols-2">
                <div>Created: {formatDateTimeLabel(selectedRun.createdAt)}</div>
                <div>Created by: {selectedRun.createdByLabel}</div>
                <div>Finalized: {formatDateTimeLabel(selectedRun.finalizedAt)}</div>
                <div>Finalized by: {selectedRun.finalizedByLabel}</div>
                <div>Paid: {formatDateTimeLabel(selectedRun.paidAt)}</div>
                <div>Paid by: {selectedRun.paidByLabel}</div>
              </div>
            </SoTCard>

            <div className="grid gap-5 lg:grid-cols-12">
              <section className="lg:col-span-7">
                <SoTCard className="space-y-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Payroll lines
                    </h2>
                    <p className="text-xs text-slate-500">
                      Review base pay, additions, deductions, and final net pay per employee.
                    </p>
                  </div>

                  <SoTTable>
                    <SoTTableHead>
                      <SoTTableRow>
                        <SoTTh>Employee</SoTTh>
                        <SoTTh align="right">Base</SoTTh>
                        <SoTTh align="right">Additions</SoTTh>
                        <SoTTh align="right">Deductions</SoTTh>
                        <SoTTh align="right">Net</SoTTh>
                        <SoTTh>Action</SoTTh>
                      </SoTTableRow>
                    </SoTTableHead>
                    <tbody>
                      {selectedRun.lines.length === 0 ? (
                        <SoTTableEmptyRow
                          colSpan={6}
                          message="No payroll lines yet. Rebuild this draft first."
                        />
                      ) : (
                        selectedRun.lines.map((line) => (
                          <SoTTableRow key={line.id}>
                            <SoTTd>
                              <div className="space-y-1">
                                <div className="font-medium text-slate-900">
                                  {line.employeeLabel}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {line.employeeRole}
                                  {line.additionSnapshot.managerOverrideApplied ||
                                  line.managerOverrideNote ? " · Override" : ""}
                                </div>
                              </div>
                            </SoTTd>
                            <SoTTd align="right" className="tabular-nums">
                              {peso(line.baseAttendancePay)}
                            </SoTTd>
                            <SoTTd align="right" className="tabular-nums">
                              {peso(line.totalAdditions)}
                            </SoTTd>
                            <SoTTd align="right" className="tabular-nums text-rose-700">
                              {peso(line.totalDeductions)}
                            </SoTTd>
                            <SoTTd align="right" className="tabular-nums font-medium">
                              {peso(line.netPay)}
                            </SoTTd>
                            <SoTTd>
                              <Link
                                to={buildPayrollRedirect({
                                  runId: selectedRun.id,
                                  employeeId: line.employeeId,
                                })}
                                className={`inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium ${
                                  selectedLine?.employeeId === line.employeeId
                                    ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                                    : "border-slate-300 bg-white text-slate-700"
                                }`}
                              >
                                {selectedLine?.employeeId === line.employeeId
                                  ? "Selected"
                                  : "Review"}
                              </Link>
                            </SoTTd>
                          </SoTTableRow>
                        ))
                      )}
                    </tbody>
                  </SoTTable>
                </SoTCard>
              </section>

              <aside className="space-y-5 lg:col-span-5">
                {selectedLine ? (
                  <>
                    <SoTCard className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-semibold text-slate-900">
                            Selected employee
                          </h2>
                          <p className="text-xs text-slate-500">
                            {selectedLine.employeeLabel} · {selectedLine.employeeRole}
                          </p>
                        </div>
                        <SoTStatusBadge tone={statusTone(selectedRun.status)}>
                          {selectedRun.status}
                        </SoTStatusBadge>
                      </div>

                      <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <div>Base attendance pay: {peso(selectedLine.baseAttendancePay)}</div>
                        <div>
                          Attendance incentive:{" "}
                          {peso(selectedLine.attendanceIncentiveAmount)}
                        </div>
                        <div>Gross pay: {peso(selectedLine.grossPay)}</div>
                        <div>
                          Government deductions:{" "}
                          {peso(selectedLine.statutoryDeductionAmount)}
                        </div>
                        <div>
                          Charge deductions: {peso(selectedLine.chargeDeductionAmount)}
                        </div>
                        <div>Total deductions: {peso(selectedLine.totalDeductions)}</div>
                        <div>Net pay: {peso(selectedLine.netPay)}</div>
                      </div>
                    </SoTCard>

                    {selectedRun.status === PAYROLL_RUN_STATUS.DRAFT ? (
                      <SoTCard interaction="form" className="space-y-4">
                        <div>
                          <h2 className="text-sm font-semibold text-slate-900">
                            Manager override
                          </h2>
                          <p className="text-xs text-slate-500">
                            Override sick-leave treatment, premiums, or attendance
                            incentive for this employee before finalization.
                          </p>
                        </div>

                        <Form method="post" className="space-y-3">
                          <input type="hidden" name="_intent" value="save-override" />
                          <input
                            type="hidden"
                            name="payrollRunId"
                            value={selectedRun.id}
                          />
                          <input
                            type="hidden"
                            name="employeeId"
                            value={selectedLine.employeeId}
                          />

                          <SoTFormField label="Sick leave treatment">
                            <SelectInput
                              name="sickLeavePayTreatment"
                              defaultValue={selectedOverride?.sickLeavePayTreatment ?? ""}
                              options={[
                                { value: "", label: "Use policy default" },
                                {
                                  value: SICK_LEAVE_PAY_TREATMENT.PAID,
                                  label: "Force paid",
                                },
                                {
                                  value: SICK_LEAVE_PAY_TREATMENT.UNPAID,
                                  label: "Force unpaid",
                                },
                              ]}
                            />
                          </SoTFormField>

                          <div className="grid gap-3 md:grid-cols-3">
                            <SoTFormField label="Rest-day premium %">
                              <SoTInput
                                name="restDayWorkedPremiumPercent"
                                inputMode="decimal"
                                defaultValue={
                                  selectedOverride?.restDayWorkedPremiumPercent ?? ""
                                }
                                placeholder="Default"
                              />
                            </SoTFormField>
                            <SoTFormField label="Regular holiday %">
                              <SoTInput
                                name="regularHolidayWorkedPremiumPercent"
                                inputMode="decimal"
                                defaultValue={
                                  selectedOverride?.regularHolidayWorkedPremiumPercent ??
                                  ""
                                }
                                placeholder="Default"
                              />
                            </SoTFormField>
                            <SoTFormField label="Special holiday %">
                              <SoTInput
                                name="specialHolidayWorkedPremiumPercent"
                                inputMode="decimal"
                                defaultValue={
                                  selectedOverride?.specialHolidayWorkedPremiumPercent ??
                                  ""
                                }
                                placeholder="Default"
                              />
                            </SoTFormField>
                          </div>

                          <SoTFormField label="Attendance incentive mode">
                            <SelectInput
                              name="attendanceIncentiveMode"
                              defaultValue={
                                selectedOverride?.attendanceIncentiveMode ?? "DEFAULT"
                              }
                              options={[
                                { value: "DEFAULT", label: "Use policy default" },
                                { value: "FORCE_ALLOW", label: "Force allow" },
                                { value: "FORCE_BLOCK", label: "Force block" },
                              ]}
                            />
                          </SoTFormField>

                          <SoTFormField label="Attendance incentive amount">
                            <SoTInput
                              name="attendanceIncentiveAmount"
                              inputMode="decimal"
                              defaultValue={
                                selectedOverride?.attendanceIncentiveAmount ?? ""
                              }
                              placeholder="Default"
                            />
                          </SoTFormField>

                          <SoTTextarea
                            name="note"
                            label="Override note"
                            rows={3}
                            defaultValue={selectedOverride?.note ?? ""}
                            placeholder="Why this employee needs a payroll override"
                          />

                          <SoTButton type="submit" variant="primary">
                            Save override and rebuild
                          </SoTButton>
                        </Form>
                      </SoTCard>
                    ) : null}

                    <SoTCard className="space-y-4">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900">
                          Deduction review
                        </h2>
                        <p className="text-xs text-slate-500">
                          Policy-driven government deductions:{" "}
                          {peso(selectedLine.statutoryDeductionAmount)}.{" "}
                          Current open payroll-tagged charges:{" "}
                          {peso(selectedChargeSummary.totalRemaining)} across{" "}
                          {selectedChargeSummary.itemCount} item(s).
                        </p>
                      </div>

                      <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        <div>
                          SSS:{" "}
                          {peso(selectedLine.statutoryDeductionSnapshot.sssAmount)}
                        </div>
                        <div>
                          PhilHealth:{" "}
                          {peso(
                            selectedLine.statutoryDeductionSnapshot.philhealthAmount,
                          )}
                        </div>
                        <div>
                          Pag-IBIG:{" "}
                          {peso(selectedLine.statutoryDeductionSnapshot.pagIbigAmount)}
                        </div>
                        <div>
                          Charge deductions applied in this run:{" "}
                          {peso(selectedLine.chargeDeductionAmount)}
                        </div>
                        <div>
                          Last charge deduction at:{" "}
                          {formatDateTimeLabel(
                            selectedLine.deductionSnapshot.lastAppliedAt,
                          )}
                        </div>
                      </div>

                      {selectedRun.status === PAYROLL_RUN_STATUS.DRAFT ? (
                        <div className="space-y-3">
                          <Form method="post" className="space-y-3">
                            <input type="hidden" name="_intent" value="apply-deduction" />
                            <input
                              type="hidden"
                              name="payrollRunId"
                              value={selectedRun.id}
                            />
                            <input
                              type="hidden"
                              name="payrollRunLineId"
                              value={selectedLine.id}
                            />
                            <input
                              type="hidden"
                              name="employeeId"
                              value={selectedLine.employeeId}
                            />

                            <div className="grid gap-3 md:grid-cols-2">
                              <SoTFormField label="Deduction amount">
                                <SoTInput
                                  name="amount"
                                  inputMode="decimal"
                                  placeholder="Enter partial deduction"
                                  required
                                />
                              </SoTFormField>
                              <SoTFormField label="Reference note">
                                <SoTInput
                                  name="note"
                                  placeholder="Cutoff / note / reason"
                                  required
                                />
                              </SoTFormField>
                            </div>

                            <SoTButton type="submit" variant="primary">
                              Apply partial deduction
                            </SoTButton>
                          </Form>

                          <Form method="post" className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <input type="hidden" name="_intent" value="apply-deduction" />
                            <input
                              type="hidden"
                              name="payrollRunId"
                              value={selectedRun.id}
                            />
                            <input
                              type="hidden"
                              name="payrollRunLineId"
                              value={selectedLine.id}
                            />
                            <input
                              type="hidden"
                              name="employeeId"
                              value={selectedLine.employeeId}
                            />
                            <input
                              type="hidden"
                              name="amount"
                              value={selectedChargeSummary.totalRemaining}
                            />
                            <SoTFormField label="Full-deduction note">
                              <SoTInput
                                name="note"
                                placeholder="Reference for full deduction"
                                required
                              />
                            </SoTFormField>
                            <SoTButton
                              type="submit"
                              disabled={selectedChargeSummary.totalRemaining <= 0}
                            >
                              Apply full remaining balance
                            </SoTButton>
                          </Form>
                        </div>
                      ) : null}

                      <SoTTable>
                        <SoTTableHead>
                          <SoTTableRow>
                            <SoTTh>Charge</SoTTh>
                            <SoTTh>Status</SoTTh>
                            <SoTTh align="right">Remaining</SoTTh>
                          </SoTTableRow>
                        </SoTTableHead>
                        <tbody>
                          {selectedChargeSummary.items.length === 0 ? (
                            <SoTTableEmptyRow
                              colSpan={3}
                              message="No open payroll-tagged charges for this employee."
                            />
                          ) : (
                            selectedChargeSummary.items.map((item) => (
                              <SoTTableRow key={`${item.chargeKind}-${item.chargeId}`}>
                                <SoTTd>
                                  <div className="space-y-1">
                                    <div className="font-medium text-slate-900">
                                      {item.chargeKind} charge #{item.chargeId}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {item.runId
                                        ? `Run #${item.runId}`
                                        : item.shiftId
                                          ? `Shift #${item.shiftId}`
                                          : "Direct charge"}{" "}
                                      · Created {formatDateTimeLabel(item.createdAt)}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      Note: {item.note || "No note"}
                                    </div>
                                  </div>
                                </SoTTd>
                                <SoTTd>
                                  <SoTStatusBadge tone="warning">
                                    {item.status}
                                  </SoTStatusBadge>
                                </SoTTd>
                                <SoTTd align="right" className="tabular-nums text-rose-700">
                                  {peso(item.remaining)}
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
                          Attendance facts used in this run
                        </h2>
                        <p className="text-xs text-slate-500">
                          These are the frozen attendance inputs payroll computed from.
                        </p>
                      </div>

                      <SoTTable>
                        <SoTTableHead>
                          <SoTTableRow>
                            <SoTTh>Date</SoTTh>
                            <SoTTh>Result</SoTTh>
                            <SoTTh>Context</SoTTh>
                            <SoTTh align="right">Rate</SoTTh>
                          </SoTTableRow>
                        </SoTTableHead>
                        <tbody>
                          {selectedAttendanceRows.length === 0 ? (
                            <SoTTableEmptyRow
                              colSpan={4}
                              message="No attendance rows found in this payroll window."
                            />
                          ) : (
                            selectedAttendanceRows.map((row) => (
                              <SoTTableRow key={row.id}>
                                <SoTTd>
                                  <div className="space-y-1">
                                    <div className="font-medium text-slate-900">
                                      {formatDateLabel(row.dutyDate)}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {row.dayType}
                                    </div>
                                  </div>
                                </SoTTd>
                                <SoTTd>
                                  <div className="space-y-1">
                                    <SoTStatusBadge tone="info">
                                      {row.attendanceResult}
                                    </SoTStatusBadge>
                                    <div className="text-xs text-slate-500">
                                      {row.leaveType || "No leave"} · Late {row.lateFlag}
                                    </div>
                                  </div>
                                </SoTTd>
                                <SoTTd>
                                  <div className="text-sm text-slate-700">
                                    {row.workContext}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {row.note || "No note"}
                                  </div>
                                </SoTTd>
                                <SoTTd align="right" className="tabular-nums">
                                  {row.dailyRate == null ? "—" : peso(row.dailyRate)}
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
                      Select a payroll line to review payroll inputs and deductions.
                    </p>
                  </SoTCard>
                )}
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  tone = "info",
}: {
  label: string;
  value: string;
  tone?: "info" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50/40"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/40"
        : "border-sky-200 bg-sky-50/40";

  return (
    <div className={`rounded-2xl border p-3 shadow-sm ${toneClass}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}
