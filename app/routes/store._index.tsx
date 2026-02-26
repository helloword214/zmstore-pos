/* app/routes/store._index.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { r2, toNum, peso } from "~/utils/money";
import { SoTNotificationBell } from "~/components/ui/SoTNotificationBell";
import { Button } from "~/components/ui/Button";
import { sotCardClass } from "~/components/ui/SoTCard";
import { SoTDataRow } from "~/components/ui/SoTDataRow";

const PLAN_TAG = "PLAN:PAYROLL_DEDUCTION";

type LoaderData = {
  me: {
    id: number;
    role: string;
    name: string;
    alias: string | null;
    email: string;
  };

  // What happens often (big cards)
  dispatch: {
    forDispatchOrders: number; // DELIVERY orders not yet dispatched
    stagedOrders: number; // staged but not dispatched (optional signal)
  };
  runs: {
    planned: number;
    dispatched: number;
    checkedIn: number;
    needsManagerReview: number; // CHECKED_IN (manager lane)
  };

  // Cash position (manager)
  cash: {
    openShifts: number;
    expectedDrawerTotal: number; // sum expected cash across open shifts
    cashSalesToday: number; // sum cash payments today (all shifts)
    drawerTxnsToday: number; // sum abs(txn amounts) today (all types)
    openShiftVariances: number; // shift variances OPEN
  };

  // Exceptions (small cards)
  exceptions: {
    riderVariancesOpen: number; // OPEN or MANAGER_APPROVED
    cashierShiftVariancesOpen: number; // OPEN
    payrollRiderAR: number; // tagged charges
    payrollCashierAR: number; // tagged charges
    clearancePending: number; // Phase 1: CHECKED_IN receipts w/ credit signal
  };
};

function MiniBadge({ n }: { n: number }) {
  if (!n || n <= 0) return null;
  return (
    <span className="inline-flex min-w-[18px] items-center justify-center rounded-xl bg-slate-900 px-2 py-0.5 text-xs font-semibold leading-none text-white">
      {n}
    </span>
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  const userRow = await db.user.findUnique({
    where: { id: me.userId },
    include: { employee: true },
  });
  if (!userRow) throw new Response("User not found", { status: 404 });

  const emp = userRow.employee;
  const fullName =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : userRow.email ?? "Unknown user";
  const alias = emp?.alias ?? null;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    // Dispatch lane
    forDispatchOrders,
    stagedOrders,

    // Runs lane
    plannedRuns,
    dispatchedRuns,
    checkedInRuns,

    // Cash position
    openShifts,
    openShiftRows, // [{id, openingFloat}]
    cashSalesTodayAgg,
    drawerTxnsTodayRows,
    openShiftVariances,

    // Exceptions
    riderVariancesOpen,
    cashierShiftVariancesOpen,
    payrollRiderAR,
    payrollCashierAR,
    clearancePending,
  ] = await Promise.all([
    // For dispatch = delivery orders not yet dispatched
    db.order.count({
      where: {
        channel: "DELIVERY",
        status: { in: ["UNPAID", "PARTIALLY_PAID"] },
        dispatchedAt: null,
      },
    }),

    // Staged but not dispatched
    db.order.count({
      where: {
        channel: "DELIVERY",
        status: { in: ["UNPAID", "PARTIALLY_PAID"] },
        stagedAt: { not: null },
        dispatchedAt: null,
      },
    }),

    db.deliveryRun.count({ where: { status: "PLANNED" } }),
    db.deliveryRun.count({ where: { status: "DISPATCHED" } }),
    db.deliveryRun.count({ where: { status: "CHECKED_IN" } }),

    // Open shifts
    db.cashierShift.count({ where: { closedAt: null } }),
    db.cashierShift.findMany({
      where: { closedAt: null },
      select: { id: true, openingFloat: true },
      take: 50,
    }),

    // Cash sales today (all shifts)
    db.payment.aggregate({
      where: { method: "CASH", createdAt: { gte: todayStart } },
      _sum: { amount: true },
    }),

    // Drawer txns today (abs sum signal)
    db.cashDrawerTxn.findMany({
      where: { createdAt: { gte: todayStart } },
      select: { amount: true },
      take: 5000,
    }),

    // Open shift variances (manager audit)
    db.cashierShiftVariance.count({ where: { status: "OPEN" as any } }),

    // Exceptions
    db.riderRunVariance.count({
      where: { status: { in: ["OPEN", "MANAGER_APPROVED"] } },
    }),
    db.cashierShiftVariance.count({ where: { status: "OPEN" as any } }),
    db.riderCharge.count({
      where: {
        status: { in: ["OPEN", "PARTIALLY_SETTLED"] },
        note: { contains: PLAN_TAG },
      },
    }),
    db.cashierCharge.count({
      where: {
        status: { in: ["OPEN", "PARTIALLY_SETTLED"] as any },
        note: { contains: PLAN_TAG },
      },
    }),

    // CCS Phase 1 (badge): best-effort "needs clearance" signal.
    // We don’t have CCS decision records yet, so we surface obvious credit cases:
    // - cashCollected <= 0, OR
    // - receipt.note contains '"isCredit":true'
    // NOTE: Partial payments with positive cash but still with balance may not be counted yet
    // (we'll fix once CCS schema exists).
    db.runReceipt.count({
      where: {
        run: { status: "CHECKED_IN" as any },
        kind: { in: ["ROAD", "PARENT"] as any },
        OR: [
          { cashCollected: { lte: 0 as any } },
          { note: { contains: '"isCredit":true' } },
          { note: { contains: '"isCredit": true' } },
        ],
      },
    }),
  ]);

  const cashSalesToday = r2(toNum((cashSalesTodayAgg as any)?._sum?.amount));
  const drawerTxnsToday = r2(
    (drawerTxnsTodayRows || []).reduce(
      (acc: number, t: any) => acc + Math.abs(toNum(t.amount)),
      0,
    ),
  );

  // Expected drawer total (open shifts):
  // openingFloat + CASH payments(in shift) + CASH_IN - CASH_OUT - DROP
  const openShiftIdList = (openShiftRows || []).map((s: any) => Number(s.id));
  let expectedDrawerTotal = 0;

  if (openShiftIdList.length > 0) {
    const [payByShift, txByShift] = await Promise.all([
      db.payment.groupBy({
        by: ["shiftId"],
        where: {
          shiftId: { in: openShiftIdList as any },
          method: "CASH",
        },
        _sum: { amount: true },
      }),
      db.cashDrawerTxn.groupBy({
        by: ["shiftId", "type"],
        where: { shiftId: { in: openShiftIdList as any } },
        _sum: { amount: true },
      }),
    ]);

    const openMap = new Map<number, number>(
      (openShiftRows || []).map((s: any) => [
        Number(s.id),
        toNum(s.openingFloat),
      ]),
    );

    const payMap = new Map<number, number>(
      (payByShift || []).map((r: any) => [
        Number(r.shiftId),
        toNum(r._sum?.amount),
      ]),
    );

    const txMap = new Map<number, { in: number; out: number; drop: number }>();
    for (const r of txByShift || []) {
      const sid = Number((r as any).shiftId || 0);
      if (!sid) continue;

      const cur = txMap.get(sid) || { in: 0, out: 0, drop: 0 };
      const amt = toNum((r as any)._sum?.amount);
      const type = String((r as any).type || "");

      if (type === "CASH_IN") cur.in += amt;
      else if (type === "CASH_OUT") cur.out += amt;
      else if (type === "DROP") cur.drop += amt;

      txMap.set(sid, cur);
    }

    expectedDrawerTotal = r2(
      openShiftIdList.reduce((acc: number, sid: number) => {
        const opening = openMap.get(sid) || 0;
        const cashPay = payMap.get(sid) || 0;
        const t = txMap.get(sid) || { in: 0, out: 0, drop: 0 };
        return acc + (opening + cashPay + t.in - t.out - t.drop);
      }, 0),
    );
  }

  const data: LoaderData = {
    me: {
      id: me.userId,
      role: me.role,
      name: fullName,
      alias,
      email: userRow.email ?? "",
    },
    dispatch: {
      forDispatchOrders,
      stagedOrders,
    },
    runs: {
      planned: plannedRuns,
      dispatched: dispatchedRuns,
      checkedIn: checkedInRuns,
      needsManagerReview: checkedInRuns,
    },
    cash: {
      openShifts,
      expectedDrawerTotal,
      cashSalesToday,
      drawerTxnsToday,
      openShiftVariances,
    },
    exceptions: {
      riderVariancesOpen,
      cashierShiftVariancesOpen,
      payrollRiderAR,
      payrollCashierAR,
      clearancePending,
    },
  };

  return json<LoaderData>(data);
}

export default function StoreManagerDashboard() {
  const { me, dispatch, runs, cash, exceptions } = useLoaderData<LoaderData>();

  const exceptionCount =
    exceptions.riderVariancesOpen +
    exceptions.cashierShiftVariancesOpen +
    exceptions.payrollRiderAR +
    exceptions.payrollCashierAR +
    exceptions.clearancePending;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Store Manager Dashboard
            </h1>
            <p className="text-xs text-slate-500">
              <span className="font-medium text-slate-700">
                {me.alias ? `${me.alias} (${me.name})` : me.name}
              </span>
              {" · "}
              <span className="uppercase tracking-wide">{me.role}</span>
              {" · "}
              <span>{me.email}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <SoTNotificationBell
              items={[
                {
                  id: "clearance",
                  label: "Clearance pending decisions",
                  count: exceptions.clearancePending,
                  to: "/store/clearance",
                },
                {
                  id: "remit",
                  label: "Remit / close reviews",
                  count: runs.needsManagerReview,
                  to: "/runs?status=CHECKED_IN",
                },
                {
                  id: "variance",
                  label: "Variance decisions",
                  count:
                    exceptions.riderVariancesOpen +
                    exceptions.cashierShiftVariancesOpen,
                  to: "/store/rider-variances",
                },
              ]}
            />

            <Form method="post" action="/logout">
              <Button variant="tertiary" title="Sign out">
                Logout
              </Button>
            </Form>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-5">
        {/* BIG: what manager checks often */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Operations
          </h2>

          <div className="grid gap-3 lg:grid-cols-3">
            {/* Dispatch (big) */}
            <div className={sotCardClass({ interaction: "static", className: "group" })}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                    Dispatch Queue
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    For Dispatch Orders
                  </div>
                </div>
                <span className="inline-flex items-center gap-2">
                  <span className="text-lg font-semibold text-slate-900">
                    {dispatch.forDispatchOrders}
                  </span>
                </span>
              </div>

              <div className="mt-3 grid gap-2">
                <SoTDataRow
                  label="Staged (not dispatched)"
                  value={dispatch.stagedOrders}
                />
                <SoTDataRow
                  label="Next step"
                  value={<span className="font-medium">Assign rider and vehicle</span>}
                />
              </div>

              <Link
                to="/store/dispatch"
                className="mt-3 inline-flex items-center text-sm font-medium text-indigo-700 transition-colors duration-150 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Open dispatch queue →
              </Link>
            </div>

            {/* Runs (big) */}
            <div className={sotCardClass({ interaction: "static", className: "group" })}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                    Runs Monitor
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    Track & Close Runs
                  </div>
                </div>
                <span className="text-lg font-semibold text-slate-900">
                  {runs.planned + runs.dispatched + runs.checkedIn}
                </span>
              </div>

              <div className="mt-3 grid gap-2">
                <SoTDataRow label="PLANNED" value={runs.planned} />
                <SoTDataRow label="DISPATCHED" value={runs.dispatched} />
                <SoTDataRow
                  label="CHECKED_IN (manager)"
                  value={runs.needsManagerReview}
                />
              </div>

              <Link
                to="/runs"
                className="mt-3 inline-flex items-center text-sm font-medium text-indigo-700 transition-colors duration-150 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Open runs →
              </Link>
            </div>

            {/* Schedule (big placeholder) */}
            <div className={sotCardClass({})}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Schedule
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    Employee Schedule (soon)
                  </div>
                </div>
                <span className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  PLAN
                </span>
              </div>

              <p className="mt-3 text-xs text-slate-600">
                Card for: today’s assigned staff/riders, duty hours, and
                coverage gaps. (We’ll add models for attendance + payroll
                later.)
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to="/employees"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  View employees →
                </Link>
                <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Schedule board soon
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Manager focus (cash) */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Manager Focus
            </h2>
          </div>

          <div className={sotCardClass({})}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Cash Position
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Drawer money + today cash signals
                </div>
              </div>
              <span className="rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                TODAY
              </span>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-600">Open shifts</div>
                <div className="text-sm font-semibold text-slate-900">
                  {cash.openShifts}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-600">
                  Expected drawers
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {peso(cash.expectedDrawerTotal)}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-600">
                  Cash sales today
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {peso(cash.cashSalesToday)}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-600">
                  Drawer movements
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {peso(cash.drawerTxnsToday)}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <Link
                to="/store/cashier-shifts"
                className="rounded-xl border border-emerald-200 bg-white px-3 py-2 font-medium text-emerald-800 hover:bg-emerald-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Open/Close cashier shifts →
              </Link>

              <Link
                to="/store/cashier-variances"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Shift variances <MiniBadge n={cash.openShiftVariances} />
              </Link>

              <span className="text-xs text-slate-600">
                DROP = vault movement (cash out of drawer).
              </span>
            </div>
          </div>
        </section>

        {/* Exceptions */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Exceptions
            </h2>
            <span className="text-xs text-slate-500">
              Not frequent. Show small. Total:{" "}
              <span className="font-semibold text-slate-900">
                {exceptionCount}
              </span>
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              to="/store/rider-variances"
              className={sotCardClass({ interaction: "link" })}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Rider Variances
                </div>
                <MiniBadge n={exceptions.riderVariancesOpen} />
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {exceptions.riderVariancesOpen}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Open / manager-approved items.
              </p>
            </Link>

            <Link
              to="/store/cashier-variances"
              className={sotCardClass({ interaction: "link" })}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Cashier Variances
                </div>
                <MiniBadge n={exceptions.cashierShiftVariancesOpen} />
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {exceptions.cashierShiftVariancesOpen}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Shift close audit queue.
              </p>
            </Link>

            <Link
              to="/store/payroll"
              className={sotCardClass({ interaction: "link" })}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Rider AR (tagged)
                </div>
                <MiniBadge n={exceptions.payrollRiderAR} />
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {exceptions.payrollRiderAR}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Payroll deduction queue.
              </p>
            </Link>

            <Link
              to="/store/payroll"
              className={sotCardClass({ interaction: "link" })}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Cashier AR (tagged)
                </div>
                <MiniBadge n={exceptions.payrollCashierAR} />
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                {exceptions.payrollCashierAR}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Payroll deduction queue.
              </p>
            </Link>
          </div>
        </section>

        {/* Payroll / attendance future note */}
        <section>
          <div className={sotCardClass({})}>
            <div className="text-sm font-medium text-slate-900">
              Payroll (future)
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Next milestone: Attendance + Salary payouts (not just deductions).
              The dashboard will show: schedule coverage → attendance logs →
              payroll computation → payouts.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
