/* app/routes/rider._index.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type LoaderData = {
  user: {
    id: number;
    role: string;
    name: string;
    alias: string | null;
    email: string;
  };
  hr: {
    nextShiftLabel: string | null;
    paydayLabel: string | null;
    absentCountThisMonth: number;
    outstandingCharges: number;
  };
};

export async function loader({ request }: LoaderFunctionArgs) {
  // Only RIDER can land here (Rider+Seller combo user)
  const me = await requireRole(request, ["EMPLOYEE"]);

  // Load auth user + linked employee to show real name on header
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

  // TODO: Wire these to real tables in the future
  const hr: LoaderData["hr"] = {
    nextShiftLabel: "Tomorrow, 8:00 AM – Asingan Branch", // placeholder
    paydayLabel: "15 & 30 of the month", // placeholder
    absentCountThisMonth: 0, // placeholder
    outstandingCharges: 0, // placeholder, e.g. 350.0
  };

  return json<LoaderData>({
    user: {
      id: me.userId,
      role: me.role,
      name: fullName,
      alias,
      email: userRow.email ?? "",
    },
    hr,
  });
}

export default function RiderDashboard() {
  const { user, hr } = useLoaderData<LoaderData>();

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
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
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-100">
              On-duty
            </span>
            <form method="post" action="/logout">
              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                ⏏ Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-4 pb-8">
        {/* Top: Seller & Rider tools */}
        <section className="grid gap-4 md:grid-cols-2">
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

            <div className="mt-4 grid gap-3">
              {/* New Walk-in / Pad-Order */}
              <Link
                to="/pad-order"
                className="flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
              >
                <span>➕ New Walk-in / Pad-order</span>
                <span className="text-[11px] font-normal text-indigo-700">
                  open pad-order board
                </span>
              </Link>

              {/* My Orders – later pwede mo i-filter by createdBy = user.id */}
              <Link
                to="/orders"
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
              >
                <span>📋 My Orders</span>
                <span className="text-[11px] text-slate-500">
                  recent orders I created
                </span>
              </Link>

              {/* Customer search – adjust route kung iba actual path mo */}
              <Link
                to="/customers"
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 hover:bg-slate-100"
              >
                <span>👥 Customers</span>
                <span className="text-[11px] text-slate-500">
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

            <div className="mt-4 grid gap-3">
              {/* My Runs – filtered sa riderId (via /runs?mine=1) */}
              <Link
                to="/runs?mine=1"
                className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
              >
                <span>🚚 My Delivery Runs (Check-in &amp; Summary)</span>
                <span className="text-[11px] font-normal text-emerald-700">
                  open run list, then tap <strong>Open</strong> per run
                </span>
              </Link>

              <div className="mt-1 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                💸 Paalala: cash remit at final posting ay ginagawa ng{" "}
                <span className="font-semibold">Store Manager / Cashier</span>.
                Ikaw muna ang mag-check-in ng{" "}
                <span className="font-semibold">Sold / Returned</span> per run
                bago magpa-remit.
              </div>
            </div>
          </div>
        </section>

        {/* WORK & HR PANEL */}
        <section className="grid gap-4 md:grid-cols-3">
          {/* Schedule */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Work Schedule
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {hr.nextShiftLabel ?? "No schedule loaded"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Tingnan ang full schedule, rest day, at assigned branch.
            </p>
            <Link
              to="/me/schedule"
              className="mt-3 inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              🗓 View full schedule
            </Link>
          </div>

          {/* Absences & attendance */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Attendance &amp; Absences
            </h2>
            <p className="mt-1 text-3xl font-semibold text-slate-900">
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
              className="mt-3 inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              ✅ Attendance history
            </Link>
          </div>

          {/* Payday & charges */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Payday &amp; Charges
            </h2>
            <p className="mt-1 text-xs text-slate-500">Next payday</p>
            <p className="text-sm font-medium text-slate-900">
              {hr.paydayLabel ?? "Not set"}
            </p>

            <div className="mt-3">
              <p className="text-xs text-slate-500">Outstanding charges</p>
              <p className="text-2xl font-semibold text-slate-900">
                ₱{hr.outstandingCharges.toFixed(2)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Pwedeng kasama dito ang shortage, penalties, o iba pang
                deductions na naka-assign sa account mo.
              </p>
            </div>

            <div className="mt-3 flex gap-2">
              <Link
                to="/me/payroll"
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                📄 Payslip / payroll
              </Link>
              <Link
                to="/me/charges"
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
              >
                💳 View charges
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
