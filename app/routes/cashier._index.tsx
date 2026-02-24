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
import { CashierChargeStatus } from "@prisma/client";
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
  finance: {
    outstandingCharges: number;
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

  const [shift, openChargeItems, openCharges] = await Promise.all([
    getActiveShift(request),
    // Cashier Charges = manager approved + charged to cashier, waiting cashier acknowledgement
    db.cashierShiftVariance.count({
      where: {
        resolution: "CHARGE_CASHIER" as any,
        status: "MANAGER_APPROVED" as any,
        shift: { cashierId: me.userId },
      },
    }),
    db.cashierCharge.findMany({
      where: {
        cashierId: me.userId,
        status: {
          in: [CashierChargeStatus.OPEN, CashierChargeStatus.PARTIALLY_SETTLED],
        },
      },
      select: {
        amount: true,
        payments: { select: { amount: true } },
      },
    }),
  ]);
  const outstandingCharges = openCharges.reduce((sum, ch) => {
    const amt = Number(ch.amount ?? 0);
    const paid = (ch.payments ?? []).reduce(
      (s: number, p: any) => s + Number(p.amount ?? 0),
      0
    );
    return sum + Math.max(0, amt - paid);
  }, 0);

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
    finance: { outstandingCharges },
  });
}

export default function CashierDashboardPage() {
  const { me, activeShift, userInfo, alerts, finance } =
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
  const nextShiftLabel = hasShift
    ? `Active shift #${activeShift?.id}`
    : "No schedule loaded";
  const scheduleSubtitle = hasShift && openedAt
    ? `Opened ${openedAt}`
    : "Waiting for manager to open your shift.";
  const absentCountThisMonth = 0;
  const paydayLabel = "15 & 30 of the month";

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
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span
              className={
                "inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium " +
                (!hasShift
                  ? "border border-rose-200 bg-rose-50 text-rose-700"
                  : shiftLocked
                  ? "border border-amber-200 bg-amber-50 text-amber-800"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-700")
              }
            >
              {!hasShift
                ? "No active shift"
                : shiftLocked
                ? `Locked (${String(activeShift?.status ?? "UNKNOWN")})`
                : "On-duty"}
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
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-6xl space-y-5 px-5 py-5">
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
                to={`/cashier/shift?next=${encodeURIComponent(
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
            Operations Snapshot
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Shift State
              </div>
              <div className="mt-1 text-sm font-medium text-slate-900">
                {shiftStateLabel}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Writable shift required for POS, AR, and remit tasks.
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Next Shift
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                Tomorrow, 8:00 AM – Asingan Branch
              </div>
              <p className="mt-1 text-xs text-emerald-900/80">
                Check complete schedule for branch and shift-hour updates.
              </p>
            </div>

            <div
              className={
                "rounded-2xl border p-3 shadow-sm " +
                (alerts.openChargeItems > 0
                  ? "border-rose-200 bg-rose-50"
                  : "border-slate-200 bg-white")
              }
            >
              <div
                className={
                  "text-xs font-semibold uppercase tracking-wide " +
                  (alerts.openChargeItems > 0 ? "text-rose-700" : "text-slate-600")
                }
              >
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
              <p
                className={
                  "mt-1 text-xs " +
                  (alerts.openChargeItems > 0 ? "text-rose-900/80" : "text-slate-500")
                }
              >
                Manager-tagged acknowledgements waiting action.
              </p>
            </div>

            <div
              className={
                "rounded-2xl border p-3 shadow-sm " +
                (finance.outstandingCharges > 0
                  ? "border-rose-200 bg-rose-50"
                  : "border-slate-200 bg-white")
              }
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Outstanding Charges
              </div>
              <div
                className={
                  "mt-1 text-sm font-semibold " +
                  (finance.outstandingCharges > 0
                    ? "text-rose-700"
                    : "text-slate-900")
                }
              >
                ₱{finance.outstandingCharges.toFixed(2)}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Total remaining balance assigned to this cashier account.
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
              Cashier lane: POS, AR, and delivery remit.
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Sales &amp; Collection
              </div>
              <div className="mt-1 text-sm font-medium text-slate-900">
                POS and AR workflow
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Encode walk-in sales, collect receivables, and post rider remits in
                one lane.
              </p>

              <div className="mt-3 grid gap-2">
                <Link
                  to={guardLink("/cashier/pos")}
                  className={
                    "flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 " +
                    (!hasShift ? disabledCard : "")
                  }
                >
                  <span>New Sale (POS)</span>
                  <span className="text-xs font-normal text-emerald-700">
                    open POS →
                  </span>
                </Link>
                <Link
                  to={guardLink("/cashier/delivery")}
                  className={
                    "flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 " +
                    (!hasShift ? disabledCard : "")
                  }
                >
                  <span>Rider Remittance</span>
                  <span className="text-xs font-normal text-sky-700">
                    open remit →
                  </span>
                </Link>
                <Link
                  to={guardLink("/ar")}
                  className={
                    "flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 " +
                    (!hasShift ? disabledCard : "")
                  }
                >
                  <span>Collect on AR</span>
                  <span className="text-xs font-normal text-slate-500">
                    open AR →
                  </span>
                </Link>
              </div>

              {!hasShift ? (
                <div className={disabledHint}>
                  Requires open shift for POS, AR, and rider remit actions.
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Shift Console
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {hasShift
                      ? "Manage drawer and shift status"
                      : "Waiting for manager-opened shift"}
                  </div>
                </div>
                <Link
                  to="/cashier/shift?next=/cashier"
                  className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Open →
                </Link>
              </div>
              <p className="text-xs text-slate-500">
                Accept opening float, record drawer movements, and submit
                counted cash for manager final close.
              </p>

              {hasShift ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Active shift: #{activeShift?.id}
                  {openedAt ? ` • Opened ${openedAt}` : ""}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  No active shift yet. Manager must open your shift before
                  POS/AR/remit.
                </div>
              )}

              <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span>Shift history</span>
                <Link
                  to="/cashier/shift-history"
                  className="font-medium text-slate-700 hover:text-slate-900"
                >
                  View all →
                </Link>
              </div>
            </div>
          </div>
        </section>

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
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                Work Schedule
              </div>
              <div className="mt-1 text-sm font-medium text-slate-900">
                {nextShiftLabel}
              </div>
              <p className="mt-1 text-xs text-indigo-900/80">{scheduleSubtitle}</p>

              <div className="mt-3 grid gap-2">
                <Link
                  to="/cashier/shift?next=/cashier"
                  className="inline-flex items-center justify-center rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100/40"
                >
                  View full schedule
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Attendance &amp; Absences
              </h2>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {absentCountThisMonth}
                <span className="ml-1 text-xs font-normal text-slate-500">
                  absent this month
                </span>
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Kasama dito ang hindi naka-time-in / naka-log sa schedule.
              </p>
              <Link
                to="/cashier/shift-history"
                className="mt-3 inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Attendance history
              </Link>
            </div>

            <div
              className={
                "rounded-2xl border p-4 text-sm shadow-sm " +
                (finance.outstandingCharges > 0
                  ? "border-rose-200 bg-rose-50"
                  : "border-slate-200 bg-white")
              }
            >
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Payday &amp; Charges
              </h2>
              <p className="mt-1 text-xs text-slate-500">Next payday</p>
              <p className="text-sm font-medium text-slate-900">{paydayLabel}</p>

              <div className="mt-3">
                <p className="text-xs text-slate-500">Outstanding charges</p>
                <p className="text-xl font-semibold text-slate-900">
                  ₱{finance.outstandingCharges.toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Pwedeng kasama dito ang shortage, penalties, o iba pang
                  deductions na naka-assign sa account mo.
                </p>
              </div>

              <div className="mt-3 flex gap-2">
                <Link
                  to="/cashier/shift-history"
                  className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Payslip / payroll
                </Link>
                <Link
                  to="/cashier/charges"
                  className={
                    "inline-flex flex-1 items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium " +
                    (finance.outstandingCharges > 0 || alerts.openChargeItems > 0
                      ? "border-rose-200 bg-white text-rose-700 hover:bg-rose-100/40"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")
                  }
                >
                  View charges
                </Link>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Pending acknowledgement: {alerts.openChargeItems}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
