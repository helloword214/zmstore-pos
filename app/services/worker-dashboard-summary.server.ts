import {
  AttendanceLateFlag,
  AttendanceResult,
  CashierChargeStatus,
  PayrollFrequency,
  PayrollRunStatus,
  RiderChargeStatus,
  WorkerScheduleStatus,
} from "@prisma/client";
import { db } from "~/utils/db.server";
import {
  getEffectiveCompanyPayrollPolicy,
  type WorkforceDbClient,
} from "~/services/worker-payroll-policy.server";

export type WorkerDashboardChargeScope =
  | {
      lane: "RIDER";
      employeeId: number;
    }
  | {
      lane: "CASHIER";
      userId: number;
    };

export type WorkerDashboardSummary = {
  hasLinkedEmployee: boolean;
  todayStatus: {
    label: string;
    tone: "info" | "success" | "warning" | "danger";
    hint: string;
  };
  nextShift: {
    label: string | null;
    hint: string;
    branchName: string | null;
    startsAt: string | null;
    endsAt: string | null;
    status: WorkerScheduleStatus | null;
  };
  attendance: {
    absentCountThisMonth: number;
    lateCountThisMonth: number;
    suspensionCountThisMonth: number;
  };
  payroll: {
    policyLabel: string | null;
    latestLabel: string | null;
    latestPayDate: string | null;
    latestNetPay: number | null;
    latestGrossPay: number | null;
    latestDeductionTotal: number | null;
    latestStatus: PayrollRunStatus | null;
    unpaidFinalizedCount: number;
  };
  charges: {
    openItemCount: number;
    outstandingAmount: number;
  };
};

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

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const sameDate = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const startOfMonth = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth(), 1);

const startOfNextMonth = (value: Date) =>
  new Date(value.getFullYear(), value.getMonth() + 1, 1);

const formatTimeLabel = (value: Date) =>
  value.toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const formatDateLabel = (value: Date) =>
  value.toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });

const formatRelativeScheduleDateLabel = (
  scheduleDate: Date,
  referenceDate: Date,
) => {
  if (sameDate(scheduleDate, referenceDate)) return "Today";
  if (sameDate(scheduleDate, addDays(referenceDate, 1))) return "Tomorrow";
  return scheduleDate.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
};

const formatScheduleLabel = (
  schedule: {
    scheduleDate: Date;
    startAt: Date;
    endAt: Date;
    branch: { name: string } | null;
  },
  referenceDate: Date,
) => {
  const dayLabel = formatRelativeScheduleDateLabel(
    schedule.scheduleDate,
    referenceDate,
  );
  const windowLabel = `${formatTimeLabel(schedule.startAt)}-${formatTimeLabel(
    schedule.endAt,
  )}`;
  const branchName = schedule.branch?.name?.trim() || "Unassigned branch";
  return `${dayLabel}, ${windowLabel} - ${branchName}`;
};

const formatPayrollFrequencyLabel = (payFrequency: PayrollFrequency) => {
  if (payFrequency === PayrollFrequency.SEMI_MONTHLY) {
    return "Semi-monthly payroll";
  }
  if (payFrequency === PayrollFrequency.BIWEEKLY) {
    return "Biweekly payroll";
  }
  if (payFrequency === PayrollFrequency.WEEKLY) {
    return "Weekly payroll";
  }
  return "Custom payroll";
};

const summarizeTodayStatus = (args: {
  hasLinkedEmployee: boolean;
  todaySchedule:
    | {
        scheduleDate: Date;
        startAt: Date;
        endAt: Date;
        branch: { name: string } | null;
      }
    | null;
  todayAttendance:
    | {
        attendanceResult: AttendanceResult;
      }
    | null;
  nextShift:
    | {
        scheduleDate: Date;
        startAt: Date;
        endAt: Date;
        branch: { name: string } | null;
      }
    | null;
  now: Date;
}): WorkerDashboardSummary["todayStatus"] => {
  if (!args.hasLinkedEmployee) {
    return {
      label: "Profile not linked",
      tone: "danger",
      hint: "Schedule and payroll summary stay empty until this account is linked to an employee profile.",
    };
  }

  const scheduleLabel = args.todaySchedule
    ? formatScheduleLabel(args.todaySchedule, args.now)
    : null;

  if (
    args.todayAttendance?.attendanceResult ===
    AttendanceResult.SUSPENDED_NO_WORK
  ) {
    return {
      label: "Suspended today",
      tone: "danger",
      hint:
        scheduleLabel ??
        "Manager recorded a suspended no-work duty result for today.",
    };
  }

  if (args.todayAttendance?.attendanceResult === AttendanceResult.ABSENT) {
    return {
      label: "Absent recorded",
      tone: "danger",
      hint: scheduleLabel ?? "Attendance review marked this duty date absent.",
    };
  }

  if (args.todayAttendance?.attendanceResult === AttendanceResult.LEAVE) {
    return {
      label: "Leave recorded",
      tone: "warning",
      hint: scheduleLabel ?? "Manager recorded a leave duty result for today.",
    };
  }

  if (args.todayAttendance?.attendanceResult === AttendanceResult.HALF_DAY) {
    return {
      label: "Half-day recorded",
      tone: "warning",
      hint: scheduleLabel ?? "Attendance review recorded a half-day duty result.",
    };
  }

  if (args.todayAttendance?.attendanceResult === AttendanceResult.WHOLE_DAY) {
    const isActiveWindow =
      !!args.todaySchedule &&
      args.todaySchedule.startAt.getTime() <= args.now.getTime() &&
      args.todaySchedule.endAt.getTime() >= args.now.getTime();

    return {
      label: isActiveWindow ? "On-duty" : "Worked today",
      tone: "success",
      hint: scheduleLabel ?? "Attendance review recorded a whole-day duty result.",
    };
  }

  if (
    args.todayAttendance?.attendanceResult === AttendanceResult.NOT_REQUIRED
  ) {
    return {
      label: "No duty required",
      tone: "info",
      hint: "Attendance review marked today as not required.",
    };
  }

  if (args.todaySchedule) {
    const isActiveWindow =
      args.todaySchedule.startAt.getTime() <= args.now.getTime() &&
      args.todaySchedule.endAt.getTime() >= args.now.getTime();

    return {
      label: isActiveWindow ? "On-duty" : "Scheduled today",
      tone: isActiveWindow ? "success" : "info",
      hint: scheduleLabel ?? "Published shift for today.",
    };
  }

  if (args.nextShift) {
    return {
      label: "Awaiting next shift",
      tone: "info",
      hint: formatScheduleLabel(args.nextShift, args.now),
    };
  }

  return {
    label: "No schedule today",
    tone: "info",
    hint: "Manager has not published a future schedule for this worker yet.",
  };
};

async function loadChargeSummary(
  chargeScope: WorkerDashboardChargeScope | null | undefined,
  prisma: WorkforceDbClient,
) {
  if (!chargeScope) {
    return {
      openItemCount: 0,
      outstandingAmount: 0,
    };
  }

  if (chargeScope.lane === "RIDER") {
    const charges = await prisma.riderCharge.findMany({
      where: {
        riderId: chargeScope.employeeId,
        status: {
          in: [RiderChargeStatus.OPEN, RiderChargeStatus.PARTIALLY_SETTLED],
        },
      },
      select: {
        amount: true,
        payments: {
          select: { amount: true },
        },
      },
    });

    const outstandingBalances = charges
      .map((charge) => {
        const amount = Number(charge.amount ?? 0);
        const paid = charge.payments.reduce(
          (sum, payment) => sum + Number(payment.amount ?? 0),
          0,
        );
        return roundMoney(Math.max(0, amount - paid));
      })
      .filter((balance) => balance > 0);

    return {
      openItemCount: outstandingBalances.length,
      outstandingAmount: roundMoney(
        outstandingBalances.reduce((sum, balance) => sum + balance, 0),
      ),
    };
  }

  const charges = await prisma.cashierCharge.findMany({
    where: {
      cashierId: chargeScope.userId,
      status: {
        in: [CashierChargeStatus.OPEN, CashierChargeStatus.PARTIALLY_SETTLED],
      },
    },
    select: {
      amount: true,
      payments: {
        select: { amount: true },
      },
    },
  });

  const outstandingBalances = charges
    .map((charge) => {
      const amount = Number(charge.amount ?? 0);
      const paid = charge.payments.reduce(
        (sum, payment) => sum + Number(payment.amount ?? 0),
        0,
      );
      return roundMoney(Math.max(0, amount - paid));
    })
    .filter((balance) => balance > 0);

  return {
    openItemCount: outstandingBalances.length,
    outstandingAmount: roundMoney(
      outstandingBalances.reduce((sum, balance) => sum + balance, 0),
    ),
  };
}

export async function getWorkerDashboardSummary(
  args: {
    employeeId: number | null;
    chargeScope?: WorkerDashboardChargeScope | null;
    now?: Date;
  },
  prisma: WorkforceDbClient = db,
): Promise<WorkerDashboardSummary> {
  const now = args.now ? new Date(args.now) : new Date();
  const today = toDateOnly(now);
  const monthStart = startOfMonth(today);
  const nextMonthStart = startOfNextMonth(today);

  if (!args.employeeId || args.employeeId <= 0) {
    const charges = await loadChargeSummary(args.chargeScope, prisma);
    return {
      hasLinkedEmployee: false,
      todayStatus: summarizeTodayStatus({
        hasLinkedEmployee: false,
        todaySchedule: null,
        todayAttendance: null,
        nextShift: null,
        now,
      }),
      nextShift: {
        label: null,
        hint: "Schedule data is unavailable until this user is linked to an employee profile.",
        branchName: null,
        startsAt: null,
        endsAt: null,
        status: null,
      },
      attendance: {
        absentCountThisMonth: 0,
        lateCountThisMonth: 0,
        suspensionCountThisMonth: 0,
      },
      payroll: {
        policyLabel: null,
        latestLabel: null,
        latestPayDate: null,
        latestNetPay: null,
        latestGrossPay: null,
        latestDeductionTotal: null,
        latestStatus: null,
        unpaidFinalizedCount: 0,
      },
      charges,
    };
  }

  const employeeId = args.employeeId;

  const [
    todaySchedules,
    nextShiftRaw,
    todayAttendance,
    monthlyAttendanceRows,
    effectivePolicy,
    latestPayrollRun,
    unpaidFinalizedCount,
    charges,
  ] = await Promise.all([
    prisma.workerSchedule.findMany({
      where: {
        workerId: employeeId,
        status: WorkerScheduleStatus.PUBLISHED,
        scheduleDate: today,
      },
      include: {
        branch: {
          select: { name: true },
        },
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
    }),
    prisma.workerSchedule.findFirst({
      where: {
        workerId: employeeId,
        status: WorkerScheduleStatus.PUBLISHED,
        endAt: { gte: now },
      },
      include: {
        branch: {
          select: { name: true },
        },
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
    }),
    prisma.attendanceDutyResult.findUnique({
      where: {
        workerId_dutyDate: {
          workerId: employeeId,
          dutyDate: today,
        },
      },
      select: {
        attendanceResult: true,
      },
    }),
    prisma.attendanceDutyResult.findMany({
      where: {
        workerId: employeeId,
        dutyDate: {
          gte: monthStart,
          lt: nextMonthStart,
        },
      },
      select: {
        attendanceResult: true,
        lateFlag: true,
      },
    }),
    getEffectiveCompanyPayrollPolicy(prisma, now),
    prisma.payrollRun.findFirst({
      where: {
        status: {
          in: [PayrollRunStatus.FINALIZED, PayrollRunStatus.PAID],
        },
        payrollRunLines: {
          some: { employeeId },
        },
      },
      orderBy: [{ payDate: "desc" }, { id: "desc" }],
      select: {
        id: true,
        payDate: true,
        status: true,
        payrollRunLines: {
          where: { employeeId },
          select: {
            grossPay: true,
            totalDeductions: true,
            netPay: true,
          },
          take: 1,
        },
      },
    }),
    prisma.payrollRun.count({
      where: {
        status: PayrollRunStatus.FINALIZED,
        payrollRunLines: {
          some: { employeeId },
        },
      },
    }),
    loadChargeSummary(args.chargeScope, prisma),
  ]);

  const todaySchedule =
    todaySchedules.find(
      (schedule) =>
        schedule.startAt.getTime() <= now.getTime() &&
        schedule.endAt.getTime() >= now.getTime(),
    ) ??
    todaySchedules[0] ??
    null;

  const absentCountThisMonth = monthlyAttendanceRows.filter(
    (row) => row.attendanceResult === AttendanceResult.ABSENT,
  ).length;
  const lateCountThisMonth = monthlyAttendanceRows.filter(
    (row) => row.lateFlag === AttendanceLateFlag.YES,
  ).length;
  const suspensionCountThisMonth = monthlyAttendanceRows.filter(
    (row) =>
      row.attendanceResult === AttendanceResult.SUSPENDED_NO_WORK,
  ).length;

  const latestPayrollLine = latestPayrollRun?.payrollRunLines[0] ?? null;
  const payrollPolicyLabel = effectivePolicy
    ? effectivePolicy.customCutoffNote?.trim() ||
      formatPayrollFrequencyLabel(effectivePolicy.payFrequency)
    : null;
  const latestPayrollLabel = latestPayrollRun
    ? `${latestPayrollRun.status} - ${formatDateLabel(latestPayrollRun.payDate)}`
    : null;

  return {
    hasLinkedEmployee: true,
    todayStatus: summarizeTodayStatus({
      hasLinkedEmployee: true,
      todaySchedule,
      todayAttendance,
      nextShift: nextShiftRaw,
      now,
    }),
    nextShift: {
      label: nextShiftRaw ? formatScheduleLabel(nextShiftRaw, now) : null,
      hint: nextShiftRaw
        ? `Published shift at ${nextShiftRaw.branch?.name?.trim() || "unassigned branch"}.`
        : "Manager has not published a future schedule for this worker yet.",
      branchName: nextShiftRaw?.branch?.name?.trim() || null,
      startsAt: nextShiftRaw?.startAt.toISOString() ?? null,
      endsAt: nextShiftRaw?.endAt.toISOString() ?? null,
      status: nextShiftRaw?.status ?? null,
    },
    attendance: {
      absentCountThisMonth,
      lateCountThisMonth,
      suspensionCountThisMonth,
    },
    payroll: {
      policyLabel: payrollPolicyLabel,
      latestLabel: latestPayrollLabel,
      latestPayDate: latestPayrollRun?.payDate.toISOString() ?? null,
      latestNetPay:
        latestPayrollLine == null ? null : Number(latestPayrollLine.netPay),
      latestGrossPay:
        latestPayrollLine == null ? null : Number(latestPayrollLine.grossPay),
      latestDeductionTotal:
        latestPayrollLine == null
          ? null
          : Number(latestPayrollLine.totalDeductions),
      latestStatus: latestPayrollRun?.status ?? null,
      unpaidFinalizedCount,
    },
    charges,
  };
}
