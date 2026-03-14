import {
  CashierChargeStatus,
  RiderChargeStatus,
} from "@prisma/client";
import { db } from "~/utils/db.server";
import type { WorkforceDbClient } from "~/services/worker-payroll-policy.server";

export const PAYROLL_PLAN_TAG = "PLAN:PAYROLL_DEDUCTION";

export type PayrollTaggedChargeItem = {
  chargeKind: "RIDER" | "CASHIER";
  chargeId: number;
  employeeId: number;
  sourceActorId: number;
  employeeLabel: string;
  amount: number;
  paid: number;
  remaining: number;
  status: string;
  note: string | null;
  createdAt: Date;
  varianceId: number | null;
  runId: number | null;
  shiftId: number | null;
};

export type UnresolvedCashierPayrollCharge = {
  chargeId: number;
  cashierUserId: number;
  cashierLabel: string;
  amount: number;
  paid: number;
  remaining: number;
  status: string;
  note: string | null;
  createdAt: Date;
  reason: "MISSING_LINKED_EMPLOYEE";
};

const roundMoney = (value: number) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const formatEmployeeLabel = (args: {
  alias?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fallback: string;
}) => {
  const fullName = [args.firstName, args.lastName].filter(Boolean).join(" ").trim();
  if (args.alias && fullName) return `${args.alias} (${fullName})`;
  if (args.alias) return args.alias;
  if (fullName) return fullName;
  return args.fallback;
};

export async function listOpenPayrollTaggedChargeItems(
  prisma: WorkforceDbClient = db,
  args?: { employeeId?: number },
) {
  const [riderCharges, cashierCharges] = await Promise.all([
    prisma.riderCharge.findMany({
      where: {
        status: {
          in: [RiderChargeStatus.OPEN, RiderChargeStatus.PARTIALLY_SETTLED],
        },
        note: { contains: PAYROLL_PLAN_TAG },
        ...(args?.employeeId ? { riderId: args.employeeId } : {}),
      },
      select: {
        id: true,
        riderId: true,
        amount: true,
        status: true,
        note: true,
        createdAt: true,
        varianceId: true,
        runId: true,
        rider: {
          select: { firstName: true, lastName: true, alias: true },
        },
        payments: { select: { amount: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.cashierCharge.findMany({
      where: {
        status: {
          in: [CashierChargeStatus.OPEN, CashierChargeStatus.PARTIALLY_SETTLED],
        },
        note: { contains: PAYROLL_PLAN_TAG },
        ...(args?.employeeId
          ? { cashier: { is: { employeeId: args.employeeId } } }
          : {}),
      },
      select: {
        id: true,
        cashierId: true,
        shiftId: true,
        amount: true,
        status: true,
        note: true,
        createdAt: true,
        varianceId: true,
        cashier: {
          select: {
            email: true,
            employeeId: true,
            employee: {
              select: { firstName: true, lastName: true, alias: true },
            },
          },
        },
        payments: { select: { amount: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const items: PayrollTaggedChargeItem[] = [];
  const unresolvedCashierCharges: UnresolvedCashierPayrollCharge[] = [];

  for (const charge of riderCharges) {
    const amount = roundMoney(Number(charge.amount));
    const paid = roundMoney(
      charge.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );
    const remaining = roundMoney(Math.max(0, amount - paid));
    if (remaining <= 0) continue;

    items.push({
      chargeKind: "RIDER",
      chargeId: charge.id,
      employeeId: charge.riderId,
      sourceActorId: charge.riderId,
      employeeLabel: formatEmployeeLabel({
        alias: charge.rider.alias,
        firstName: charge.rider.firstName,
        lastName: charge.rider.lastName,
        fallback: `Employee #${charge.riderId}`,
      }),
      amount,
      paid,
      remaining,
      status: charge.status,
      note: charge.note ?? null,
      createdAt: charge.createdAt,
      varianceId: charge.varianceId ?? null,
      runId: charge.runId ?? null,
      shiftId: null,
    });
  }

  for (const charge of cashierCharges) {
    const amount = roundMoney(Number(charge.amount));
    const paid = roundMoney(
      charge.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );
    const remaining = roundMoney(Math.max(0, amount - paid));
    if (remaining <= 0) continue;

    const employeeLabel = formatEmployeeLabel({
      alias: charge.cashier.employee?.alias,
      firstName: charge.cashier.employee?.firstName,
      lastName: charge.cashier.employee?.lastName,
      fallback: charge.cashier.email ?? `User #${charge.cashierId}`,
    });

    if (!charge.cashier.employeeId) {
      unresolvedCashierCharges.push({
        chargeId: charge.id,
        cashierUserId: charge.cashierId,
        cashierLabel: employeeLabel,
        amount,
        paid,
        remaining,
        status: charge.status,
        note: charge.note ?? null,
        createdAt: charge.createdAt,
        reason: "MISSING_LINKED_EMPLOYEE",
      });
      continue;
    }

    items.push({
      chargeKind: "CASHIER",
      chargeId: charge.id,
      employeeId: charge.cashier.employeeId,
      sourceActorId: charge.cashierId,
      employeeLabel,
      amount,
      paid,
      remaining,
      status: charge.status,
      note: charge.note ?? null,
      createdAt: charge.createdAt,
      varianceId: charge.varianceId ?? null,
      runId: null,
      shiftId: charge.shiftId ?? null,
    });
  }

  items.sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || left.chargeId - right.chargeId,
  );
  unresolvedCashierCharges.sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || left.chargeId - right.chargeId,
  );

  return { items, unresolvedCashierCharges };
}

export async function listOpenPayrollTaggedChargeItemsForEmployee(
  employeeId: number,
  prisma: WorkforceDbClient = db,
) {
  const { items } = await listOpenPayrollTaggedChargeItems(prisma, {
    employeeId,
  });
  return items;
}

export async function listUnresolvedCashierPayrollCharges(
  prisma: WorkforceDbClient = db,
) {
  const { unresolvedCashierCharges } = await listOpenPayrollTaggedChargeItems(
    prisma,
  );
  return unresolvedCashierCharges;
}

export async function assertNoUnresolvedCashierPayrollCharges(
  prisma: WorkforceDbClient = db,
) {
  const unresolved = await listUnresolvedCashierPayrollCharges(prisma);
  if (unresolved.length === 0) return;

  throw new Error(
    `Payroll is blocked by ${unresolved.length} unresolved cashier payroll charge(s) without linked Employee records.`,
  );
}

export async function getPayrollTaggedChargeSummaryForEmployee(
  employeeId: number,
  prisma: WorkforceDbClient = db,
) {
  const items = await listOpenPayrollTaggedChargeItemsForEmployee(
    employeeId,
    prisma,
  );

  return {
    itemCount: items.length,
    totalRemaining: roundMoney(
      items.reduce((sum, item) => sum + item.remaining, 0),
    ),
    items,
  };
}
