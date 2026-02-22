// app/routes/cashier._index.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
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
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireUser(request);

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

  const [shift, openChargeItems] = await Promise.all([
    getActiveShift(request),
    // Cashier Charges = manager approved + charged to cashier, waiting cashier acknowledgement
    db.cashierShiftVariance.count({
      where: {
        resolution: "CHARGE_CASHIER" as any,
        status: "MANAGER_APPROVED" as any,
        shift: { cashierId: me.userId },
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
  });
}

export default function CashierDashboardPage() {
  const { me, activeShift, userInfo, alerts } = useLoaderData<LoaderData>();

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

  // If no shift OR shift locked, route to shift console with proper flags.
  const guardLink = (to: string) => {
    if (!hasShift) {
      return `/cashier/shift?open=1&next=${encodeURIComponent(to)}`;
    }
    if (!shiftWritable) {
      return `/cashier/shift?locked=1&next=${encodeURIComponent(to)}`;
    }
    return to;
  };

  const disabledCard = "opacity-70 select-none grayscale";
  const disabledHint = "mt-2 text-xs font-medium text-amber-700";

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
              {/* 🔔 Cashier Charges badge (does NOT require active shift) */}
              <Link
                to="/cashier/charges"
                className={
                  "relative inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 " +
                  (alerts.openChargeItems > 0
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-slate-200 bg-white text-slate-700")
                }
                title={
                  alerts.openChargeItems > 0
                    ? `${alerts.openChargeItems} charge item(s) awaiting acknowledgement`
                    : "No pending charges"
                }
              >
                Charges
                {alerts.openChargeItems > 0 ? (
                  <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-xl bg-rose-600 px-2 py-0.5 text-xs font-semibold leading-none text-white">
                    {alerts.openChargeItems}
                  </span>
                ) : null}
              </Link>
              <span
                className={
                  "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium " +
                  (!hasShift
                    ? "border border-rose-200 bg-rose-50 text-rose-700"
                    : shiftLocked
                    ? "border border-amber-200 bg-amber-50 text-amber-800"
                    : "border border-emerald-200 bg-emerald-50 text-emerald-700")
                }
              >
                <span
                  className={
                    "h-1.5 w-1.5 rounded-full " +
                    (!hasShift
                      ? "bg-rose-500"
                      : shiftLocked
                      ? "bg-amber-500"
                      : "bg-emerald-500")
                  }
                />
                {!hasShift
                  ? "No active shift"
                  : shiftLocked
                  ? `LOCKED (${String(activeShift?.status ?? "UNKNOWN")})`
                  : "Shift OPEN"}
              </span>
              <Form method="post" action="/logout">
                <button
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
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
      <div className="mx-auto max-w-6xl space-y-5 px-5 py-5">
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
                to="/cashier/shift?open=1&next=/cashier"
                className="rounded-xl bg-amber-900 px-3 py-2 text-sm font-medium text-amber-50 hover:bg-amber-800"
              >
                Open Shift
              </Link>
            </div>
          </div>
        )}

        {/* Callout kung locked ang shift */}
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
                to={`/cashier/shift?locked=1&next=${encodeURIComponent(
                  "/cashier",
                )}`}
                className="rounded-xl bg-amber-900 px-3 py-2 text-sm font-medium text-amber-50 hover:bg-amber-800"
              >
                Go to Shift Console
              </Link>
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Shift Snapshot
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Shift State
              </div>
              <div className="mt-1 text-sm font-medium text-slate-900">
                {shiftStateLabel}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Writable shift is required for POS, AR, and remit tasks.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Pending Charges
              </div>
              <div
                className={
                  "mt-1 text-sm font-semibold " +
                  (alerts.openChargeItems > 0 ? "text-rose-700" : "text-slate-900")
                }
              >
                {alerts.openChargeItems}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Manager-tagged variance acknowledgements waiting action.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Active Shift ID
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {hasShift ? `#${activeShift?.id}` : "—"}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {openedAt ? `Opened ${openedAt}` : "Waiting for open shift."}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Access Route
              </div>
              <div className="mt-1 text-sm font-medium text-slate-900">
                {hasShift && !shiftLocked ? "Direct task access" : "Guarded via Shift Console"}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Links auto-route to shift console when shift is missing/locked.
              </p>
            </div>
          </div>
        </section>

        {/* Primary actions */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Operations
            </h2>
            <span className="text-xs text-slate-500">
              Execute cashier tasks in this order: charges, POS, AR, delivery remit.
            </span>
          </div>
          <h3 className="sr-only">
            Cashier Actions
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Cashier Charges (manager-charged items) — no shift required */}
            <Link
              to="/cashier/charges"
              className={
                "group flex h-full flex-col justify-between rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md " +
                (alerts.openChargeItems > 0
                  ? "border-rose-200 bg-rose-50 hover:border-rose-300"
                  : "border-slate-200 bg-white hover:border-slate-300")
              }
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Charges
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Manager-Charged Variances
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Review items charged to you after shift close audit, add note,
                  then acknowledge & close.
                </p>
                {alerts.openChargeItems > 0 ? (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm font-medium text-rose-700 ring-1 ring-rose-200">
                    Pending: {alerts.openChargeItems}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-rose-700/70">
                    No pending charge items
                  </div>
                )}
              </div>
              <div className="mt-3 text-sm font-medium text-slate-700 group-hover:text-slate-900">
                Open charges →
              </div>
            </Link>
            {/* Walk-in POS */}
            <Link
              to={guardLink("/cashier/pos")}
              className={
                "group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md " +
                (!hasShift ? disabledCard : "")
              }
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Walk-In
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  New Sale (POS)
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Scan items, collect payment, and print receipt for in-store
                  customers.
                </p>
                {!hasShift ? (
                  <div className={disabledHint}>
                    Requires open shift → click to open
                  </div>
                ) : null}
              </div>
              <div className="mt-3 text-sm font-medium text-slate-700 group-hover:text-slate-900">
                Go to POS →
              </div>
            </Link>

            {/* AR / Customer balance collection */}
            <Link
              to={guardLink("/ar")}
              className={
                "group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md " +
                (!hasShift ? disabledCard : "")
              }
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Accounts Receivable
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Collect on AR
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Find a customer, view their ledger, and record AR payments.
                </p>
                {!hasShift ? (
                  <div className={disabledHint}>
                    Requires open shift → click to open
                  </div>
                ) : null}
              </div>
              <div className="mt-3 text-sm font-medium text-slate-700 group-hover:text-slate-900">
                Open AR list →
              </div>
            </Link>
            {/* Delivery remit console (per delivery run) */}
            <Link
              to={guardLink("/cashier/delivery")}
              className={
                "group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md " +
                (!hasShift ? disabledCard : "")
              }
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Delivery Remit
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Rider Remittance
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Record rider remit per delivery run and review roadside sales.
                </p>
                {!hasShift ? (
                  <div className={disabledHint}>
                    Requires open shift → click to open
                  </div>
                ) : null}
              </div>
              <div className="mt-3 text-sm font-medium text-slate-700 group-hover:text-slate-900">
                Open delivery remit console →
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
                to="/cashier/shift?next=/cashier"
                className="text-sm font-medium text-slate-700 hover:text-slate-900"
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
                <span className="font-mono">
                  {activeShift?.branchId ?? "—"}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-900">
                Shift History
              </h2>
              <Link
                to="/cashier/shift-history"
                className="text-sm font-medium text-slate-600 hover:text-slate-800"
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
