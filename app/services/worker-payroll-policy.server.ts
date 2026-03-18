import {
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
  dailyRate: number;
  halfDayFactor: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type EmployeeStatutoryDeductionProfileSnapshot = {
  statutoryProfileId: number;
  sssAmount: number;
  philhealthAmount: number;
  pagIbigAmount: number;
  totalAmount: number;
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
  sssDeductionEnabled: boolean;
  philhealthDeductionEnabled: boolean;
  pagIbigDeductionEnabled: boolean;
  allowManagerOverride: boolean;
};

export type UpsertEmployeePayProfileInput = {
  id?: number;
  employeeId: number;
  dailyRate: number;
  halfDayFactor?: number;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  note?: string | null;
  actorUserId?: number | null;
};

export type UpsertEmployeeStatutoryDeductionProfileInput = {
  id?: number;
  employeeId: number;
  sssAmount?: number;
  philhealthAmount?: number;
  pagIbigAmount?: number;
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
  sssDeductionEnabled: boolean;
  philhealthDeductionEnabled: boolean;
  pagIbigDeductionEnabled: boolean;
  allowManagerOverride?: boolean;
  actorUserId?: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const parseCalendarDateParts = (value: Date | string) => {
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
};

const toDateOnly = (value: Date | string) => {
  const { year, month, day } = parseCalendarDateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
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

const subtractOneDay = (value: Date) => new Date(value.getTime() - DAY_MS);

const rangesOverlap = (
  leftFrom: Date,
  leftTo: Date | null,
  rightFrom: Date,
  rightTo: Date | null,
) => {
  const leftEnd = leftTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = rightTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftFrom.getTime() <= rightEnd && rightFrom.getTime() <= leftEnd;
};

const workforceActorInclude = {
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
} as const;

async function withOptionalTransaction<T>(
  prisma: WorkforceDbClient,
  handler: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  const rootClient = prisma as PrismaClient;
  if (typeof rootClient.$transaction === "function") {
    return rootClient.$transaction((tx) => handler(tx));
  }
  return handler(prisma as Prisma.TransactionClient);
}

function validateEffectivityWindow(
  effectiveFrom: Date,
  effectiveTo: Date | null,
  label: string,
) {
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error(`${label} effective-to must be on or after effective-from.`);
  }
}

async function autoClosePreviousOpenEndedPayProfile(
  tx: Prisma.TransactionClient,
  args: {
    employeeId: number;
    effectiveFrom: Date;
    actorUserId?: number | null;
  },
) {
  const previous = await tx.employeePayProfile.findFirst({
    where: {
      employeeId: args.employeeId,
      effectiveTo: null,
      effectiveFrom: { lt: args.effectiveFrom },
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });

  if (!previous) return;

  const nextEffectiveTo = subtractOneDay(args.effectiveFrom);
  if (nextEffectiveTo < previous.effectiveFrom) {
    return;
  }

  await tx.employeePayProfile.update({
    where: { id: previous.id },
    data: {
      effectiveTo: nextEffectiveTo,
      updatedById: args.actorUserId ?? null,
    },
  });
}

async function autoClosePreviousOpenEndedStatutoryProfile(
  tx: Prisma.TransactionClient,
  args: {
    employeeId: number;
    effectiveFrom: Date;
    actorUserId?: number | null;
  },
) {
  const previous = await tx.employeeStatutoryDeductionProfile.findFirst({
    where: {
      employeeId: args.employeeId,
      effectiveTo: null,
      effectiveFrom: { lt: args.effectiveFrom },
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });

  if (!previous) return;

  const nextEffectiveTo = subtractOneDay(args.effectiveFrom);
  if (nextEffectiveTo < previous.effectiveFrom) {
    return;
  }

  await tx.employeeStatutoryDeductionProfile.update({
    where: { id: previous.id },
    data: {
      effectiveTo: nextEffectiveTo,
      updatedById: args.actorUserId ?? null,
    },
  });
}

async function assertNoOverlappingPayProfiles(
  tx: Prisma.TransactionClient,
  args: {
    employeeId: number;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    excludeId?: number;
  },
) {
  const existingProfiles = await tx.employeePayProfile.findMany({
    where: {
      employeeId: args.employeeId,
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
    orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
  });

  const overlapping = existingProfiles.find((profile) =>
    rangesOverlap(
      profile.effectiveFrom,
      profile.effectiveTo,
      args.effectiveFrom,
      args.effectiveTo,
    ),
  );

  if (overlapping) {
    throw new Error(
      "This salary row overlaps an existing salary effectivity. Edit the conflicting row or choose a later effective-from date.",
    );
  }
}

async function assertNoOverlappingStatutoryProfiles(
  tx: Prisma.TransactionClient,
  args: {
    employeeId: number;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    excludeId?: number;
  },
) {
  const existingProfiles = await tx.employeeStatutoryDeductionProfile.findMany({
    where: {
      employeeId: args.employeeId,
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
    select: {
      id: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
    orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
  });

  const overlapping = existingProfiles.find((profile) =>
    rangesOverlap(
      profile.effectiveFrom,
      profile.effectiveTo,
      args.effectiveFrom,
      args.effectiveTo,
    ),
  );

  if (overlapping) {
    throw new Error(
      "This government-deduction row overlaps an existing effectivity. Edit the conflicting row or choose a later effective-from date.",
    );
  }
}

export function snapshotEmployeePayProfile(
  profile: Awaited<ReturnType<typeof getEffectiveEmployeePayProfile>>,
): EmployeePayProfileSnapshot | null {
  if (!profile) return null;
  return {
    payProfileId: profile.id,
    dailyRate: Number(profile.dailyRate),
    halfDayFactor: Number(profile.halfDayFactor),
    effectiveFrom: profile.effectiveFrom.toISOString(),
    effectiveTo: profile.effectiveTo?.toISOString() ?? null,
  };
}

export function snapshotEmployeeStatutoryDeductionProfile(
  profile: Awaited<
    ReturnType<typeof getEffectiveEmployeeStatutoryDeductionProfile>
  >,
): EmployeeStatutoryDeductionProfileSnapshot | null {
  if (!profile) return null;
  const sssAmount = Number(profile.sssAmount);
  const philhealthAmount = Number(profile.philhealthAmount);
  const pagIbigAmount = Number(profile.pagIbigAmount);
  return {
    statutoryProfileId: profile.id,
    sssAmount,
    philhealthAmount,
    pagIbigAmount,
    totalAmount: sssAmount + philhealthAmount + pagIbigAmount,
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
    sssDeductionEnabled: policy.sssDeductionEnabled,
    philhealthDeductionEnabled: policy.philhealthDeductionEnabled,
    pagIbigDeductionEnabled: policy.pagIbigDeductionEnabled,
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

export async function getEffectiveEmployeeStatutoryDeductionProfile(
  prisma: WorkforceDbClient,
  employeeId: number,
  onDate: Date | string,
) {
  const date = toDateOnly(onDate);

  return prisma.employeeStatutoryDeductionProfile.findFirst({
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
      ...workforceActorInclude,
    },
    orderBy: [
      { employee: { lastName: "asc" } },
      { employee: { firstName: "asc" } },
      { effectiveFrom: "desc" },
      { id: "desc" },
    ],
  });
}

export async function listEmployeeStatutoryDeductionProfiles(
  args?: { employeeId?: number },
  prisma: WorkforceDbClient = db,
) {
  return prisma.employeeStatutoryDeductionProfile.findMany({
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
      ...workforceActorInclude,
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
    include: workforceActorInclude,
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });
}

export async function upsertEmployeePayProfile(
  input: UpsertEmployeePayProfileInput,
  prisma: WorkforceDbClient = db,
) {
  const effectiveFrom = toDateOnly(input.effectiveFrom);
  const effectiveTo = toOptionalDateOnly(input.effectiveTo);
  const halfDayFactor = input.halfDayFactor ?? 0.5;

  assertPositive(input.employeeId, "employeeId");
  assertPositive(input.dailyRate, "dailyRate");
  assertPositive(halfDayFactor, "halfDayFactor");
  validateEffectivityWindow(effectiveFrom, effectiveTo, "Salary row");

  return withOptionalTransaction(prisma, async (tx) => {
    if (!input.id) {
      await autoClosePreviousOpenEndedPayProfile(tx, {
        employeeId: input.employeeId,
        effectiveFrom,
        actorUserId: input.actorUserId,
      });
    }

    await assertNoOverlappingPayProfiles(tx, {
      employeeId: input.employeeId,
      effectiveFrom,
      effectiveTo,
      excludeId: input.id,
    });

    const data = {
      employeeId: input.employeeId,
      dailyRate: toMoneyDecimal(input.dailyRate),
      halfDayFactor: toFactorDecimal(halfDayFactor),
      effectiveFrom,
      effectiveTo,
      note: input.note?.trim() || null,
      updatedById: input.actorUserId ?? null,
    } satisfies Prisma.EmployeePayProfileUncheckedUpdateInput;

    try {
      if (input.id) {
        return await tx.employeePayProfile.update({
          where: { id: input.id },
          data,
        });
      }

      return await tx.employeePayProfile.create({
        data: {
          ...data,
          createdById: input.actorUserId ?? null,
        },
      });
    } catch (error) {
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : null;

      if (errorCode === "P2002") {
        throw new Error(
          "A salary row already exists for this employee on that effective-from date. Use a different effective date or edit the existing row.",
        );
      }

      throw error;
    }
  });
}

export async function upsertEmployeeStatutoryDeductionProfile(
  input: UpsertEmployeeStatutoryDeductionProfileInput,
  prisma: WorkforceDbClient = db,
) {
  const effectiveFrom = toDateOnly(input.effectiveFrom);
  const effectiveTo = toOptionalDateOnly(input.effectiveTo);
  const sssAmount = input.sssAmount ?? 0;
  const philhealthAmount = input.philhealthAmount ?? 0;
  const pagIbigAmount = input.pagIbigAmount ?? 0;

  assertPositive(input.employeeId, "employeeId");
  assertNonNegative(sssAmount, "sssAmount");
  assertNonNegative(philhealthAmount, "philhealthAmount");
  assertNonNegative(pagIbigAmount, "pagIbigAmount");
  validateEffectivityWindow(
    effectiveFrom,
    effectiveTo,
    "Government-deduction row",
  );

  return withOptionalTransaction(prisma, async (tx) => {
    if (!input.id) {
      await autoClosePreviousOpenEndedStatutoryProfile(tx, {
        employeeId: input.employeeId,
        effectiveFrom,
        actorUserId: input.actorUserId,
      });
    }

    await assertNoOverlappingStatutoryProfiles(tx, {
      employeeId: input.employeeId,
      effectiveFrom,
      effectiveTo,
      excludeId: input.id,
    });

    const data = {
      employeeId: input.employeeId,
      sssAmount: toMoneyDecimal(sssAmount),
      philhealthAmount: toMoneyDecimal(philhealthAmount),
      pagIbigAmount: toMoneyDecimal(pagIbigAmount),
      effectiveFrom,
      effectiveTo,
      note: input.note?.trim() || null,
      updatedById: input.actorUserId ?? null,
    } satisfies Prisma.EmployeeStatutoryDeductionProfileUncheckedUpdateInput;

    try {
      if (input.id) {
        return await tx.employeeStatutoryDeductionProfile.update({
          where: { id: input.id },
          data,
        });
      }

      return await tx.employeeStatutoryDeductionProfile.create({
        data: {
          ...data,
          createdById: input.actorUserId ?? null,
        },
      });
    } catch (error) {
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : null;

      if (errorCode === "P2002") {
        throw new Error(
          "A government-deduction row already exists for this employee on that effective-from date. Use a different effective date or edit the existing row.",
        );
      }

      throw error;
    }
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
    sssDeductionEnabled: input.sssDeductionEnabled,
    philhealthDeductionEnabled: input.philhealthDeductionEnabled,
    pagIbigDeductionEnabled: input.pagIbigDeductionEnabled,
    allowManagerOverride: input.allowManagerOverride ?? true,
    updatedById: input.actorUserId ?? null,
  } satisfies Prisma.CompanyPayrollPolicyUncheckedUpdateInput;

  try {
    if (input.id) {
      return await prisma.companyPayrollPolicy.update({
        where: { id: input.id },
        data,
      });
    }

    return await prisma.companyPayrollPolicy.create({
      data: {
        ...data,
        createdById: input.actorUserId ?? null,
      },
    });
  } catch (error) {
    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;

    if (errorCode === "P2002") {
      throw new Error(
        "A payroll policy row already exists on that effective-from date. Use a different date or edit the existing row.",
      );
    }

    throw error;
  }
}
