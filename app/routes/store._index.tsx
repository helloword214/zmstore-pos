/* app/routes/store._index.tsx */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { r2, toNum, peso } from "~/utils/money";
import {
  SoTDashboardActionGrid,
  SoTDashboardActionTile,
  SoTDashboardPanel,
  SoTDashboardQueueList,
  SoTDashboardQueueRow,
  SoTDashboardSection,
  SoTDashboardSignal,
  SoTDashboardSignalGrid,
  SoTDashboardTopGrid,
} from "~/components/ui/SoTDashboardPrimitives";
import { SoTNotificationBell } from "~/components/ui/SoTNotificationBell";
import { Button } from "~/components/ui/Button";
import { SoTDataRow } from "~/components/ui/SoTDataRow";
import { SoTRoleShellHeader } from "~/components/ui/SoTRoleShellHeader";

const PLAN_TAG = "PLAN:PAYROLL_DEDUCTION";
const CLEARANCE_CASE_STATUS = {
  NEEDS_CLEARANCE: "NEEDS_CLEARANCE",
} as const;
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

  workforce: {
    activeTemplates: number;
    activeAssignments: number;
    scheduledToday: number;
    attendanceRecordedToday: number;
    draftSchedulesNext14Days: number;
    activeSuspensionsToday: number;
  };

  // Exceptions (small cards)
  exceptions: {
    riderVariancesOpen: number; // OPEN or MANAGER_APPROVED
    cashierShiftVariancesOpen: number; // OPEN
    payrollRiderAR: number; // tagged charges
    payrollCashierAR: number; // tagged charges
    clearancePending: number; // SoT: pending manager inbox workload
  };
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER"]);

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
  const planningWindowEnd = new Date(todayStart);
  planningWindowEnd.setDate(planningWindowEnd.getDate() + 13);

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

    // Workforce ops
    activeWorkforceTemplates,
    activeWorkforceAssignments,
    scheduledToday,
    attendanceRecordedToday,
    draftSchedulesNext14Days,
    activeSuspensionsToday,

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
    db.cashierShiftVariance.count({ where: { status: "OPEN" } }),

    // Workforce ops
    db.scheduleTemplate.count({
      where: {
        status: "ACTIVE",
        effectiveFrom: { lte: todayStart },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: todayStart } }],
      },
    }),
    db.scheduleTemplateAssignment.count({
      where: {
        status: "ACTIVE",
        effectiveFrom: { lte: todayStart },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: todayStart } }],
        template: {
          is: {
            status: "ACTIVE",
            effectiveFrom: { lte: todayStart },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: todayStart } }],
          },
        },
      },
    }),
    db.workerSchedule.count({
      where: {
        scheduleDate: todayStart,
        status: { not: "CANCELLED" },
      },
    }),
    db.attendanceDutyResult.count({
      where: {
        dutyDate: todayStart,
      },
    }),
    db.workerSchedule.count({
      where: {
        scheduleDate: {
          gte: todayStart,
          lte: planningWindowEnd,
        },
        status: "DRAFT",
      },
    }),
    db.suspensionRecord.count({
      where: {
        status: "ACTIVE",
        startDate: { lte: todayStart },
        endDate: { gte: todayStart },
      },
    }),

    // Exceptions
    db.riderRunVariance.count({
      where: { status: { in: ["OPEN", "MANAGER_APPROVED"] } },
    }),
    db.cashierShiftVariance.count({ where: { status: "OPEN" } }),
    db.riderCharge.count({
      where: {
        status: { in: ["OPEN", "PARTIALLY_SETTLED"] },
        note: { contains: PLAN_TAG },
      },
    }),
    db.cashierCharge.count({
      where: {
        status: { in: ["OPEN", "PARTIALLY_SETTLED"] },
        note: { contains: PLAN_TAG },
      },
    }),

    // Manager inbox badge source-of-truth:
    // pending commercial cases only (same anchor as /store/clearance list).
    // Excludes opening-balance rows (those are shown in opening-batches lane).
    db.clearanceCase.count({
      where: {
        status: CLEARANCE_CASE_STATUS.NEEDS_CLEARANCE,
        OR: [
          { orderId: { not: null } },
          { runReceiptId: { not: null } },
        ],
      },
    }),
  ]);

  const cashSalesToday = r2(toNum(cashSalesTodayAgg._sum.amount));
  const drawerTxnsToday = r2(
    (drawerTxnsTodayRows || []).reduce(
      (acc, t) => acc + Math.abs(toNum(t.amount)),
      0,
    ),
  );

  // Expected drawer total (open shifts):
  // openingFloat + CASH payments(in shift) + CASH_IN - CASH_OUT - DROP
  const openShiftIdList = (openShiftRows || []).map((s) => Number(s.id));
  let expectedDrawerTotal = 0;

  if (openShiftIdList.length > 0) {
    const [payByShift, txByShift] = await Promise.all([
      db.payment.groupBy({
        by: ["shiftId"],
        where: {
          shiftId: { in: openShiftIdList },
          method: "CASH",
        },
        _sum: { amount: true },
      }),
      db.cashDrawerTxn.groupBy({
        by: ["shiftId", "type"],
        where: { shiftId: { in: openShiftIdList } },
        _sum: { amount: true },
      }),
    ]);

    const openMap = new Map<number, number>(
      (openShiftRows || []).map((s) => [
        Number(s.id),
        toNum(s.openingFloat),
      ]),
    );

    const payMap = new Map<number, number>();
    for (const r of payByShift || []) {
      if (r.shiftId == null) continue;
      payMap.set(Number(r.shiftId), toNum(r._sum?.amount));
    }

    const txMap = new Map<number, { in: number; out: number; drop: number }>();
    for (const r of txByShift || []) {
      const sid = Number(r.shiftId || 0);
      if (!sid) continue;

      const cur = txMap.get(sid) || { in: 0, out: 0, drop: 0 };
      const amt = toNum(r._sum?.amount);
      const type = r.type;

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
    workforce: {
      activeTemplates: activeWorkforceTemplates,
      activeAssignments: activeWorkforceAssignments,
      scheduledToday,
      attendanceRecordedToday,
      draftSchedulesNext14Days,
      activeSuspensionsToday,
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
  const { me, dispatch, runs, cash, workforce, exceptions } = useLoaderData<LoaderData>();

  const identityLabel = me.alias ? `${me.alias} (${me.name})` : me.name;
  const varianceDecisionCount =
    exceptions.riderVariancesOpen + exceptions.cashierShiftVariancesOpen;
  const payrollTaggedCount =
    exceptions.payrollRiderAR + exceptions.payrollCashierAR;
  const priorityCount =
    varianceDecisionCount +
    payrollTaggedCount +
    exceptions.clearancePending +
    runs.needsManagerReview;
  const attendancePendingToday = Math.max(
    workforce.scheduledToday - workforce.attendanceRecordedToday,
    0,
  );
  const attendanceStatusLabel =
    attendancePendingToday > 0
      ? `${attendancePendingToday} pending today`
      : workforce.scheduledToday > 0
        ? "Attendance up to date"
        : "No schedule";
  const attendanceStatusTone =
    attendancePendingToday > 0
      ? "warning"
      : workforce.scheduledToday > 0
        ? "success"
        : "default";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTRoleShellHeader
        title="Manager Dashboard"
        identityLine={`${identityLabel} · ${me.role} · ${me.email}`}
        sticky
        actions={
          <>
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
                  count: varianceDecisionCount,
                  to: "/store/rider-variances",
                },
              ]}
            />
            <Link to="/account/security">
              <Button variant="tertiary" title="Account security">
                Account
              </Button>
            </Link>
            <Form method="post" action="/logout">
              <Button variant="tertiary" title="Sign out">
                Logout
              </Button>
            </Form>
          </>
        }
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-5">
        <SoTDashboardTopGrid>
          <div className="xl:col-span-4">
            <SoTDashboardPanel
              title="Needs Attention"
              subtitle="Queues that need manager action"
              badge={`${priorityCount} pending`}
              tone="info"
            >
              <SoTDashboardQueueList>
                <SoTDashboardQueueRow
                  to="/store/clearance"
                  label="Review Clearance"
                  value={`${exceptions.clearancePending} pending`}
                  actionLabel="Review"
                  tone={exceptions.clearancePending > 0 ? "warning" : "default"}
                />
                <SoTDashboardQueueRow
                  to="/store/rider-variances"
                  label="Review Variances"
                  value={`${varianceDecisionCount} pending`}
                  actionLabel="Review"
                  tone={varianceDecisionCount > 0 ? "danger" : "default"}
                />
                <SoTDashboardQueueRow
                  to="/runs?status=CHECKED_IN"
                  label="Open Remit Review"
                  value={`${runs.needsManagerReview} checked-in`}
                  actionLabel="Open"
                  tone={runs.needsManagerReview > 0 ? "info" : "default"}
                />
                <SoTDashboardQueueRow
                  to="/store/payroll"
                  label="Open Payroll Tags"
                  value={`${payrollTaggedCount} tagged`}
                  actionLabel="Open"
                  tone={payrollTaggedCount > 0 ? "warning" : "default"}
                />
              </SoTDashboardQueueList>
            </SoTDashboardPanel>
          </div>

          <div className="xl:col-span-5">
            <SoTDashboardPanel
              title="Dispatch"
              subtitle="Orders waiting release"
              badge={`${dispatch.forDispatchOrders} waiting`}
              tone="info"
            >
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <SoTDataRow label="For dispatch" value={dispatch.forDispatchOrders} />
                  <SoTDataRow label="Staged" value={dispatch.stagedOrders} />
                  <SoTDataRow label="Planned runs" value={runs.planned} />
                  <SoTDataRow label="Checked-in" value={runs.checkedIn} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/store/dispatch"
                    className="inline-flex h-9 items-center rounded-xl bg-sky-600 px-3 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Open Dispatch
                  </Link>
                  <Link
                    to="/runs"
                    className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Open Runs
                  </Link>
                  {me.role === "STORE_MANAGER" ? (
                    <Link
                      to="/pad-order"
                      className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    >
                      Open Order Pad
                    </Link>
                  ) : null}
                </div>
              </div>
            </SoTDashboardPanel>
          </div>

          <div className="xl:col-span-3">
            <SoTDashboardPanel
              title="Signals"
              subtitle="Today"
              badge={attendanceStatusLabel}
              tone={attendanceStatusTone}
            >
              <SoTDashboardSignalGrid className="xl:grid-cols-1">
                <SoTDashboardSignal
                  label="Runs"
                  value={runs.dispatched + runs.checkedIn}
                  meta={`${runs.planned} planned`}
                  tone="info"
                />
                <SoTDashboardSignal
                  label="Open Shifts"
                  value={cash.openShifts}
                  meta={peso(cash.expectedDrawerTotal)}
                  tone="success"
                />
                <SoTDashboardSignal
                  label="Attendance"
                  value={attendancePendingToday}
                  meta={
                    workforce.scheduledToday > 0
                      ? `${workforce.attendanceRecordedToday} recorded`
                      : "No schedule"
                  }
                  tone={attendanceStatusTone}
                />
              </SoTDashboardSignalGrid>
            </SoTDashboardPanel>
          </div>
        </SoTDashboardTopGrid>

        <SoTDashboardSection
          title="Quick Actions"
          subtitle="Operational lanes and reviews"
        >
          <SoTDashboardActionGrid>
            <SoTDashboardActionTile
              to="/store/cashier-shifts"
              title="Cashier Shifts"
              detail="Shift control and close review"
              actionLabel="Open Cashier Shifts"
              badge={`${cash.openShifts} open`}
              tone="success"
            />
            <SoTDashboardActionTile
              to="/store/cashier-variances"
              title="Shift Variances"
              detail="Cashier variance decisions"
              actionLabel="Review Shift Variances"
              badge={`${cash.openShiftVariances} open`}
              tone={cash.openShiftVariances > 0 ? "warning" : "default"}
            />
            <SoTDashboardActionTile
              to="/store/workforce/attendance-review"
              title="Attendance Review"
              detail="Today's workforce lane"
              actionLabel="Open Attendance Review"
              badge={attendanceStatusLabel}
              tone={attendanceStatusTone}
            />
            <SoTDashboardActionTile
              to="/store/workforce/schedule-planner"
              title="Schedule Planner"
              detail="Drafts in the next 14 days"
              actionLabel="Open Schedule Planner"
              badge={
                workforce.draftSchedulesNext14Days > 0
                  ? `${workforce.draftSchedulesNext14Days} drafts`
                  : "Up to date"
              }
              tone={workforce.draftSchedulesNext14Days > 0 ? "warning" : "default"}
            />
            <SoTDashboardActionTile
              to="/store/workforce/schedule-templates"
              title="Schedule Templates"
              detail="Template and assignment coverage"
              actionLabel="Open Templates"
              badge={`${workforce.activeTemplates} active`}
              tone="default"
            />
            <SoTDashboardActionTile
              to="/store/workforce/suspension-records"
              title="Suspension Records"
              detail="Workforce control overlays"
              actionLabel="Open Suspension Records"
              badge={
                workforce.activeSuspensionsToday > 0
                  ? `${workforce.activeSuspensionsToday} active`
                  : "Clear"
              }
              tone={workforce.activeSuspensionsToday > 0 ? "warning" : "default"}
            />
          </SoTDashboardActionGrid>
        </SoTDashboardSection>

        <SoTDashboardSection title="Reference" subtitle="Quieter summaries">
          <div className="grid gap-3 md:grid-cols-2">
            <SoTDashboardPanel
              title="Cash Position"
              subtitle="Drawer and sales snapshot"
              badge="Today"
              tone="success"
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <SoTDataRow label="Open shifts" value={cash.openShifts} />
                <SoTDataRow label="Expected drawers" value={peso(cash.expectedDrawerTotal)} />
                <SoTDataRow label="Cash sales" value={peso(cash.cashSalesToday)} />
                <SoTDataRow label="Drawer movements" value={peso(cash.drawerTxnsToday)} />
              </div>
            </SoTDashboardPanel>

            <SoTDashboardPanel
              title="Workforce"
              subtitle="Coverage and schedule readiness"
              badge={attendanceStatusLabel}
              tone={attendanceStatusTone}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <SoTDataRow label="Assignments live" value={workforce.activeAssignments} />
                <SoTDataRow label="Active templates" value={workforce.activeTemplates} />
                <SoTDataRow label="Scheduled today" value={workforce.scheduledToday} />
                <SoTDataRow label="Recorded today" value={workforce.attendanceRecordedToday} />
              </div>
            </SoTDashboardPanel>
          </div>
        </SoTDashboardSection>
      </div>
    </main>
  );
}
