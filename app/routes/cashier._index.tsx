// app/routes/cashier._index.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import {
  getActiveShift,
  homePathFor,
  requireUser,
  type SessionUser,
} from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type LoaderData = {
  me: SessionUser;
  activeShift: {
    id: number;
    branchId: number;
    openedAt: string;
    closingTotal: number | null;
  } | null;
  userInfo: {
    name: string;
    alias: string | null;
    email: string;
  };
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireUser(request);

  // Kung hindi cashier, wag dito — ibalik sa sariling home
  if (me.role !== "CASHIER") {
    throw json(
      { ok: false, error: "Cashier dashboard is for cashiers only." },
      {
        status: 302,
        headers: { Location: homePathFor(me.role) },
      }
    );
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

  const shift = await getActiveShift(request);
  const activeShift = shift
    ? {
        id: shift.id,
        branchId: shift.branchId,
        openedAt: shift.openedAt.toISOString(),
        closingTotal:
          shift.closingTotal == null ? null : Number(shift.closingTotal),
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
  });
}

export default function CashierDashboardPage() {
  const { me, activeShift, userInfo } = useLoaderData<LoaderData>();

  const hasShift = !!activeShift;
  const openedAt = activeShift
    ? new Date(activeShift.openedAt).toLocaleString()
    : null;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Cashier Dashboard
            </h1>
            <p className="text-xs text-slate-500">
              Logged in as{" "}
              <span className="font-medium text-slate-700">
                {userInfo.alias
                  ? `${userInfo.alias} (${userInfo.name})`
                  : userInfo.name}
              </span>
              {" · "}
              <span className="uppercase tracking-wide">{me.role}</span>
              {" · "}
              <span>{userInfo.email}</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span
                className={
                  "inline-flex items-center gap-1 rounded-full px-2 py-1 " +
                  (hasShift
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border border-rose-200 bg-rose-50 text-rose-700")
                }
              >
                <span
                  className={
                    "h-1.5 w-1.5 rounded-full " +
                    (hasShift ? "bg-emerald-500" : "bg-rose-500")
                  }
                />
                {hasShift ? "Shift OPEN" : "No active shift"}
              </span>
              <Form method="post" action="/logout">
                <button
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                  title="Sign out"
                >
                  Logout
                </button>
              </Form>
            </div>
            {hasShift && openedAt && (
              <span className="text-slate-500">
                Shift #{activeShift?.id} • Opened {openedAt}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-5 py-6 space-y-6">
        {/* Callout kung walang shift */}
        {!hasShift && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">No active cashier shift</div>
                <div className="text-xs">
                  Open a shift first before taking payments or recording remit.
                </div>
              </div>
              <Link
                to="/cashier/shift?open=1"
                className="rounded-xl bg-amber-900 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-800"
              >
                Open Shift
              </Link>
            </div>
          </div>
        )}

        {/* Primary actions */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cashier Actions
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Walk-in POS */}
            <Link
              to="/cashier/pos"
              className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
                  Walk-In
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  New Sale (POS)
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Scan items, collect payment, and print receipt for in-store
                  customers.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-indigo-600 group-hover:text-indigo-700">
                Go to POS →
              </div>
            </Link>

            {/* AR / Customer balance collection */}
            <Link
              to="/ar"
              className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-500">
                  Accounts Receivable
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Collect on AR
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Find a customer, view their ledger, and record AR payments.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-emerald-600 group-hover:text-emerald-700">
                Open AR list →
              </div>
            </Link>
            {/* Delivery remit console */}
            <Link
              to="/remit"
              className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-sky-500">
                  Delivery Remit
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Rider Remittance
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Record rider remit for dispatched delivery runs and review
                  roadside sales.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-sky-600 group-hover:text-sky-700">
                Open remit console →
              </div>
            </Link>
          </div>
        </section>

        {/* Shift & drawer tools */}
        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-900">
                Shift Console
              </h2>
              <Link
                to="/cashier/shift"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                Open →
              </Link>
            </div>
            <p className="text-xs text-slate-500">
              Open/close shift, record drawer deposits/withdrawals, and see
              running drawer balance.
            </p>
            {hasShift && (
              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                Active shift: #{activeShift?.id} • Branch{" "}
                <span className="font-mono">{activeShift?.branchId}</span>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-900">
                Shift History
              </h2>
              <Link
                to="/cashier/shifts"
                className="text-xs font-medium text-slate-600 hover:text-slate-800"
              >
                View all →
              </Link>
            </div>
            <p className="text-xs text-slate-500">
              Review previous shifts: totals collected, drawer movements, and
              variances.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
