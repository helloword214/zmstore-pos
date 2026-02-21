/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
// NOTE: date filters must be timezone-safe (server may not be Asia/Manila)
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import type { Prisma } from "@prisma/client";
import { CashDrawerTxnType } from "@prisma/client";

const CASH_COUNT_MARKER = "CASH_COUNT_JSON:";
const DENOMS: Array<{ key: string; label: string; value: number }> = [
  { key: "d1000", label: "₱1,000", value: 1000 },
  { key: "d500", label: "₱500", value: 500 },
  { key: "d200", label: "₱200", value: 200 },
  { key: "d100", label: "₱100", value: 100 },
  { key: "d50", label: "₱50", value: 50 },
  { key: "d20", label: "₱20", value: 20 },
  { key: "d10", label: "₱10", value: 10 },
  { key: "d5", label: "₱5", value: 5 },
  { key: "d1", label: "₱1", value: 1 },
  { key: "c25", label: "₱0.25", value: 0.25 },
];
type CashCount = Record<string, number>;
function parseCashCountFromNotes(notes: string | null) {
  if (!notes) return null;
  const line = notes
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.startsWith(CASH_COUNT_MARKER));
  if (!line) return null;
  const raw = line.slice(CASH_COUNT_MARKER.length).trim();
  try {
    const obj = JSON.parse(raw) as CashCount;
    if (!obj || typeof obj !== "object") return null;
    const parts: string[] = [];
    for (const d of DENOMS) {
      const q = Number((obj as any)[d.key] ?? 0);
      if (Number.isFinite(q) && q > 0)
        parts.push(`${d.label}×${Math.floor(q)}`);
    }
    return parts.length ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

type LoaderData = {
  // This route is guarded by requireRole(["ADMIN","CASHIER"]) so keep it strict.
  role: "ADMIN" | "CASHIER";
  shifts: Array<{
    id: number;
    openedAt: string;
    closedAt: string | null;
    status:
      | "PENDING_ACCEPT"
      | "OPEN"
      | "OPENING_DISPUTED"
      | "SUBMITTED"
      | "RECOUNT_REQUIRED"
      | "FINAL_CLOSED";
    openingFloat: string | null;
    closingTotal: string | null;
    deviceId: string | null;
    notes: string | null;
    cashier: {
      id: number;
      email: string | null;
      displayName: string;
    };
    paymentsCount: number;
    // Payments rollups (explicit)
    cashAmount: number; // sum(amount) where method=CASH
    cashTendered: number; // sum(tendered) where method=CASH
    cashChange: number; // sum(change) where method=CASH
    varianceBridgeAmount: number; // INTERNAL_CREDIT rider shortage bridge
    // Drawer rollups
    drawerDeposits: number; // CASH_IN
    drawerOut: number; // CASH_OUT
    drawerDrops: number; // DROP
    cashSalesIn: number; // tendered - change (CASH only)
    arCashIn: number; // CustomerArPayment.amount linked to shift
    cashInTotal: number; // sales + AR cash
    drawerBalance: number; // openingFloat + cashInTotal + deposits - out - drops
    cashCountSummary?: string | null; // parsed from notes (manager audit)
  }>;
  filters: {
    status: "all" | "open" | "closed";
    from?: string;
    to?: string;
    cashierId?: number | null;
  };
  cashiers: Array<{ id: number; label: string }>;
};

function safeStatus(raw: string | null): "all" | "open" | "closed" {
  if (raw === "all" || raw === "open" || raw === "closed") return raw;
  return "open";
}

function safeInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (Math.floor(n) !== n) return undefined;
  if (n <= 0) return undefined;
  return n;
}

function safeYmd(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const v = String(raw).trim();
  // strict YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return v;
}

// Build Manila-local boundaries regardless of server timezone.
// Example:
//  from=2026-01-01 => 2026-01-01T00:00:00+08:00
//  to=2026-01-01   => 2026-01-01T23:59:59.999+08:00
function manilaStartOfDay(ymd: string) {
  return new Date(`${ymd}T00:00:00.000+08:00`);
}
function manilaEndOfDay(ymd: string) {
  return new Date(`${ymd}T23:59:59.999+08:00`);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["ADMIN", "CASHIER"]);
  const url = new URL(request.url);
  const status = safeStatus(url.searchParams.get("status"));
  const from = safeYmd(url.searchParams.get("from")); // YYYY-MM-DD
  const to = safeYmd(url.searchParams.get("to"));
  const cashierId = safeInt(url.searchParams.get("cashierId"));

  const openedAtRange =
    from || to
      ? {
          ...(from ? { gte: manilaStartOfDay(from) } : {}),
          ...(to ? { lte: manilaEndOfDay(to) } : {}),
        }
      : undefined;

  // Build filters
  const where: Prisma.CashierShiftWhereInput = {
    ...(me.role === "CASHIER" ? { cashierId: me.userId } : {}),
    ...(status === "open"
      ? {
          status: {
            in: [
              "PENDING_ACCEPT",
              "OPEN",
              "OPENING_DISPUTED",
              "SUBMITTED",
              "RECOUNT_REQUIRED",
            ] as any,
          },
        }
      : status === "closed"
      ? { status: "FINAL_CLOSED" as any }
      : {}),
    ...(openedAtRange ? { openedAt: openedAtRange } : {}),
    ...(me.role === "ADMIN" && cashierId ? { cashierId } : {}),
  };

  const shifts = await db.cashierShift.findMany({
    where,
    orderBy: { openedAt: "desc" },
    take: 200, // sane cap
    include: {
      cashier: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      _count: { select: { payments: true } },
    },
  });

  const shiftIds = shifts.map((s) => s.id);

  // ─────────────────────────────────────────────
  // Payments summary
  // NOTE:
  // - CASH is drawer truth (amount/tendered/change)
  // - INTERNAL_CREDIT rider-shortage is a non-cash bridge (audit only)
  // ─────────────────────────────────────────────
  const cashSums =
    shiftIds.length > 0
      ? await db.payment.groupBy({
          by: ["shiftId"],
          where: { shiftId: { in: shiftIds }, method: "CASH" },
          _sum: { amount: true, tendered: true, change: true },
        })
      : [];

  const cashMap = new Map<
    number,
    { amount: number; tendered: number; change: number }
  >();
  for (const row of cashSums) {
    cashMap.set(row.shiftId!, {
      amount: Number(row._sum.amount ?? 0),
      tendered: Number(row._sum.tendered ?? 0),
      change: Number(row._sum.change ?? 0),
    });
  }

  const bridgeSums =
    shiftIds.length > 0
      ? await db.payment.groupBy({
          by: ["shiftId"],
          where: {
            shiftId: { in: shiftIds },
            method: "INTERNAL_CREDIT",
            // delivery-remit creates: refNo like:
            //  - "RIDER-SHORTAGE:RR:<receiptId>" (canonical)
            //  - "RIDER_SHORTAGE" (legacy)
            OR: [
              { refNo: "RIDER_SHORTAGE" },
              { refNo: { startsWith: "RIDER-SHORTAGE" } },
            ],
          },
          _sum: { amount: true },
        })
      : [];
  const bridgeMap = new Map<number, number>();
  for (const row of bridgeSums) {
    bridgeMap.set(row.shiftId!, Number(row._sum.amount ?? 0));
  }

  // Cash-only inflow to drawer (tendered - change) per shift
  const cashInRows =
    shiftIds.length > 0
      ? await db.payment.groupBy({
          by: ["shiftId", "method"],
          where: { shiftId: { in: shiftIds }, method: "CASH" },
          _sum: { tendered: true, change: true },
        })
      : [];
  const cashSalesInMap = new Map<number, number>();
  for (const r of cashInRows) {
    const t = Number(r._sum.tendered ?? 0);
    const c = Number(r._sum.change ?? 0);
    cashSalesInMap.set(r.shiftId!, t - c);
  }

  const arCashRows =
    shiftIds.length > 0
      ? await db.customerArPayment.groupBy({
          by: ["shiftId"],
          where: { shiftId: { in: shiftIds } },
          _sum: { amount: true },
        })
      : [];
  const arCashInMap = new Map<number, number>();
  for (const r of arCashRows) {
    arCashInMap.set(r.shiftId!, Number(r._sum.amount ?? 0));
  }

  // Drawer transactions per shift (CASH_IN, CASH_OUT, DROP)
  const drawerRows =
    shiftIds.length > 0
      ? await db.cashDrawerTxn.groupBy({
          by: ["shiftId", "type"],
          where: { shiftId: { in: shiftIds } },
          _sum: { amount: true },
        })
      : [];
  const drawerMap = new Map<
    number,
    { in: number; out: number; drop: number }
  >();
  for (const r of drawerRows) {
    const cur = drawerMap.get(r.shiftId!) ?? { in: 0, out: 0, drop: 0 };
    const val = Number(r._sum.amount ?? 0);
    if (r.type === CashDrawerTxnType.CASH_IN) cur.in += val;
    else if (r.type === CashDrawerTxnType.CASH_OUT) cur.out += val;
    else if (r.type === CashDrawerTxnType.DROP) cur.drop += val;
    drawerMap.set(r.shiftId!, cur);
  }

  // cashier list (ADMIN only)
  const cashiers =
    me.role === "ADMIN"
      ? await db.user
          .findMany({
            where: { role: "CASHIER", active: true },
            select: {
              id: true,
              email: true,
              employee: {
                select: { firstName: true, lastName: true, alias: true },
              },
            },
            orderBy: [{ employee: { lastName: "asc" } }, { email: "asc" }],
          })
          .then((rows) =>
            rows.map((u) => ({
              id: u.id,
              label:
                u.employee?.alias ||
                [u.employee?.firstName, u.employee?.lastName]
                  .filter(Boolean)
                  .join(" ") ||
                u.email ||
                `User#${u.id}`,
            })),
          )
      : [];

  const data: LoaderData = {
    role: me.role as "ADMIN" | "CASHIER",
    shifts: shifts.map((s) => {
      const emp = s.cashier.employee;
      const displayName =
        emp?.alias ||
        [emp?.firstName, emp?.lastName].filter(Boolean).join(" ") ||
        s.cashier.email ||
        `User#${s.cashier.id}`;
      const cash = cashMap.get(s.id) || { amount: 0, tendered: 0, change: 0 };
      const varianceBridgeAmount = bridgeMap.get(s.id) ?? 0;
      const drawer = drawerMap.get(s.id) || { in: 0, out: 0, drop: 0 };
      const openingFloatNum = Number(s.openingFloat ?? 0);
      const cashSalesIn = cashSalesInMap.get(s.id) ?? 0;
      const arCashIn = arCashInMap.get(s.id) ?? 0;
      const cashInTotal = cashSalesIn + arCashIn;
      const drawerBalance =
        openingFloatNum + cashInTotal + drawer.in - drawer.out - drawer.drop;
      return {
        id: s.id,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
        status: (s as any).status ?? (s.closedAt ? "FINAL_CLOSED" : "OPEN"),
        openingFloat: s.openingFloat ? s.openingFloat.toString() : null,
        closingTotal: s.closingTotal ? s.closingTotal.toString() : null,
        deviceId: s.deviceId,
        notes: s.notes,
        cashier: { id: s.cashier.id, email: s.cashier.email, displayName },
        paymentsCount: s._count.payments,
        cashAmount: cash.amount,
        cashTendered: cash.tendered,
        cashChange: cash.change,
        varianceBridgeAmount,
        drawerDeposits: drawer.in,
        drawerOut: drawer.out,
        drawerDrops: drawer.drop,
        cashSalesIn,
        arCashIn,
        cashInTotal,
        drawerBalance,
        cashCountSummary: parseCashCountFromNotes(s.notes ?? null),
      };
    }),
    filters: {
      status,
      from,
      to,
      cashierId: cashierId ?? null,
    },
    cashiers,
  };
  return json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

function peso(n: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number.isFinite(n) ? n : 0);
}

export default function ShiftHistory() {
  const { role, shifts, filters, cashiers } = useLoaderData<LoaderData>();
  const [params] = useSearchParams();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Shift History
            </h1>
            <p className="text-sm text-slate-600">
              {role === "ADMIN"
                ? "Audit cashier shifts and drawer balances."
                : "Review your shifts and drawer balances."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/cashier/shift"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Open Shift Console
            </Link>
            <Link
              to="/cashier"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ← Back
            </Link>
          </div>
        </div>
        {/* Filters */}
        <Form
          method="get"
          className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-5"
        >
          <label className="text-sm">
            <span className="block text-slate-700 mb-1">Status</span>
            <select
              name="status"
              defaultValue={filters.status}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-700 mb-1">From</span>
            <input
              type="date"
              name="from"
              defaultValue={filters.from ?? ""}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-700 mb-1">To</span>
            <input
              type="date"
              name="to"
              defaultValue={filters.to ?? ""}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
            />
          </label>

          {role === "ADMIN" ? (
            <label className="text-sm">
              <span className="block text-slate-700 mb-1">Cashier</span>
              <select
                name="cashierId"
                defaultValue={filters.cashierId ?? ""}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">All</option>
                {cashiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="hidden md:block" />
          )}
          <div className="md:col-span-5">
            <button className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
              Apply Filters
            </button>
            {params.toString() && (
              <Link
                to="/cashier/shift-history"
                className="ml-2 text-sm text-slate-600 hover:underline"
              >
                Reset
              </Link>
            )}
          </div>
        </Form>

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-700">
                <th className="px-4 py-3">Shift</th>
                <th className="px-4 py-3">Cashier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Cash In (Sales + A/R)</th>
                <th className="px-4 py-3 text-right">Bridge</th>
                <th className="px-4 py-3 text-right">Moves</th>
                <th className="px-4 py-3 text-right">Expected Drawer</th>
                <th className="px-4 py-3 text-right">Counted / Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shifts.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2">
                    <div className="text-slate-900">
                      {new Date(s.openedAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">
                      <span className="font-mono">#{s.id}</span>
                      {s.deviceId ? (
                        <>
                          {" "}
                          • <span className="font-mono">{s.deviceId}</span>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2">{s.cashier.displayName}</td>
                  <td className="px-4 py-2">
                    {(() => {
                      const st = s.status;
                      if (st === "OPEN") {
                        return (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">
                            OPEN
                          </span>
                        );
                      }
                      if (st === "PENDING_ACCEPT") {
                        return (
                          <div>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-200">
                              PENDING ACCEPT
                            </span>
                            <div className="mt-1 text-xs text-slate-500">
                              Waiting cashier opening verification
                            </div>
                          </div>
                        );
                      }
                      if (st === "OPENING_DISPUTED") {
                        return (
                          <div>
                            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 ring-1 ring-rose-200">
                              OPENING DISPUTED
                            </span>
                            <div className="mt-1 text-xs text-slate-500">
                              Opening float dispute; manager action required
                            </div>
                          </div>
                        );
                      }
                      if (st === "SUBMITTED") {
                        return (
                          <div>
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200">
                              SUBMITTED
                            </span>
                            <div className="mt-1 text-xs text-slate-500">
                              Waiting for manager close
                            </div>
                          </div>
                        );
                      }
                      if (st === "RECOUNT_REQUIRED") {
                        return (
                          <div>
                            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 ring-1 ring-rose-200">
                              LEGACY RECOUNT
                            </span>
                            <div className="mt-1 text-xs text-slate-500">
                              Legacy status from old flow
                            </div>
                          </div>
                        );
                      }
                      // FINAL_CLOSED (or anything else)
                      return (
                        <div>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-200">
                            CLOSED
                          </span>
                          {s.closedAt ? (
                            <div className="mt-1 text-xs text-slate-500">
                              {new Date(s.closedAt).toLocaleString()}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <div className="text-slate-900">{peso(s.cashInTotal)}</div>
                    <div className="text-xs text-slate-500">
                      Sales {peso(s.cashSalesIn)} • A/R {peso(s.arCashIn)}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.varianceBridgeAmount > 0 ? (
                      <div className="inline-flex items-center gap-2">
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200">
                          BRIDGE
                        </span>
                        <span>{peso(s.varianceBridgeAmount)}</span>
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <div className="text-slate-900">
                      +{peso(s.drawerDeposits)}
                    </div>
                    <div className="text-xs text-slate-500">
                      −{peso(s.drawerOut + s.drawerDrops)}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {peso(s.drawerBalance)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.closingTotal ? (
                      (() => {
                        const counted = Number(s.closingTotal);
                        const diff = counted - Number(s.drawerBalance || 0);
                        const isZero = Math.abs(diff) < 0.005;
                        const badgeClass = isZero
                          ? "bg-slate-100 text-slate-700 ring-slate-200"
                          : diff > 0
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-rose-50 text-rose-700 ring-rose-200";
                        const badgeLabel = isZero
                          ? "MATCH"
                          : diff > 0
                          ? "OVER"
                          : "SHORT";
                        return (
                          <div>
                            <div className="text-slate-900">
                              {peso(counted)}
                            </div>
                            {s.cashCountSummary ? (
                              <div className="mt-1 text-[11px] text-slate-500">
                                Denoms: {s.cashCountSummary}
                              </div>
                            ) : null}
                            <div className="mt-1 flex items-center justify-end gap-2 text-xs">
                              <span
                                className={[
                                  "inline-flex items-center rounded-full px-2 py-0.5 ring-1",
                                  badgeClass,
                                ].join(" ")}
                              >
                                {badgeLabel}
                              </span>
                              <span
                                className={
                                  isZero
                                    ? "text-slate-500"
                                    : diff > 0
                                    ? "text-emerald-700"
                                    : "text-rose-700"
                                }
                              >
                                {diff >= 0 ? "+" : ""}
                                {peso(diff)}
                              </span>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-6 text-center text-slate-500"
                  >
                    No shifts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
