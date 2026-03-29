// app/routes/cashier._index.tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import {
  getActiveShift,
  homePathFor,
  requireUser,
  type SessionUser,
} from "~/utils/auth.server";
import {
  CashierVarianceResolution,
  CashierVarianceStatus,
} from "@prisma/client";
import { db } from "~/utils/db.server";
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
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTDataRow } from "~/components/ui/SoTDataRow";
import { SoTRoleShellHeader } from "~/components/ui/SoTRoleShellHeader";
import { SoTStatusPill } from "~/components/ui/SoTStatusPill";
import type { WorkerDashboardSummary } from "~/services/worker-dashboard-summary.server";

type LoaderData = {
  me: SessionUser;
  activeShift: {
    id: number;
    branchId: number | null;
    openedAt: string;
    closingTotal: number | null;
    // IMPORTANT: runtime string (avoid Prisma enum in browser bundle)
    status: string;
  } | null;
  userInfo: {
    name: string;
    alias: string | null;
    email: string;
  };
  alerts: {
    openChargeItems: number; // manager-charged cashier variance items awaiting cashier ack
  };
  workforce: WorkerDashboardSummary;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireUser(request);
  const { getWorkerDashboardSummary } = await import(
    "~/services/worker-dashboard-summary.server"
  );

  // Kung hindi cashier, wag dito — ibalik sa sariling home
  if (me.role !== "CASHIER") {
    return redirect(homePathFor(me.role));
  }

  // Load auth user + linked employee para makita natin si Joy/Leo
  const userRow = await db.user.findUnique({
    where: { id: me.userId },
    include: { employee: true },
  });

  if (!userRow) {
    throw new Response("User not found", { status: 404 });
  }

  const emp = userRow.employee;
  const fullName: string =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : userRow.email ?? "";
  const alias: string | null = emp?.alias ?? null;

  const [shift, openChargeItems, workforce] = await Promise.all([
    getActiveShift(request),
    // Cashier Charges = manager approved + charged to cashier, waiting cashier acknowledgement
    db.cashierShiftVariance.count({
      where: {
        resolution: CashierVarianceResolution.CHARGE_CASHIER,
        status: CashierVarianceStatus.MANAGER_APPROVED,
        shift: { cashierId: me.userId },
      },
    }),
    getWorkerDashboardSummary({
      employeeId: emp?.id ?? null,
      chargeScope: {
        lane: "CASHIER",
        userId: me.userId,
      },
    }),
  ]);

  const activeShift = shift
    ? {
        id: shift.id,
        branchId: shift.branchId ?? null,
        openedAt: shift.openedAt.toISOString(),
        closingTotal:
          shift.closingTotal == null ? null : Number(shift.closingTotal),
        status: String(shift.status ?? ""),
      }
    : null;
  return json<LoaderData>({
    me,
    activeShift,
    userInfo: {
      name: fullName,
      alias,
      email: userRow.email ?? "",
    },
    alerts: { openChargeItems },
    workforce,
  });
}

export default function CashierDashboardPage() {
  const { me, activeShift, userInfo, alerts, workforce } =
    useLoaderData<LoaderData>();

  const hasShift = !!activeShift;
  const shiftWritable = Boolean(
    activeShift && String(activeShift.status) === "OPEN",
  );
  const shiftLocked = Boolean(activeShift && !shiftWritable);
  const openedAt = activeShift
    ? new Date(activeShift.openedAt).toLocaleString()
    : null;
  const shiftStateLabel = !hasShift
    ? "No active shift"
    : shiftLocked
      ? `Locked (${String(activeShift?.status ?? "UNKNOWN")})`
      : "Shift open";
  const scheduleSubtitle = workforce.hasLinkedEmployee
    ? workforce.nextShift.hint
    : "Schedule and payroll summary stay empty until this cashier account is linked to an employee profile.";

  // If no shift OR shift locked, route to shift console with proper flags.
  const guardLink = (to: string) => {
    if (!hasShift) {
      return `/cashier/shift?next=${encodeURIComponent(to)}`;
    }
    if (!shiftWritable) {
      return `/cashier/shift?next=${encodeURIComponent(to)}`;
    }
    return to;
  };
  const shiftTone = !hasShift ? "warning" : shiftLocked ? "warning" : "success";
  const chargeTone =
    alerts.openChargeItems > 0 || workforce.charges.outstandingAmount > 0
      ? "danger"
      : "default";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTRoleShellHeader
        title="Cashier Dashboard"
        identityLine={`${userInfo.alias ? `${userInfo.alias} (${userInfo.name})` : userInfo.name} · ${me.role} · ${userInfo.email}`}
        sticky
        actions={
          <>
            <SoTStatusPill
              tone={!hasShift ? "danger" : shiftLocked ? "warning" : "success"}
            >
              {!hasShift
                ? "No active shift"
                : shiftLocked
                ? `Locked (${String(activeShift?.status ?? "UNKNOWN")})`
                : "On-duty"}
            </SoTStatusPill>
            <Link to="/account/security">
              <SoTButton title="Account security" variant="secondary">
                Account
              </SoTButton>
            </Link>
            <Form method="post" action="/logout">
              <SoTButton title="Sign out" variant="secondary">
                Logout
              </SoTButton>
            </Form>
          </>
        }
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-5">
        {hasShift && shiftLocked && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">Shift is locked</div>
                <div className="text-xs">
                  This shift is not writable yet. Resolve it in Shift Console
                  (accept opening / submit count / manager close).
                </div>
              </div>
              <Link
                to={`/cashier/shift?next=${encodeURIComponent(
                  "/cashier",
                )}`}
                className="rounded-xl bg-amber-900 px-3 py-2 text-sm font-medium text-amber-50 hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Open Shift Console
              </Link>
            </div>
          </div>
        )}

        {!workforce.hasLinkedEmployee && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            <div className="font-medium">Employee profile link required</div>
            <div className="mt-1 text-xs">
              Workforce schedule and payroll widgets are read-only until this cashier
              login is linked to an employee profile.
            </div>
          </div>
        )}

        <SoTDashboardTopGrid>
          <div className="xl:col-span-4">
            <SoTDashboardPanel
              title="Priority"
              subtitle="Shift and charge status"
              badge={shiftStateLabel}
              tone={shiftTone}
            >
              <SoTDashboardQueueList>
                <SoTDashboardQueueRow
                  to="/cashier/shift?next=/cashier"
                  label="Shift Console"
                  value={
                    hasShift
                      ? openedAt
                        ? `Opened ${openedAt}`
                        : shiftStateLabel
                      : "Required before POS and remit"
                  }
                  actionLabel="Open"
                  tone={shiftTone}
                />
                <SoTDashboardQueueRow
                  to="/cashier/charges"
                  label="Pending Charges"
                  value={`${alerts.openChargeItems} pending`}
                  actionLabel="Open"
                  tone={alerts.openChargeItems > 0 ? "danger" : "default"}
                />
                <SoTDashboardQueueRow
                  to="/cashier/charges"
                  label="Outstanding Charges"
                  value={`₱${workforce.charges.outstandingAmount.toFixed(2)}`}
                  actionLabel="Open"
                  tone={chargeTone}
                />
              </SoTDashboardQueueList>
            </SoTDashboardPanel>
          </div>

          <div className="xl:col-span-5">
            <SoTDashboardPanel
              title="Shift Console"
              subtitle={
                !hasShift
                  ? "Start here before sales and remit"
                  : shiftLocked
                  ? "Resolve the locked shift state"
                  : "Drawer control and close workflow"
              }
              badge={!hasShift ? "Required" : shiftLocked ? "Locked" : "Open"}
              tone={shiftTone}
            >
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <SoTDataRow label="Shift state" value={shiftStateLabel} />
                  <SoTDataRow label="Opened" value={openedAt ?? "Waiting"} />
                  <SoTDataRow
                    label="Next shift"
                    value={workforce.nextShift.label ?? "No schedule"}
                  />
                  <SoTDataRow
                    label="Outstanding charges"
                    value={`₱${workforce.charges.outstandingAmount.toFixed(2)}`}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/cashier/shift?next=/cashier"
                    className="inline-flex h-9 items-center rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Open Shift Console
                  </Link>
                  <Link
                    to={guardLink("/cashier/pos")}
                    className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    New Sale
                  </Link>
                  <Link
                    to={guardLink("/cashier/delivery")}
                    className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Open Rider Remittance
                  </Link>
                  <Link
                    to={guardLink("/ar")}
                    className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Collect AR
                  </Link>
                </div>
              </div>
            </SoTDashboardPanel>
          </div>

          <div className="xl:col-span-3">
            <SoTDashboardPanel
              title="Signals"
              subtitle="Today"
              badge={workforce.hasLinkedEmployee ? "Linked" : "Link required"}
              tone={workforce.hasLinkedEmployee ? "default" : "warning"}
            >
              <SoTDashboardSignalGrid className="xl:grid-cols-1">
                <SoTDashboardSignal
                  label="Next Shift"
                  value={workforce.nextShift.label ?? "No schedule"}
                  meta={
                    workforce.hasLinkedEmployee
                      ? workforce.nextShift.hint
                      : "Link an employee profile"
                  }
                  tone={workforce.hasLinkedEmployee ? "success" : "warning"}
                />
                <SoTDashboardSignal
                  label="Attendance"
                  value={workforce.attendance.absentCountThisMonth}
                  meta={`${workforce.attendance.lateCountThisMonth} late · ${workforce.attendance.suspensionCountThisMonth} suspension`}
                />
                <SoTDashboardSignal
                  label="Payroll"
                  value={workforce.payroll.latestLabel ?? "No payroll yet"}
                  meta={
                    workforce.payroll.latestNetPay == null
                      ? workforce.payroll.policyLabel ?? "Waiting for finalized payroll"
                      : `Net ₱${workforce.payroll.latestNetPay.toFixed(2)}`
                  }
                />
              </SoTDashboardSignalGrid>
            </SoTDashboardPanel>
          </div>
        </SoTDashboardTopGrid>

        <SoTDashboardSection
          title="Quick Actions"
          subtitle="POS, remit, and ledger access"
        >
          <SoTDashboardActionGrid>
            <SoTDashboardActionTile
              to="/pad-order"
              title="Order Pad"
              detail="Walk-in and order encoding"
              actionLabel="Open Order Pad"
              tone="info"
            />
            <SoTDashboardActionTile
              to={guardLink("/cashier/pos")}
              title="New Sale"
              detail="Walk-in POS lane"
              actionLabel="Open POS"
              badge={!hasShift ? "Shift required" : undefined}
              tone={!hasShift ? "warning" : "success"}
            />
            <SoTDashboardActionTile
              to={guardLink("/cashier/delivery")}
              title="Rider Remittance"
              detail="Cashier remit workflow"
              actionLabel="Open Rider Remittance"
              badge={!hasShift ? "Shift required" : undefined}
              tone={!hasShift ? "warning" : "info"}
            />
            <SoTDashboardActionTile
              to={guardLink("/ar")}
              title="Collect AR"
              detail="Receivable collection lane"
              actionLabel="Open AR"
              badge={!hasShift ? "Shift required" : undefined}
              tone={!hasShift ? "warning" : "default"}
            />
            <SoTDashboardActionTile
              to="/cashier/shift-history"
              title="Shift History"
              detail="Past shifts and attendance"
              actionLabel="Open Shift History"
            />
            <SoTDashboardActionTile
              to="/cashier/charges"
              title="Charge Ledger"
              detail="Pending acknowledgements and deductions"
              actionLabel="Open Charge Ledger"
              badge={`${alerts.openChargeItems} pending`}
              tone={chargeTone}
            />
          </SoTDashboardActionGrid>
        </SoTDashboardSection>

        <SoTDashboardSection
          title="Reference"
          subtitle="Schedule, attendance, and payroll"
        >
          <div className="grid gap-3 md:grid-cols-3">
            <SoTDashboardPanel
              title="Work Schedule"
              subtitle={workforce.nextShift.label ?? "No schedule published"}
              badge={workforce.hasLinkedEmployee ? "Linked" : "Read only"}
              tone={workforce.hasLinkedEmployee ? "success" : "warning"}
            >
              <div className="space-y-3">
                <p className="text-sm text-slate-700">{scheduleSubtitle}</p>
                <Link
                  to="/cashier/shift-history"
                  className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Open Shift History
                </Link>
              </div>
            </SoTDashboardPanel>

            <SoTDashboardPanel title="Attendance" subtitle="This month">
              <div className="grid gap-2">
                <SoTDataRow
                  label="Absent"
                  value={workforce.attendance.absentCountThisMonth}
                />
                <SoTDataRow
                  label="Late"
                  value={workforce.attendance.lateCountThisMonth}
                />
                <SoTDataRow
                  label="Suspension"
                  value={workforce.attendance.suspensionCountThisMonth}
                />
              </div>
            </SoTDashboardPanel>

            <SoTDashboardPanel
              title="Payroll & Charges"
              subtitle={workforce.payroll.policyLabel ?? "Not configured"}
              badge={`${alerts.openChargeItems} pending`}
              tone={chargeTone}
            >
              <div className="grid gap-2">
                <SoTDataRow
                  label="Latest payroll"
                  value={workforce.payroll.latestLabel ?? "No finalized payroll yet"}
                />
                <SoTDataRow
                  label="Net pay"
                  value={
                    workforce.payroll.latestNetPay == null
                      ? "Waiting"
                      : `₱${workforce.payroll.latestNetPay.toFixed(2)}`
                  }
                />
                <SoTDataRow
                  label="Outstanding charges"
                  value={`₱${workforce.charges.outstandingAmount.toFixed(2)}`}
                />
              </div>
            </SoTDashboardPanel>
          </div>
        </SoTDashboardSection>
      </div>
    </main>
  );
}
