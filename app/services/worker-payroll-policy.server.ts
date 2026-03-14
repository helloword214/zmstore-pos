import {
  EmployeePayBasis,
  PayrollFrequency,
  Prisma,
  PrismaClient,
  SickLeavePayTreatment,
} from "@prisma/client";
import { db } from "~/utils/db.server";

export type WorkforceDbClient = PrismaClient | Prisma.TransactionClient;
export type WorkforceRootDbClient = PrismaClient;

export type EmployeePayProfileSnapshot = {
  payProfileId: number;
  payBasis: EmployeePayBasis;
  baseDailyRate: number | null;
  baseMonthlyRate: number | null;
  dailyRateEquivalent: number;
  halfDayFactor: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type CompanyPayrollPolicySnapshot = {
  companyPayrollPolicyId: number;
  effectiveFrom: string;
  payFrequency: PayrollFrequency;
  customCutoffNote: string | null;
  restDayWorkedPremiumPercent: number;
  regularHolidayWorkedPremiumPercent: number;
  specialHolidayWorkedPremiumPercent: number;
  sickLeavePayTreatment: SickLeavePayTreatment;
  attendanceIncentiveEnabled: boolean;
  attendanceIncentiveAmount: number;
  attendanceIncentiveRequireNoLate: boolean;
  attendanceIncentiveRequireNoAbsent: boolean;
  attendanceIncentiveRequireNoSuspension: boolean;
  allowManagerOverride: boolean;
};

export type UpsertEmployeePayProfileInput = {
  id?: number;
  employeeId: number;
  payBasis: EmployeePayBasis;
  baseDailyRate?: number | null;
  baseMonthlyRate?: number | null;
  dailyRateEquivalent: number;
  halfDayFactor?: number;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  note?: string | null;
  actorUserId?: number | null;
};

export type UpsertCompanyPayrollPolicyInput = {
  id?: number;
  effectiveFrom: Date | string;
  payFrequency: PayrollFrequency;
  customCutoffNote?: string | null;
  restDayWorkedPremiumPercent: number;
  regularHolidayWorkedPremiumPercent: number;
  specialHolidayWorkedPremiumPercent: number;
  sickLeavePayTreatment: SickLeavePayTreatment;
  attendanceIncentiveEnabled: boolean;
  attendanceIncentiveAmount: number;
  attendanceIncentiveRequireNoLate: boolean;
  attendanceIncentiveRequireNoAbsent: boolean;
  attendanceIncentiveRequireNoSuspension: boolean;
  allowManagerOverride?: boolean;
  actorUserId?: number | null;
};

const toDateOnly = (value: Date | string) => {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const toOptionalDateOnly = (value?: Date | string | null) =>
  value == null ? null : toDateOnly(value);

const toNumber = (value: Prisma.Decimal | number | null | undefined) =>
  value == null ? null : Number(value);

const assertNonNegative = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
};

const assertPositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
};

const toMoneyDecimal = (value: number) => new Prisma.Decimal(value.toFixed(2));

const toFactorDecimal = (value: number) => new Prisma.Decimal(value.toFixed(4));

export function snapshotEmployeePayProfile(
  profile: Awaited<ReturnType<typeof getEffectiveEmployeePayProfile>>,
): EmployeePayProfileSnapshot | null {
  if (!profile) return null;
  return {
    payProfileId: profile.id,
    payBasis: profile.payBasis,
    baseDailyRate: toNumber(profile.baseDailyRate),
    baseMonthlyRate: toNumber(profile.baseMonthlyRate),
    dailyRateEquivalent: Number(profile.dailyRateEquivalent),
    halfDayFactor: Number(profile.halfDayFactor),
    effectiveFrom: profile.effectiveFrom.toISOString(),
    effectiveTo: profile.effectiveTo?.toISOString() ?? null,
  };
}

export function snapshotCompanyPayrollPolicy(
  policy: Awaited<ReturnType<typeof getEffectiveCompanyPayrollPolicy>>,
): CompanyPayrollPolicySnapshot | null {
  if (!policy) return null;
  return {
    companyPayrollPolicyId: policy.id,
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
    allowManagerOverride: policy.allowManagerOverride,
  };
}

export async function getEffectiveEmployeePayProfile(
  prisma: WorkforceDbClient,
  employeeId: number,
  onDate: Date | string,
) {
  const date = toDateOnly(onDate);

  return prisma.employeePayProfile.findFirst({
    where: {
      employeeId,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });
}

export async function getEffectiveCompanyPayrollPolicy(
  prisma: WorkforceDbClient,
  onDate: Date | string,
) {
  const date = toDateOnly(onDate);

  return prisma.companyPayrollPolicy.findFirst({
    where: {
      effectiveFrom: { lte: date },
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });
}

export async function listEmployeePayProfiles(
  args?: { employeeId?: number },
  prisma: WorkforceDbClient = db,
) {
  return prisma.employeePayProfile.findMany({
    where: {
      ...(args?.employeeId ? { employeeId: args.employeeId } : {}),
    },
    include: {
      employee: {
        include: {
          user: {
            select: { role: true, active: true },
          },
        },
      },
      createdBy: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
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
    orderBy: [
      { employee: { lastName: "asc" } },
      { employee: { firstName: "asc" } },
      { effectiveFrom: "desc" },
      { id: "desc" },
    ],
  });
}

export async function listCompanyPayrollPolicies(
  prisma: WorkforceDbClient = db,
) {
  return prisma.companyPayrollPolicy.findMany({
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
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });
}

export async function upsertEmployeePayProfile(
  input: UpsertEmployeePayProfileInput,
  prisma: WorkforceDbClient = db,
) {
  const effectiveFrom = toDateOnly(input.effectiveFrom);
  const effectiveTo = toOptionalDateOnly(input.effectiveTo);

  assertPositive(input.employeeId, "employeeId");
  assertPositive(input.dailyRateEquivalent, "dailyRateEquivalent");
  assertPositive(input.halfDayFactor ?? 0.5, "halfDayFactor");

  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error("effectiveTo must be on or after effectiveFrom.");
  }

  if (input.payBasis === EmployeePayBasis.DAILY) {
    assertPositive(input.baseDailyRate ?? 0, "baseDailyRate");
  }

  if (input.payBasis === EmployeePayBasis.MONTHLY) {
    assertPositive(input.baseMonthlyRate ?? 0, "baseMonthlyRate");
  }

  const data = {
    employeeId: input.employeeId,
    payBasis: input.payBasis,
    baseDailyRate:
      input.baseDailyRate == null ? null : toMoneyDecimal(input.baseDailyRate),
    baseMonthlyRate:
      input.baseMonthlyRate == null
        ? null
        : toMoneyDecimal(input.baseMonthlyRate),
    dailyRateEquivalent: toMoneyDecimal(input.dailyRateEquivalent),
    halfDayFactor: toFactorDecimal(input.halfDayFactor ?? 0.5),
    effectiveFrom,
    effectiveTo,
    note: input.note?.trim() || null,
    updatedById: input.actorUserId ?? null,
  } satisfies Prisma.EmployeePayProfileUncheckedUpdateInput;

  if (input.id) {
    return prisma.employeePayProfile.update({
      where: { id: input.id },
      data,
    });
  }

  return prisma.employeePayProfile.create({
    data: {
      ...data,
      createdById: input.actorUserId ?? null,
    },
  });
}

export async function upsertCompanyPayrollPolicy(
  input: UpsertCompanyPayrollPolicyInput,
  prisma: WorkforceDbClient = db,
) {
  const effectiveFrom = toDateOnly(input.effectiveFrom);

  assertNonNegative(
    input.restDayWorkedPremiumPercent,
    "restDayWorkedPremiumPercent",
  );
  assertNonNegative(
    input.regularHolidayWorkedPremiumPercent,
    "regularHolidayWorkedPremiumPercent",
  );
  assertNonNegative(
    input.specialHolidayWorkedPremiumPercent,
    "specialHolidayWorkedPremiumPercent",
  );
  assertNonNegative(
    input.attendanceIncentiveAmount,
    "attendanceIncentiveAmount",
  );

  const data = {
    effectiveFrom,
    payFrequency: input.payFrequency,
    customCutoffNote: input.customCutoffNote?.trim() || null,
    restDayWorkedPremiumPercent: new Prisma.Decimal(
      input.restDayWorkedPremiumPercent.toFixed(2),
    ),
    regularHolidayWorkedPremiumPercent: new Prisma.Decimal(
      input.regularHolidayWorkedPremiumPercent.toFixed(2),
    ),
    specialHolidayWorkedPremiumPercent: new Prisma.Decimal(
      input.specialHolidayWorkedPremiumPercent.toFixed(2),
    ),
    sickLeavePayTreatment: input.sickLeavePayTreatment,
    attendanceIncentiveEnabled: input.attendanceIncentiveEnabled,
    attendanceIncentiveAmount: toMoneyDecimal(input.attendanceIncentiveAmount),
    attendanceIncentiveRequireNoLate: input.attendanceIncentiveRequireNoLate,
    attendanceIncentiveRequireNoAbsent:
      input.attendanceIncentiveRequireNoAbsent,
    attendanceIncentiveRequireNoSuspension:
      input.attendanceIncentiveRequireNoSuspension,
    allowManagerOverride: input.allowManagerOverride ?? true,
    updatedById: input.actorUserId ?? null,
  } satisfies Prisma.CompanyPayrollPolicyUncheckedUpdateInput;

  if (input.id) {
    return prisma.companyPayrollPolicy.update({
      where: { id: input.id },
      data,
    });
  }

  return prisma.companyPayrollPolicy.create({
    data: {
      ...data,
      createdById: input.actorUserId ?? null,
    },
  });
}
