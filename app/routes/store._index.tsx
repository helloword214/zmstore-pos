/* app/routes/store._index.tsx */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { ClearanceCaseStatus } from "@prisma/client";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { r2, toNum, peso } from "~/utils/money";
import { SoTNotificationBell } from "~/components/ui/SoTNotificationBell";
import { Button } from "~/components/ui/Button";
import { sotCardClass } from "~/components/ui/SoTCard";
import { SoTDataRow } from "~/components/ui/SoTDataRow";
import { SoTRoleShellHeader } from "~/components/ui/SoTRoleShellHeader";

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

function MiniBadge({ n }: { n: number }) {
  if (!n || n <= 0) return null;
  return (
    <span className="inline-flex min-w-[18px] items-center justify-center rounded-xl bg-slate-900 px-2 py-0.5 text-xs font-semibold leading-none text-white">
      {n}
    </span>
  );
}

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
        status: ClearanceCaseStatus.NEEDS_CLEARANCE,
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
  const exceptionCount =
    varianceDecisionCount + payrollTaggedCount + exceptions.clearancePending;
  const attendancePendingToday = Math.max(
    workforce.scheduledToday - workforce.attendanceRecordedToday,
    0,
  );
  const workforceStatusLabel =
    attendancePendingToday > 0
      ? `${attendancePendingToday} pending today`
      : workforce.scheduledToday > 0
        ? "Attendance caught up"
        : "Awaiting today's schedule";
  const workforceStatusToneClass =
    attendancePendingToday > 0
      ? "border-amber-300 bg-amber-100/90 text-amber-900"
      : workforce.scheduledToday > 0
        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
        : "border-slate-200 bg-white/90 text-slate-700";
  const attendanceSummary =
    workforce.scheduledToday === 0
      ? "No schedules are loaded for today yet. You can still review attendance facts or move straight to schedule planning."
      : attendancePendingToday > 0
        ? `${attendancePendingToday} of ${workforce.scheduledToday} scheduled workers still need attendance review today.`
        : `All ${workforce.scheduledToday} scheduled workers already have attendance results recorded today.`;
  const workforcePlannerSummary =
    workforce.draftSchedulesNext14Days > 0
      ? `${workforce.draftSchedulesNext14Days} draft schedule ${
          workforce.draftSchedulesNext14Days === 1 ? "row is" : "rows are"
        } waiting across the next 14 days.`
      : "No draft schedule rows are waiting across the next 14 days.";
  const workforceTemplateSummary =
    workforce.activeTemplates > 0
      ? `${workforce.activeTemplates} active template${
          workforce.activeTemplates === 1 ? "" : "s"
        } support ${workforce.activeAssignments} live assignment${
          workforce.activeAssignments === 1 ? "" : "s"
        }.`
      : "No active workforce templates are live yet.";
  const workforceSuspensionSummary =
    workforce.activeSuspensionsToday > 0
      ? `${workforce.activeSuspensionsToday} active suspension${
          workforce.activeSuspensionsToday === 1 ? " is" : "s are"
        } affecting today's workforce lane.`
      : "No active suspensions are affecting today's workforce lane.";

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

      <div className="mx-auto max-w-6xl px-5 py-5">
        <div className="grid gap-4 xl:grid-cols-12 xl:items-stretch">
          <section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-sm xl:col-span-4 xl:h-full">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Manager Decision Inbox
              </h2>
              <span className="inline-flex items-center rounded-lg border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                {exceptionCount} pending
              </span>
            </div>

            <div className="space-y-1.5">
              <ManagerInboxRow
                to="/store/clearance"
                label="Clearance pending decisions"
                count={exceptions.clearancePending}
              />
              <ManagerInboxRow
                to="/store/rider-variances"
                label="Variance decisions"
                count={varianceDecisionCount}
              />
              <ManagerInboxRow
                to="/store/payroll"
                label="Payroll deduction tags"
                count={payrollTaggedCount}
              />
            </div>
          </section>

          <section className="xl:col-span-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Operations Monitor
              </h2>
              <span className="text-xs text-slate-500">Live queues and control lanes.</span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className={sotCardClass({ className: "border-sky-200 bg-sky-50/40" })}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-sky-800">
                      Dispatch Queue
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      Orders waiting dispatch
                    </div>
                  </div>
                  <div className="text-xl font-semibold text-sky-900">
                    {dispatch.forDispatchOrders}
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  <SoTDataRow label="For dispatch" value={dispatch.forDispatchOrders} />
                  <SoTDataRow
                    label="Staged, not dispatched"
                    value={dispatch.stagedOrders}
                  />
                </div>
                {me.role === "STORE_MANAGER" ? (
                  <Link
                    to="/pad-order"
                    className="mt-3 inline-flex items-center text-sm font-medium text-indigo-800 transition-colors duration-150 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Open order pad (SoT UI) →
                  </Link>
                ) : null}
                <Link
                  to="/store/dispatch"
                  className="mt-3 inline-flex items-center text-sm font-medium text-sky-800 transition-colors duration-150 hover:text-sky-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Open dispatch board →
                </Link>
              </div>

              <div className={sotCardClass({ className: "border-indigo-200 bg-indigo-50/40" })}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-indigo-800">
                      Runs Pipeline
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      Planned, active, checked-in
                    </div>
                  </div>
                  <div className="text-xl font-semibold text-indigo-900">
                    {runs.planned + runs.dispatched + runs.checkedIn}
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  <SoTDataRow label="Planned" value={runs.planned} />
                  <SoTDataRow label="Dispatched" value={runs.dispatched} />
                  <SoTDataRow label="Checked-in" value={runs.checkedIn} />
                </div>
                <Link
                  to="/runs"
                  className="mt-3 inline-flex items-center text-sm font-medium text-indigo-800 transition-colors duration-150 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Open runs board →
                </Link>
              </div>

              <div
                className={sotCardClass({
                  className: "border-emerald-200 bg-emerald-50/40 md:col-span-2",
                })}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                      Cash Position
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-900">
                      Drawer totals and cash movement
                    </div>
                  </div>
                  <span className="rounded-xl border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800">
                    TODAY
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <SoTDataRow label="Open shifts" value={cash.openShifts} />
                  <SoTDataRow
                    label="Expected drawers"
                    value={peso(cash.expectedDrawerTotal)}
                  />
                  <SoTDataRow
                    label="Cash sales today"
                    value={peso(cash.cashSalesToday)}
                  />
                  <SoTDataRow
                    label="Drawer movements"
                    value={peso(cash.drawerTxnsToday)}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    to="/store/cashier-shifts"
                    className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Cashier shifts →
                  </Link>
                  <Link
                    to="/store/cashier-variances"
                    className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Shift variances <MiniBadge n={cash.openShiftVariances} />
                  </Link>
                </div>
              </div>

              <div
                className={sotCardClass({
                  className: "border-amber-200 bg-amber-50/70 md:col-span-2",
                })}
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
                        Workforce Ops
                      </div>
                      <div className="mt-1 text-base font-semibold text-slate-900">
                        Coverage, attendance, and schedule readiness
                      </div>
                      <p className="mt-1 max-w-2xl text-sm text-slate-600">
                        Daily workforce controls with live signals for attendance
                        review, planning backlog, and active suspensions.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/80 bg-white/90 px-3 py-1 text-xs font-semibold text-amber-800 shadow-sm">
                        Today
                      </span>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold shadow-sm ${workforceStatusToneClass}`}
                      >
                        {workforceStatusLabel}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <WorkforceMetricPill
                      label="Assignments live"
                      value={workforce.activeAssignments}
                      caption={`${workforce.activeTemplates} active template${
                        workforce.activeTemplates === 1 ? "" : "s"
                      } backing current coverage`}
                    />
                    <WorkforceMetricPill
                      label="Scheduled today"
                      value={workforce.scheduledToday}
                      caption="Workers loaded into today's attendance lane"
                    />
                    <WorkforceMetricPill
                      label="Attendance pending"
                      value={attendancePendingToday}
                      caption={`${workforce.attendanceRecordedToday} recorded so far today`}
                    />
                    <WorkforceMetricPill
                      label="Active suspensions"
                      value={workforce.activeSuspensionsToday}
                      caption="Suspension overlays affecting today's roster"
                    />
                  </div>

                  <div className="grid gap-3 xl:grid-cols-5">
                    <Link
                      to="/store/workforce/attendance-review"
                      className="group rounded-2xl border border-amber-300 bg-white/95 p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-amber-400 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 xl:col-span-3"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                            Today's lane
                          </div>
                          <div className="mt-1 text-base font-semibold text-slate-900">
                            Attendance review
                          </div>
                          <p className="mt-1 max-w-xl text-sm leading-5 text-slate-600">
                            {attendanceSummary}
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            attendancePendingToday > 0
                              ? "border-amber-300 bg-amber-100 text-amber-900"
                              : "border-emerald-300 bg-emerald-50 text-emerald-900"
                          }`}
                        >
                          {attendancePendingToday > 0 ? "Needs review" : "Ready"}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <SoTDataRow
                          label="Scheduled today"
                          value={workforce.scheduledToday}
                          className="border-amber-100 bg-amber-50/70"
                        />
                        <SoTDataRow
                          label="Recorded today"
                          value={workforce.attendanceRecordedToday}
                          className="border-amber-100 bg-amber-50/70"
                        />
                      </div>
                      <div className="mt-4 inline-flex items-center text-sm font-semibold text-amber-900">
                        Open attendance review →
                      </div>
                    </Link>

                    <div className="grid gap-3 sm:grid-cols-2 xl:col-span-2 xl:grid-cols-1">
                      <WorkforceActionLink
                        to="/store/workforce/schedule-planner"
                        eyebrow="Planning"
                        title="Schedule planner"
                        description={workforcePlannerSummary}
                        accent={
                          workforce.draftSchedulesNext14Days > 0
                            ? `${workforce.draftSchedulesNext14Days} draft${
                                workforce.draftSchedulesNext14Days === 1 ? "" : "s"
                              }`
                            : "Up to date"
                        }
                        cta="Open schedule planner →"
                      />
                      <WorkforceActionLink
                        to="/store/workforce/schedule-templates"
                        eyebrow="Template library"
                        title="Schedule templates"
                        description={workforceTemplateSummary}
                        accent={
                          workforce.activeTemplates > 0
                            ? `${workforce.activeTemplates} active`
                            : "No live templates"
                        }
                        cta="Open schedule templates →"
                      />
                      <WorkforceActionLink
                        to="/store/workforce/suspension-records"
                        eyebrow="Controls"
                        title="Suspension records"
                        description={workforceSuspensionSummary}
                        accent={
                          workforce.activeSuspensionsToday > 0
                            ? `${workforce.activeSuspensionsToday} active`
                            : "Clear today"
                        }
                        cta="Open suspension records →"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function WorkforceMetricPill({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-amber-200/80 bg-white/85 px-3 py-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold leading-none text-slate-900">
        {value}
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">{caption}</p>
    </div>
  );
}

function WorkforceActionLink({
  to,
  eyebrow,
  title,
  description,
  accent,
  cta,
}: {
  to: string;
  eyebrow: string;
  title: string;
  description: string;
  accent: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-amber-200 bg-white/90 p-3.5 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-amber-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            {eyebrow}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{title}</div>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
          {accent}
        </span>
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-600">{description}</p>
      <div className="mt-3 text-sm font-medium text-amber-900">{cta}</div>
    </Link>
  );
}

function ManagerInboxRow({
  to,
  label,
  count,
}: {
  to: string;
  label: string;
  count: number;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-white px-3 py-2 transition-colors duration-150 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
    >
      <div>
        <div className="text-sm font-medium text-slate-800">{label}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <MiniBadge n={count} />
        <span className="text-xs font-medium text-indigo-700">Open →</span>
      </div>
    </Link>
  );
}
