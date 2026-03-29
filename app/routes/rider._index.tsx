/* app/routes/rider._index.tsx */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { EmployeeRole } from "@prisma/client";
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
  user: {
    id: number;
    role: string;
    name: string;
    alias: string | null;
    email: string | null;
  };
  pendingVarianceCount: number;
  workforce: WorkerDashboardSummary;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { getWorkerDashboardSummary } = await import(
    "~/services/worker-dashboard-summary.server"
  );
  // Only EMPLOYEE users can reach here, but we ALSO enforce Employee.role === RIDER below.
  const me = await requireRole(request, ["EMPLOYEE"]);

  // Load auth user + linked employee to show real name on header
  const userRow = await db.user.findUnique({
    where: { id: me.userId },
    include: { employee: true },
  });

  if (!userRow) {
    throw new Response("User not found", { status: 404 });
  }

  // ✅ Hard gate: must be linked to an Employee row AND must be a RIDER employee.
  // Prevents STAFF/other EMPLOYEE accounts from opening the Rider console.
  const emp = userRow.employee;
  if (!emp) {
    throw new Response("Employee profile not linked", { status: 403 });
  }
  if (emp.role !== EmployeeRole.RIDER) {
    throw new Response("Rider access only", { status: 403 });
  }

  const fullName: string =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : userRow.email ?? "";
  const alias: string | null = emp?.alias ?? null;

  const [pendingVarianceCount, workforce] = await Promise.all([
    db.riderRunVariance.count({
      where: {
        riderId: emp.id,
        status: "MANAGER_APPROVED",
        resolution: "CHARGE_RIDER",
        riderAcceptedAt: null,
      },
    }),
    getWorkerDashboardSummary({
      employeeId: emp.id,
      chargeScope: {
        lane: "RIDER",
        employeeId: emp.id,
      },
    }),
  ]);

  return json<LoaderData>({
    user: {
      id: me.userId,
      role: me.role,
      name: fullName,
      alias,
      email: userRow.email ?? null,
    },
    pendingVarianceCount,
    workforce,
  });
}

export default function RiderDashboard() {
  const { user, workforce, pendingVarianceCount } = useLoaderData<LoaderData>();
  const identityLabel = user.alias ? `${user.alias} (${user.name})` : user.name;
  const todayStatusTone =
    workforce.todayStatus.tone === "success" ||
    workforce.todayStatus.tone === "danger" ||
    workforce.todayStatus.tone === "warning"
      ? workforce.todayStatus.tone
      : "default";
  const chargeTone =
    workforce.charges.outstandingAmount > 0 || pendingVarianceCount > 0
      ? "danger"
      : "default";
  const nextShiftLabel = workforce.nextShift.label ?? "No schedule";
  const [nextShiftPrimary, ...nextShiftRemainder] = nextShiftLabel.split(" - ");
  const nextShiftSecondary =
    nextShiftRemainder.length > 0 ? nextShiftRemainder.join(" - ") : null;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTRoleShellHeader
        title="Rider Console"
        identityLine={`${identityLabel} · RIDER · ${user.email ?? "No email"}`}
        sticky
        actions={
          <>
            <SoTStatusPill tone={workforce.todayStatus.tone}>
              {workforce.todayStatus.label}
            </SoTStatusPill>
            <Link to="/account/security">
              <SoTButton type="button" variant="secondary">
                Account
              </SoTButton>
            </Link>
            <Form method="post" action="/logout">
              <SoTButton type="submit" variant="secondary">
                Logout
              </SoTButton>
            </Form>
          </>
        }
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-5">
        <SoTDashboardTopGrid>
          <div className="xl:col-span-4">
            <SoTDashboardPanel
              title="Do Now"
              subtitle="Current rider priorities"
              badge={workforce.todayStatus.label}
              tone={todayStatusTone}
            >
              <SoTDashboardQueueList>
                <SoTDashboardQueueRow
                  to="/runs?mine=1"
                  label="Open My Runs"
                  value={workforce.todayStatus.label}
                  actionLabel="Open"
                  tone={todayStatusTone}
                />
                <SoTDashboardQueueRow
                  to="/rider/variances"
                  label="Pending Acceptance"
                  value={`${pendingVarianceCount} pending`}
                  actionLabel="Review"
                  tone={pendingVarianceCount > 0 ? "danger" : "default"}
                />
                <SoTDashboardQueueRow
                  to="/rider/variances"
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
              title="My Runs"
              subtitle="Assigned runs and check-in"
              tone={todayStatusTone}
            >
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <SoTDataRow label="Pending acceptance" value={pendingVarianceCount} />
                  <SoTDataRow
                    label="Outstanding charges"
                    value={`₱${workforce.charges.outstandingAmount.toFixed(2)}`}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/runs?mine=1"
                    className="inline-flex h-9 items-center rounded-xl bg-emerald-600 px-3 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Open My Runs
                  </Link>
                  <Link
                    to="/rider/variances"
                    className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Review Pending Acceptance
                  </Link>
                </div>
              </div>
            </SoTDashboardPanel>
          </div>

          <div className="xl:col-span-3">
            <SoTDashboardPanel
              title="Signals"
              subtitle="Today"
              badge="Today"
            >
              <SoTDashboardSignalGrid className="xl:grid-cols-1">
                <SoTDashboardSignal
                  label="Schedule"
                  value={nextShiftPrimary}
                  meta={nextShiftSecondary}
                  tone="success"
                />
                <SoTDashboardSignal
                  label="Payroll"
                  value={workforce.payroll.latestLabel ?? "No payroll yet"}
                  meta={
                    workforce.payroll.latestNetPay == null
                      ? undefined
                      : `Net ₱${workforce.payroll.latestNetPay.toFixed(2)}`
                  }
                />
                <SoTDashboardSignal
                  label="Attendance"
                  value={workforce.attendance.absentCountThisMonth}
                  meta={`${workforce.attendance.lateCountThisMonth} late · ${workforce.attendance.suspensionCountThisMonth} suspension`}
                />
              </SoTDashboardSignalGrid>
            </SoTDashboardPanel>
          </div>
        </SoTDashboardTopGrid>

        <SoTDashboardSection
          title="Quick Actions"
          subtitle="Runs and tools"
        >
          <SoTDashboardActionGrid>
            <SoTDashboardActionTile
              to="/runs?mine=1"
              title="My Runs"
              detail="Assigned runs"
              actionLabel="Open My Runs"
              tone="success"
            />
            <SoTDashboardActionTile
              to="/rider/variances"
              title="Pending Acceptance"
              detail="Manager-approved variance decisions"
              actionLabel="Review Pending Acceptance"
              badge={`${pendingVarianceCount} pending`}
              tone={pendingVarianceCount > 0 ? "danger" : "default"}
            />
            <SoTDashboardActionTile
              to="/pad-order"
              title="Order Pad"
              detail="Walk-in and pad-order encoding"
              actionLabel="Open Order Pad"
              tone="info"
            />
            <SoTDashboardActionTile
              to="/customers"
              title="Customers"
              detail="Customer lookup"
              actionLabel="Open Customers"
            />
          </SoTDashboardActionGrid>
        </SoTDashboardSection>

        <SoTDashboardSection
          title="Reference"
          subtitle="Attendance and payroll"
        >
          <div className="grid gap-3 md:grid-cols-2">
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
              badge={`${pendingVarianceCount} pending`}
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
