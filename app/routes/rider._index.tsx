/* app/routes/rider._index.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { EmployeeRole, RiderChargeStatus } from "@prisma/client";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTSectionHeader } from "~/components/ui/SoTSectionHeader";
import { SoTStatusPill } from "~/components/ui/SoTStatusPill";

type LoaderData = {
  user: {
    id: number;
    role: string;
    name: string;
    alias: string | null;
    email: string | null;
  };
  pendingVarianceCount: number;
  hr: {
    nextShiftLabel: string | null;
    paydayLabel: string | null;
    absentCountThisMonth: number;
    outstandingCharges: number;
  };
};

export async function loader({ request }: LoaderFunctionArgs) {
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
  if ((emp.role as EmployeeRole) !== "RIDER") {
    throw new Response("Rider access only", { status: 403 });
  }

  const fullName: string =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : userRow.email ?? "";
  const alias: string | null = emp?.alias ?? null;

  // Variances waiting for rider acceptance (only when manager decided CHARGE_RIDER)
  const pendingVarianceCount = await db.riderRunVariance.count({
    where: {
      riderId: emp.id,
      status: "MANAGER_APPROVED",
      resolution: "CHARGE_RIDER",
      riderAcceptedAt: null,
    },
  });

  // OPTION B: outstanding rider charges = sum(unpaid balances)
  // RiderChargeStatus: OPEN | PARTIALLY_SETTLED | SETTLED | WAIVED
  const openCharges = await db.riderCharge.findMany({
    where: {
      riderId: emp.id,
      status: {
        in: [RiderChargeStatus.OPEN, RiderChargeStatus.PARTIALLY_SETTLED],
      },
    },
    select: {
      amount: true,
      payments: { select: { amount: true } },
    },
  });
  const outstandingCharges = openCharges.reduce((sum, ch) => {
    const amt = Number(ch.amount ?? 0);
    const paid = (ch.payments ?? []).reduce(
      (s: number, p: any) => s + Number(p.amount ?? 0),
      0
    );
    const bal = Math.max(0, amt - paid);
    return sum + bal;
  }, 0);

  // TODO: Wire these to real tables in the future
  const hr: LoaderData["hr"] = {
    nextShiftLabel: "Tomorrow, 8:00 AM – Asingan Branch", // placeholder
    paydayLabel: "15 & 30 of the month", // placeholder
    absentCountThisMonth: 0, // placeholder
    outstandingCharges, // ✅ real computed
  };

  return json<LoaderData>({
    user: {
      id: me.userId,
      role: me.role,
      name: fullName,
      alias,
      email: userRow.email ?? null,
    },
    pendingVarianceCount,
    hr,
  });
}

export default function RiderDashboard() {
  const { user, hr, pendingVarianceCount } = useLoaderData<LoaderData>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Rider &amp; Seller Console
            </h1>
            <p className="text-xs text-slate-500">
              Logged in as{" "}
              <span className="font-medium text-slate-800">
                {user.alias ? `${user.alias} (${user.name})` : user.name}
              </span>
              {" · "}
              <span className="uppercase tracking-wide">{user.role}</span>
              {" · "}
              <span>{user.email}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <SoTStatusPill tone="success">On-duty</SoTStatusPill>
            <form method="post" action="/logout">
              <SoTButton type="submit" variant="secondary">
                Logout
              </SoTButton>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-5">
        <section>
          <SoTSectionHeader title="Operations Snapshot" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SoTCard compact title="Pending Accept">
              <div className="text-sm font-semibold text-slate-900">
                {pendingVarianceCount}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Items waiting your acceptance from manager variance decisions.
              </p>
            </SoTCard>

            <SoTCard
              compact
              title="Outstanding Charges"
              tone={hr.outstandingCharges > 0 ? "danger" : "default"}
            >
              <div
                className={
                  "text-sm font-semibold " +
                  (hr.outstandingCharges > 0 ? "text-rose-700" : "text-slate-900")
                }
              >
                ₱{hr.outstandingCharges.toFixed(2)}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Includes shortage or penalties currently assigned to your account.
              </p>
            </SoTCard>

            <SoTCard compact title="Next Shift" tone="success">
              <div className="text-sm font-medium text-slate-900">
                {hr.nextShiftLabel ?? "No schedule loaded"}
              </div>
              <p className="mt-1 text-xs text-emerald-900/80">
                Check complete schedule for branch and shift-hour updates.
              </p>
            </SoTCard>

            <SoTCard compact title="Payday">
              <div className="text-sm font-medium text-slate-900">
                {hr.paydayLabel ?? "Not set"}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Payroll and charge deductions are reflected during payout cycle.
              </p>
            </SoTCard>
          </div>
        </section>

        {/* Top: Seller & Rider tools */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Operations
            </h2>
            <span className="text-xs text-slate-500">
              Seller tasks and rider tasks are separated for faster scanning.
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
          {/* SELLER TOOLS CARD */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Seller Tools
                </h2>
                <p className="text-xs text-slate-500">
                  Pang walk-in at pad-order encoding.
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-2">
              {/* New Walk-in / Pad-Order */}
              <Link
                to="/pad-order"
                className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
              >
                <span>New Walk-in / Pad-order</span>
                <span className="text-xs font-normal text-indigo-700">
                  open pad-order board
                </span>
              </Link>

              {/* My Orders – later pwede mo i-filter by createdBy = user.id */}
              <Link
                to="/orders"
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
              >
                <span>My Orders</span>
                <span className="text-xs text-slate-500">
                  recent orders I created
                </span>
              </Link>

              {/* Customer search – adjust route kung iba actual path mo */}
              <Link
                to="/customers"
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
              >
                <span>Customers</span>
                <span className="text-xs text-slate-500">
                  search &amp; select customer
                </span>
              </Link>
            </div>
          </div>

          {/* RIDER TOOLS CARD */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Rider Tools
                </h2>
                <p className="text-xs text-slate-500">
                  Pang delivery runs, check-in at returns.
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-2">
              {/* My Runs – filtered sa riderId (via /runs?mine=1) */}
              <Link
                to="/runs?mine=1"
                className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
              >
                <span>My Delivery Runs (Check-in &amp; Summary)</span>
                <span className="text-xs font-normal text-emerald-700">
                  open run list, then tap <strong>Open</strong> per run
                </span>
              </Link>
              {/* Pending variance accepts */}
              <Link
                to="/rider/variances"
                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm hover:bg-slate-100 ${
                  pendingVarianceCount > 0
                    ? "border-rose-200 bg-rose-50 font-medium text-rose-800"
                    : "border-slate-200 bg-slate-50 text-slate-800"
                }`}
              >
                <span>Variances (Pending Accept)</span>
                <span
                  className={`text-xs ${
                    pendingVarianceCount > 0
                      ? "text-rose-700"
                      : "text-slate-500"
                  }`}
                >
                  {pendingVarianceCount > 0
                    ? `${pendingVarianceCount} needs action`
                    : "no pending"}
                </span>
              </Link>
              <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                Paalala: cash remit at final posting ay ginagawa ng{" "}
                <span className="font-semibold">Store Manager / Cashier</span>.
                Ikaw muna ang mag-check-in ng{" "}
                <span className="font-semibold">Sold / Returned</span> per run
                bago magpa-remit.
              </div>
            </div>
          </div>
          </div>
        </section>

        {/* WORK & HR PANEL */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Schedule &amp; Payroll
            </h2>
            <span className="text-xs text-slate-500">
              Work schedule, attendance view, and payroll charges in one panel.
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
          {/* Schedule */}
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                  Work Schedule
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {hr.nextShiftLabel ?? "No schedule loaded"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-indigo-900/80">
              Tingnan ang full schedule, rest day, at assigned branch.
            </p>
            <Link
              to="/me/schedule"
              className="mt-3 inline-flex items-center rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100/40"
            >
              View full schedule
            </Link>
          </div>

          {/* Absences & attendance */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Attendance &amp; Absences
            </h2>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {hr.absentCountThisMonth}
              <span className="ml-1 text-xs font-normal text-slate-500">
                absent this month
              </span>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Kasama dito ang hindi naka-time-in / naka-log sa schedule.
            </p>
            <Link
              to="/me/attendance"
              className="mt-3 inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Attendance history
            </Link>
          </div>

          {/* Payday & charges */}
          <div
            className={
              "rounded-2xl border p-4 text-sm shadow-sm " +
              (hr.outstandingCharges > 0
                ? "border-rose-200 bg-rose-50"
                : "border-slate-200 bg-white")
            }
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Payday &amp; Charges
            </h2>
            <p className="mt-1 text-xs text-slate-500">Next payday</p>
            <p className="text-sm font-medium text-slate-900">
              {hr.paydayLabel ?? "Not set"}
            </p>

            <div className="mt-3">
              <p className="text-xs text-slate-500">Outstanding charges</p>
              <p className="text-xl font-semibold text-slate-900">
                ₱{hr.outstandingCharges.toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Pwedeng kasama dito ang shortage, penalties, o iba pang
                deductions na naka-assign sa account mo.
              </p>
            </div>

            <div className="mt-3 flex gap-2">
              <Link
                to="/me/payroll"
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Payslip / payroll
              </Link>
              <Link
                to="/me/charges"
                className={
                  "inline-flex flex-1 items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium " +
                  (hr.outstandingCharges > 0
                    ? "border-rose-200 bg-white text-rose-700 hover:bg-rose-100/40"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")
                }
              >
                View charges
              </Link>
            </div>
          </div>
          </div>
        </section>
      </div>
    </main>
  );
}
