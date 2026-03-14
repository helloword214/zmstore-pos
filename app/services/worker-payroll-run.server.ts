import {
  AttendanceResult,
  CashierChargePaymentMethod,
  CashierChargeStatus,
  CashierVarianceStatus,
  PayrollRunStatus,
  Prisma,
  RiderChargePaymentMethod,
  RiderChargeStatus,
  RiderVarianceStatus,
  SickLeavePayTreatment,
} from "@prisma/client";
import { db } from "~/utils/db.server";
import {
  listOpenPayrollTaggedChargeItems,
  listOpenPayrollTaggedChargeItemsForEmployee,
  listUnresolvedCashierPayrollCharges,
  type PayrollTaggedChargeItem,
} from "~/services/worker-payroll-identity.server";
import {
  getEffectiveCompanyPayrollPolicy,
  snapshotCompanyPayrollPolicy,
  type CompanyPayrollPolicySnapshot,
  type WorkforceDbClient,
  type WorkforceRootDbClient,
} from "~/services/worker-payroll-policy.server";

type AttendanceRow = Awaited<
  ReturnType<typeof db.attendanceDutyResult.findMany>
>[number];

export type PayrollDeductionSnapshot = {
  openChargeCount: number;
  openChargeRemaining: number;
  appliedPayments: Array<{
    chargeKind: "RIDER" | "CASHIER";
    chargeId: number;
    amount: number;
    createdAt: string;
  }>;
  lastAppliedAt: string | null;
};

export type PayrollRunEmployeeOverride = {
  sickLeavePayTreatment: SickLeavePayTreatment | null;
  restDayWorkedPremiumPercent: number | null;
  regularHolidayWorkedPremiumPercent: number | null;
  specialHolidayWorkedPremiumPercent: number | null;
  attendanceIncentiveMode: "DEFAULT" | "FORCE_ALLOW" | "FORCE_BLOCK";
  attendanceIncentiveAmount: number | null;
  note: string | null;
};

export type PayrollRunManagerOverrideSnapshot = {
  employeeOverrides: Record<string, PayrollRunEmployeeOverride>;
  updatedAt: string | null;
  updatedById: number | null;
};

export type PayrollRunLineAdditionSnapshot = {
  attendanceIncentiveEligible: boolean;
  attendanceIncentiveReasons: string[];
  attendanceIncentiveAmount: number;
  attendanceIncentiveMode: "DEFAULT" | "FORCE_ALLOW" | "FORCE_BLOCK";
  managerOverrideApplied: boolean;
};

export type EffectivePayrollLinePolicySnapshot = CompanyPayrollPolicySnapshot & {
  managerOverrideApplied: boolean;
  managerOverride: PayrollRunEmployeeOverride | null;
};

const MONEY_EPS = 0.009;

const roundMoney = (value: number) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const toDateOnly = (value: Date | string) => {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const toMoneyDecimal = (value: number) => new Prisma.Decimal(value.toFixed(2));

const normalizeNullableNumber = (value: unknown) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeOverrideInput = (
  input: Partial<PayrollRunEmployeeOverride> | null | undefined,
): PayrollRunEmployeeOverride => ({
  sickLeavePayTreatment:
    input?.sickLeavePayTreatment === SickLeavePayTreatment.PAID ||
    input?.sickLeavePayTreatment === SickLeavePayTreatment.UNPAID
      ? input.sickLeavePayTreatment
      : null,
  restDayWorkedPremiumPercent: normalizeNullableNumber(
    input?.restDayWorkedPremiumPercent,
  ),
  regularHolidayWorkedPremiumPercent: normalizeNullableNumber(
    input?.regularHolidayWorkedPremiumPercent,
  ),
  specialHolidayWorkedPremiumPercent: normalizeNullableNumber(
    input?.specialHolidayWorkedPremiumPercent,
  ),
  attendanceIncentiveMode:
    input?.attendanceIncentiveMode === "FORCE_ALLOW" ||
    input?.attendanceIncentiveMode === "FORCE_BLOCK"
      ? input.attendanceIncentiveMode
      : "DEFAULT",
  attendanceIncentiveAmount: normalizeNullableNumber(
    input?.attendanceIncentiveAmount,
  ),
  note:
    typeof input?.note === "string" && input.note.trim().length > 0
      ? input.note.trim()
      : null,
});

const hasMeaningfulOverride = (override: PayrollRunEmployeeOverride | null) =>
  Boolean(
    override &&
      (override.sickLeavePayTreatment != null ||
        override.restDayWorkedPremiumPercent != null ||
        override.regularHolidayWorkedPremiumPercent != null ||
        override.specialHolidayWorkedPremiumPercent != null ||
        override.attendanceIncentiveMode !== "DEFAULT" ||
        override.attendanceIncentiveAmount != null ||
        override.note),
  );

export const parsePolicySnapshot = (
  snapshot: Prisma.JsonValue | null,
): CompanyPayrollPolicySnapshot | null => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  return snapshot as CompanyPayrollPolicySnapshot;
};

export const parsePayrollDeductionSnapshot = (
  snapshot: Prisma.JsonValue | null,
): PayrollDeductionSnapshot => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      openChargeCount: 0,
      openChargeRemaining: 0,
      appliedPayments: [],
      lastAppliedAt: null,
    };
  }

  const raw = snapshot as Partial<PayrollDeductionSnapshot>;
  return {
    openChargeCount: Number(raw.openChargeCount ?? 0),
    openChargeRemaining: Number(raw.openChargeRemaining ?? 0),
    appliedPayments: Array.isArray(raw.appliedPayments)
      ? raw.appliedPayments.map((item) => ({
          chargeKind: item.chargeKind === "CASHIER" ? "CASHIER" : "RIDER",
          chargeId: Number(item.chargeId ?? 0),
          amount: Number(item.amount ?? 0),
          createdAt: String(item.createdAt ?? ""),
        }))
      : [],
    lastAppliedAt:
      typeof raw.lastAppliedAt === "string" ? raw.lastAppliedAt : null,
  };
};

export const parsePayrollRunManagerOverrideSnapshot = (
  snapshot: Prisma.JsonValue | null,
): PayrollRunManagerOverrideSnapshot => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      employeeOverrides: {},
      updatedAt: null,
      updatedById: null,
    };
  }

  const raw = snapshot as {
    employeeOverrides?: Record<string, Partial<PayrollRunEmployeeOverride>>;
    updatedAt?: unknown;
    updatedById?: unknown;
  };

  const employeeOverrides = Object.fromEntries(
    Object.entries(raw.employeeOverrides ?? {}).map(([employeeId, override]) => [
      employeeId,
      normalizeOverrideInput(override),
    ]),
  );

  return {
    employeeOverrides,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedById:
      Number.isFinite(Number(raw.updatedById)) && Number(raw.updatedById) > 0
        ? Number(raw.updatedById)
        : null,
  };
};

export const parsePayrollRunLineAdditionSnapshot = (
  snapshot: Prisma.JsonValue | null,
): PayrollRunLineAdditionSnapshot => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      attendanceIncentiveEligible: false,
      attendanceIncentiveReasons: [],
      attendanceIncentiveAmount: 0,
      attendanceIncentiveMode: "DEFAULT",
      managerOverrideApplied: false,
    };
  }

  const raw = snapshot as Partial<PayrollRunLineAdditionSnapshot>;
  return {
    attendanceIncentiveEligible: Boolean(raw.attendanceIncentiveEligible),
    attendanceIncentiveReasons: Array.isArray(raw.attendanceIncentiveReasons)
      ? raw.attendanceIncentiveReasons.map((reason) => String(reason))
      : [],
    attendanceIncentiveAmount: Number(raw.attendanceIncentiveAmount ?? 0),
    attendanceIncentiveMode:
      raw.attendanceIncentiveMode === "FORCE_ALLOW" ||
      raw.attendanceIncentiveMode === "FORCE_BLOCK"
        ? raw.attendanceIncentiveMode
        : "DEFAULT",
    managerOverrideApplied: Boolean(raw.managerOverrideApplied),
  };
};

export const getWorkerPayrollRunEmployeeOverride = (
  snapshot: Prisma.JsonValue | null,
  employeeId: number,
) =>
  parsePayrollRunManagerOverrideSnapshot(snapshot).employeeOverrides[
    String(employeeId)
  ] ?? null;

const requiresFrozenPayBasis = (row: AttendanceRow) =>
  row.attendanceResult !== AttendanceResult.NOT_REQUIRED &&
  row.attendanceResult !== AttendanceResult.ABSENT &&
  row.attendanceResult !== AttendanceResult.SUSPENDED_NO_WORK;

const buildEffectivePolicySnapshot = (
  policy: CompanyPayrollPolicySnapshot,
  employeeOverride: PayrollRunEmployeeOverride | null,
): EffectivePayrollLinePolicySnapshot => ({
  ...policy,
  sickLeavePayTreatment:
    employeeOverride?.sickLeavePayTreatment ?? policy.sickLeavePayTreatment,
  restDayWorkedPremiumPercent:
    employeeOverride?.restDayWorkedPremiumPercent ??
    policy.restDayWorkedPremiumPercent,
  regularHolidayWorkedPremiumPercent:
    employeeOverride?.regularHolidayWorkedPremiumPercent ??
    policy.regularHolidayWorkedPremiumPercent,
  specialHolidayWorkedPremiumPercent:
    employeeOverride?.specialHolidayWorkedPremiumPercent ??
    policy.specialHolidayWorkedPremiumPercent,
  managerOverrideApplied: hasMeaningfulOverride(employeeOverride),
  managerOverride: employeeOverride ?? null,
});

const computeAttendanceRowPay = (
  row: AttendanceRow,
  policy: EffectivePayrollLinePolicySnapshot,
) => {
  const dailyRateEquivalent = Number(row.dailyRateEquivalent ?? 0);
  const halfDayFactor = Number(row.halfDayFactor ?? 0.5);
  if (!Number.isFinite(dailyRateEquivalent) || dailyRateEquivalent < 0) {
    throw new Error(`Attendance row ${row.id} is missing dailyRateEquivalent.`);
  }

  let multiplier = 0;

  switch (row.attendanceResult) {
    case AttendanceResult.WHOLE_DAY:
      multiplier = 1;
      break;
    case AttendanceResult.HALF_DAY:
      multiplier = halfDayFactor;
      break;
    case AttendanceResult.LEAVE:
      multiplier =
        row.leaveType && policy.sickLeavePayTreatment === SickLeavePayTreatment.PAID
          ? 1
          : 0;
      break;
    default:
      multiplier = 0;
      break;
  }

  let gross = dailyRateEquivalent * multiplier;
  const isWorked =
    row.attendanceResult === AttendanceResult.WHOLE_DAY ||
    row.attendanceResult === AttendanceResult.HALF_DAY;

  if (isWorked) {
    if (row.dayType === "REST_DAY") {
      gross *= 1 + policy.restDayWorkedPremiumPercent / 100;
    }
    if (row.dayType === "REGULAR_HOLIDAY") {
      gross *= 1 + policy.regularHolidayWorkedPremiumPercent / 100;
    }
    if (row.dayType === "SPECIAL_HOLIDAY") {
      gross *= 1 + policy.specialHolidayWorkedPremiumPercent / 100;
    }
  }

  return roundMoney(gross);
};

const evaluateAttendanceIncentive = (
  rows: AttendanceRow[],
  policy: CompanyPayrollPolicySnapshot,
  employeeOverride: PayrollRunEmployeeOverride | null,
) => {
  const overrideMode = employeeOverride?.attendanceIncentiveMode ?? "DEFAULT";
  const overrideAmount =
    employeeOverride?.attendanceIncentiveAmount != null
      ? roundMoney(employeeOverride.attendanceIncentiveAmount)
      : null;

  if (overrideMode === "FORCE_BLOCK") {
    return {
      eligible: false,
      amount: 0,
      reasons: ["MANAGER_FORCED_BLOCK"],
      mode: overrideMode,
      managerOverrideApplied: true,
    };
  }

  if (overrideMode === "FORCE_ALLOW") {
    return {
      eligible: true,
      amount: overrideAmount ?? roundMoney(policy.attendanceIncentiveAmount),
      reasons: ["MANAGER_FORCED_ALLOW"],
      mode: overrideMode,
      managerOverrideApplied: true,
    };
  }

  if (!policy.attendanceIncentiveEnabled || rows.length === 0) {
    return {
      eligible: false,
      amount: 0,
      reasons: [
        policy.attendanceIncentiveEnabled
          ? "NO_ATTENDANCE_ROWS"
          : "INCENTIVE_DISABLED",
      ],
      mode: overrideMode,
      managerOverrideApplied: overrideAmount != null,
    };
  }

  const reasons: string[] = [];
  if (
    policy.attendanceIncentiveRequireNoAbsent &&
    rows.some((row) => row.attendanceResult === AttendanceResult.ABSENT)
  ) {
    reasons.push("HAS_ABSENT");
  }
  if (
    policy.attendanceIncentiveRequireNoSuspension &&
    rows.some((row) => row.attendanceResult === AttendanceResult.SUSPENDED_NO_WORK)
  ) {
    reasons.push("HAS_SUSPENSION");
  }
  if (
    policy.attendanceIncentiveRequireNoLate &&
    rows.some((row) => row.lateFlag === "YES")
  ) {
    reasons.push("HAS_LATE_FLAG");
  }

  return {
    eligible: reasons.length === 0,
    amount:
      reasons.length === 0
        ? overrideAmount ?? roundMoney(policy.attendanceIncentiveAmount)
        : 0,
    reasons,
    mode: overrideMode,
    managerOverrideApplied: overrideAmount != null,
  };
};

const buildOpenChargeSnapshot = (
  items: PayrollTaggedChargeItem[],
  previous?: PayrollDeductionSnapshot,
): PayrollDeductionSnapshot => ({
  openChargeCount: items.length,
  openChargeRemaining: roundMoney(
    items.reduce((sum, item) => sum + item.remaining, 0),
  ),
  appliedPayments: previous?.appliedPayments ?? [],
  lastAppliedAt: previous?.lastAppliedAt ?? null,
});

export async function listWorkerPayrollRuns(prisma: WorkforceDbClient = db) {
  return prisma.payrollRun.findMany({
    include: {
      createdBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      finalizedBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      paidBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      payrollRunLines: {
        select: {
          employeeId: true,
          grossPay: true,
          totalDeductions: true,
          netPay: true,
        },
      },
    },
    orderBy: [{ payDate: "desc" }, { id: "desc" }],
  });
}

export async function getWorkerPayrollRunDetail(
  payrollRunId: number,
  prisma: WorkforceDbClient = db,
) {
  return prisma.payrollRun.findUnique({
    where: { id: payrollRunId },
    include: {
      companyPayrollPolicy: true,
      createdBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      finalizedBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      paidBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      payrollRunLines: {
        include: {
          employee: {
            include: {
              user: {
                select: { role: true },
              },
            },
          },
        },
        orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }],
      },
    },
  });
}

export async function createWorkerPayrollRunDraft(
  args: {
    periodStart: Date | string;
    periodEnd: Date | string;
    payDate: Date | string;
    note?: string | null;
    createdById?: number | null;
  },
  prisma: WorkforceDbClient = db,
) {
  const periodStart = toDateOnly(args.periodStart);
  const periodEnd = toDateOnly(args.periodEnd);
  const payDate = toDateOnly(args.payDate);

  if (periodEnd < periodStart) {
    throw new Error("periodEnd must be on or after periodStart.");
  }

  const policy = await getEffectiveCompanyPayrollPolicy(prisma, payDate);
  const policySnapshot = snapshotCompanyPayrollPolicy(policy);
  if (!policySnapshot) {
    throw new Error("No effective company payroll policy found.");
  }

  return prisma.payrollRun.create({
    data: {
      periodStart,
      periodEnd,
      payDate,
      payFrequency: policySnapshot.payFrequency,
      status: PayrollRunStatus.DRAFT,
      companyPayrollPolicyId: policySnapshot.companyPayrollPolicyId,
      policySnapshot: policySnapshot as Prisma.InputJsonValue,
      managerOverrideSnapshot: {
        employeeOverrides: {},
        updatedAt: null,
        updatedById: null,
      } as Prisma.InputJsonValue,
      note: args.note?.trim() || null,
      createdById: args.createdById ?? null,
    },
  });
}

export async function saveWorkerPayrollRunEmployeeOverride(
  args: {
    payrollRunId: number;
    employeeId: number;
    sickLeavePayTreatment?: SickLeavePayTreatment | null;
    restDayWorkedPremiumPercent?: number | null;
    regularHolidayWorkedPremiumPercent?: number | null;
    specialHolidayWorkedPremiumPercent?: number | null;
    attendanceIncentiveMode?: "DEFAULT" | "FORCE_ALLOW" | "FORCE_BLOCK";
    attendanceIncentiveAmount?: number | null;
    note?: string | null;
    actorUserId?: number | null;
  },
  prisma: WorkforceRootDbClient = db,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const run = await tx.payrollRun.findUnique({
      where: { id: args.payrollRunId },
      select: {
        id: true,
        status: true,
        managerOverrideSnapshot: true,
      },
    });
    if (!run) {
      throw new Error("Payroll run not found.");
    }
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new Error("Only DRAFT payroll runs can accept overrides.");
    }

    const currentSnapshot = parsePayrollRunManagerOverrideSnapshot(
      run.managerOverrideSnapshot,
    );
    const nextOverride = normalizeOverrideInput({
      sickLeavePayTreatment: args.sickLeavePayTreatment ?? null,
      restDayWorkedPremiumPercent: args.restDayWorkedPremiumPercent ?? null,
      regularHolidayWorkedPremiumPercent:
        args.regularHolidayWorkedPremiumPercent ?? null,
      specialHolidayWorkedPremiumPercent:
        args.specialHolidayWorkedPremiumPercent ?? null,
      attendanceIncentiveMode: args.attendanceIncentiveMode ?? "DEFAULT",
      attendanceIncentiveAmount: args.attendanceIncentiveAmount ?? null,
      note: args.note ?? null,
    });

    const nextEmployeeOverrides = {
      ...currentSnapshot.employeeOverrides,
    };
    if (hasMeaningfulOverride(nextOverride)) {
      nextEmployeeOverrides[String(args.employeeId)] = nextOverride;
    } else {
      delete nextEmployeeOverrides[String(args.employeeId)];
    }

    await tx.payrollRun.update({
      where: { id: args.payrollRunId },
      data: {
        managerOverrideSnapshot: {
          employeeOverrides: nextEmployeeOverrides,
          updatedAt: new Date().toISOString(),
          updatedById: args.actorUserId ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    await tx.payrollRunLine.updateMany({
      where: {
        payrollRunId: args.payrollRunId,
        employeeId: args.employeeId,
      },
      data: {
        managerOverrideNote:
          nextEmployeeOverrides[String(args.employeeId)]?.note ?? null,
      },
    });

    return nextEmployeeOverrides[String(args.employeeId)] ?? null;
  });
}

export async function rebuildWorkerPayrollRunLines(
  payrollRunId: number,
  prisma: WorkforceRootDbClient = db,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const run = await tx.payrollRun.findUnique({
      where: { id: payrollRunId },
      include: { companyPayrollPolicy: true },
    });
    if (!run) {
      throw new Error("Payroll run not found.");
    }
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new Error("Only DRAFT payroll runs can be rebuilt.");
    }

    const policySnapshot =
      snapshotCompanyPayrollPolicy(run.companyPayrollPolicy) ??
      parsePolicySnapshot(run.policySnapshot);
    if (!policySnapshot) {
      throw new Error("Payroll run is missing an effective policy snapshot.");
    }

    const overrideSnapshot = parsePayrollRunManagerOverrideSnapshot(
      run.managerOverrideSnapshot,
    );

    const attendanceRows = await tx.attendanceDutyResult.findMany({
      where: {
        dutyDate: {
          gte: run.periodStart,
          lte: run.periodEnd,
        },
      },
      orderBy: [{ dutyDate: "asc" }, { workerId: "asc" }, { id: "asc" }],
    });

    const missingSnapshots = attendanceRows
      .filter(
        (row) =>
          requiresFrozenPayBasis(row) &&
          (row.payBasis == null || row.dailyRateEquivalent == null),
      )
      .map((row) => row.id);
    if (missingSnapshots.length > 0) {
      throw new Error(
        `Payroll run cannot rebuild while attendance snapshots are missing pay basis on rows: ${missingSnapshots.join(", ")}.`,
      );
    }

    const { items: chargeItems } = await listOpenPayrollTaggedChargeItems(tx);
    const existingLines = await tx.payrollRunLine.findMany({
      where: { payrollRunId },
    });

    const attendanceByEmployee = new Map<number, AttendanceRow[]>();
    for (const row of attendanceRows) {
      const bucket = attendanceByEmployee.get(row.workerId) ?? [];
      bucket.push(row);
      attendanceByEmployee.set(row.workerId, bucket);
    }

    const chargeItemsByEmployee = new Map<number, PayrollTaggedChargeItem[]>();
    for (const item of chargeItems) {
      const bucket = chargeItemsByEmployee.get(item.employeeId) ?? [];
      bucket.push(item);
      chargeItemsByEmployee.set(item.employeeId, bucket);
    }

    const existingLineByEmployee = new Map(
      existingLines.map((line) => [line.employeeId, line]),
    );

    const employeeIds = Array.from(
      new Set([
        ...attendanceByEmployee.keys(),
        ...chargeItemsByEmployee.keys(),
        ...existingLineByEmployee.keys(),
        ...Object.keys(overrideSnapshot.employeeOverrides).map((value) => Number(value)),
      ]),
    )
      .filter((employeeId) => Number.isFinite(employeeId) && employeeId > 0)
      .sort((left, right) => left - right);

    await tx.payrollRunLine.deleteMany({ where: { payrollRunId } });

    for (const employeeId of employeeIds) {
      const employeeAttendance = attendanceByEmployee.get(employeeId) ?? [];
      const employeeChargeItems = chargeItemsByEmployee.get(employeeId) ?? [];
      const existingLine = existingLineByEmployee.get(employeeId) ?? null;
      const employeeOverride =
        overrideSnapshot.employeeOverrides[String(employeeId)] ?? null;
      const effectivePolicy = buildEffectivePolicySnapshot(
        policySnapshot,
        employeeOverride,
      );

      const baseAttendancePay = roundMoney(
        employeeAttendance.reduce(
          (sum, row) => sum + computeAttendanceRowPay(row, effectivePolicy),
          0,
        ),
      );
      const incentive = evaluateAttendanceIncentive(
        employeeAttendance,
        effectivePolicy,
        employeeOverride,
      );
      const totalAdditions = roundMoney(incentive.amount);
      const grossPay = roundMoney(baseAttendancePay + totalAdditions);
      const priorDeductionSnapshot = existingLine
        ? parsePayrollDeductionSnapshot(existingLine.deductionSnapshot)
        : {
            openChargeCount: 0,
            openChargeRemaining: 0,
            appliedPayments: [],
            lastAppliedAt: null,
          };
      const totalDeductions = roundMoney(Number(existingLine?.totalDeductions ?? 0));
      const netPay = roundMoney(grossPay - totalDeductions);
      const shouldKeepLine =
        employeeAttendance.length > 0 ||
        employeeChargeItems.length > 0 ||
        totalDeductions > MONEY_EPS ||
        priorDeductionSnapshot.appliedPayments.length > 0 ||
        hasMeaningfulOverride(employeeOverride);

      if (!shouldKeepLine) {
        continue;
      }

      await tx.payrollRunLine.create({
        data: {
          payrollRunId,
          employeeId,
          attendanceSnapshotIds: employeeAttendance.map((row) => row.id),
          baseAttendancePay: toMoneyDecimal(baseAttendancePay),
          attendanceIncentiveAmount: toMoneyDecimal(incentive.amount),
          totalAdditions: toMoneyDecimal(totalAdditions),
          grossPay: toMoneyDecimal(grossPay),
          totalDeductions: toMoneyDecimal(totalDeductions),
          netPay: toMoneyDecimal(netPay),
          policySnapshot: effectivePolicy as Prisma.InputJsonValue,
          additionSnapshot: {
            attendanceIncentiveEligible: incentive.eligible,
            attendanceIncentiveReasons: incentive.reasons,
            attendanceIncentiveAmount: incentive.amount,
            attendanceIncentiveMode: incentive.mode,
            managerOverrideApplied:
              incentive.managerOverrideApplied ||
              effectivePolicy.managerOverrideApplied,
          } as Prisma.InputJsonValue,
          deductionSnapshot: buildOpenChargeSnapshot(
            employeeChargeItems,
            priorDeductionSnapshot,
          ) as Prisma.InputJsonValue,
          managerOverrideNote:
            employeeOverride?.note ?? existingLine?.managerOverrideNote ?? null,
        },
      });
    }

    return tx.payrollRunLine.findMany({
      where: { payrollRunId },
      include: {
        employee: {
          include: {
            user: {
              select: { role: true },
            },
          },
        },
      },
      orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }],
    });
  });
}

export async function applyWorkerPayrollChargeDeduction(
  args: {
    employeeId: number;
    amount: number;
    note: string;
    recordedByUserId?: number | null;
    payrollRunLineId?: number | null;
  },
  prisma: WorkforceRootDbClient = db,
) {
  if (!Number.isFinite(args.employeeId) || args.employeeId <= 0) {
    throw new Error("employeeId is required.");
  }
  if (!Number.isFinite(args.amount) || args.amount <= 0) {
    throw new Error("amount must be greater than zero.");
  }
  if (!args.note.trim()) {
    throw new Error("note is required.");
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const chargeItems = await listOpenPayrollTaggedChargeItemsForEmployee(
      args.employeeId,
      tx,
    );
    if (chargeItems.length === 0) {
      throw new Error("No payroll-tagged charges found for this employee.");
    }

    const totalRemaining = roundMoney(
      chargeItems.reduce((sum, item) => sum + item.remaining, 0),
    );
    const targetAmount = Math.min(totalRemaining, roundMoney(args.amount));
    let remainingToApply = targetAmount;
    const now = new Date();
    const appliedPayments: PayrollDeductionSnapshot["appliedPayments"] = [];

    for (const item of chargeItems) {
      if (remainingToApply <= MONEY_EPS) break;

      const payAmount = roundMoney(Math.min(item.remaining, remainingToApply));
      if (payAmount <= MONEY_EPS) continue;

      const note = `[PAYROLL:${args.note.trim()}]${
        args.recordedByUserId ? ` REC_BY:${args.recordedByUserId}` : ""
      }${args.payrollRunLineId ? ` PAYROLL_RUN_LINE:${args.payrollRunLineId}` : ""}`;

      if (item.chargeKind === "RIDER") {
        await tx.riderChargePayment.create({
          data: {
            chargeId: item.chargeId,
            amount: toMoneyDecimal(payAmount),
            method: RiderChargePaymentMethod.PAYROLL_DEDUCTION,
            note,
          },
        });

        const aggregate = await tx.riderChargePayment.aggregate({
          where: { chargeId: item.chargeId },
          _sum: { amount: true },
        });
        const paid = Number(aggregate._sum.amount ?? 0);
        const nextStatus =
          item.amount - paid <= MONEY_EPS
            ? RiderChargeStatus.SETTLED
            : paid > MONEY_EPS
              ? RiderChargeStatus.PARTIALLY_SETTLED
              : RiderChargeStatus.OPEN;

        await tx.riderCharge.update({
          where: { id: item.chargeId },
          data: {
            status: nextStatus,
            settledAt: nextStatus === RiderChargeStatus.SETTLED ? now : null,
          },
        });

        if (item.varianceId) {
          if (nextStatus === RiderChargeStatus.SETTLED) {
            await tx.riderRunVariance.updateMany({
              where: {
                id: item.varianceId,
                status: {
                  in: [
                    RiderVarianceStatus.OPEN,
                    RiderVarianceStatus.MANAGER_APPROVED,
                    RiderVarianceStatus.RIDER_ACCEPTED,
                    RiderVarianceStatus.PARTIALLY_SETTLED,
                  ],
                },
              },
              data: {
                status: RiderVarianceStatus.CLOSED,
                resolvedAt: now,
              },
            });
          } else if (nextStatus === RiderChargeStatus.PARTIALLY_SETTLED) {
            await tx.riderRunVariance.updateMany({
              where: {
                id: item.varianceId,
                status: {
                  in: [
                    RiderVarianceStatus.OPEN,
                    RiderVarianceStatus.MANAGER_APPROVED,
                    RiderVarianceStatus.RIDER_ACCEPTED,
                  ],
                },
              },
              data: { status: RiderVarianceStatus.PARTIALLY_SETTLED },
            });
          }
        }
      } else {
        await tx.cashierChargePayment.create({
          data: {
            chargeId: item.chargeId,
            amount: toMoneyDecimal(payAmount),
            method: CashierChargePaymentMethod.PAYROLL_DEDUCTION,
            note,
          },
        });

        const aggregate = await tx.cashierChargePayment.aggregate({
          where: { chargeId: item.chargeId },
          _sum: { amount: true },
        });
        const paid = Number(aggregate._sum.amount ?? 0);
        const nextStatus =
          item.amount - paid <= MONEY_EPS
            ? CashierChargeStatus.SETTLED
            : paid > MONEY_EPS
              ? CashierChargeStatus.PARTIALLY_SETTLED
              : CashierChargeStatus.OPEN;

        await tx.cashierCharge.update({
          where: { id: item.chargeId },
          data: {
            status: nextStatus,
            settledAt: nextStatus === CashierChargeStatus.SETTLED ? now : null,
          },
        });

        if (item.varianceId && nextStatus === CashierChargeStatus.SETTLED) {
          await tx.cashierShiftVariance.updateMany({
            where: {
              id: item.varianceId,
              status: {
                in: [
                  CashierVarianceStatus.OPEN,
                  CashierVarianceStatus.MANAGER_APPROVED,
                ],
              },
            },
            data: {
              status: CashierVarianceStatus.CLOSED,
              resolvedAt: now,
            },
          });
        }
      }

      appliedPayments.push({
        chargeKind: item.chargeKind,
        chargeId: item.chargeId,
        amount: payAmount,
        createdAt: now.toISOString(),
      });
      remainingToApply = roundMoney(remainingToApply - payAmount);
    }

    const appliedTotal = roundMoney(targetAmount - remainingToApply);

    if (args.payrollRunLineId) {
      const line = await tx.payrollRunLine.findUnique({
        where: { id: args.payrollRunLineId },
      });
      if (!line || line.employeeId !== args.employeeId) {
        throw new Error("payrollRunLineId does not belong to the employee.");
      }

      const currentSnapshot = parsePayrollDeductionSnapshot(line.deductionSnapshot);
      const nextTotalDeductions = roundMoney(
        Number(line.totalDeductions) + appliedTotal,
      );
      const nextNetPay = roundMoney(Number(line.grossPay) - nextTotalDeductions);

      const refreshedChargeItems = await listOpenPayrollTaggedChargeItemsForEmployee(
        args.employeeId,
        tx,
      );

      await tx.payrollRunLine.update({
        where: { id: args.payrollRunLineId },
        data: {
          totalDeductions: toMoneyDecimal(nextTotalDeductions),
          netPay: toMoneyDecimal(nextNetPay),
          deductionSnapshot: {
            openChargeCount: refreshedChargeItems.length,
            openChargeRemaining: roundMoney(
              refreshedChargeItems.reduce((sum, item) => sum + item.remaining, 0),
            ),
            appliedPayments: [
              ...currentSnapshot.appliedPayments,
              ...appliedPayments,
            ],
            lastAppliedAt: now.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
    }

    return {
      appliedTotal,
      remainingOpenBalance: roundMoney(totalRemaining - appliedTotal),
      appliedPayments,
    };
  });
}

export async function finalizeWorkerPayrollRun(
  payrollRunId: number,
  finalizedById: number,
  prisma: WorkforceRootDbClient = db,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const run = await tx.payrollRun.findUnique({
      where: { id: payrollRunId },
      select: { id: true, status: true },
    });
    if (!run) {
      throw new Error("Payroll run not found.");
    }
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new Error("Only DRAFT payroll runs can be finalized.");
    }

    const unresolved = await listUnresolvedCashierPayrollCharges(tx);
    if (unresolved.length > 0) {
      throw new Error(
        `Payroll finalization blocked by ${unresolved.length} unresolved cashier payroll charge(s).`,
      );
    }

    const lineCount = await tx.payrollRunLine.count({
      where: { payrollRunId },
    });
    if (lineCount === 0) {
      throw new Error("Payroll run has no lines to finalize.");
    }

    return tx.payrollRun.update({
      where: { id: payrollRunId },
      data: {
        status: PayrollRunStatus.FINALIZED,
        finalizedById,
        finalizedAt: new Date(),
      },
    });
  });
}

export async function markWorkerPayrollRunPaid(
  payrollRunId: number,
  paidById: number,
  prisma: WorkforceDbClient = db,
) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: payrollRunId },
    select: { id: true, status: true },
  });
  if (!run) {
    throw new Error("Payroll run not found.");
  }
  if (run.status !== PayrollRunStatus.FINALIZED) {
    throw new Error("Only FINALIZED payroll runs can be marked PAID.");
  }

  return prisma.payrollRun.update({
    where: { id: payrollRunId },
    data: {
      status: PayrollRunStatus.PAID,
      paidById,
      paidAt: new Date(),
    },
  });
}
