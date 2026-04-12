import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
// NOTE: date filters must be timezone-safe (server may not be Asia/Manila)
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import type { Prisma } from "@prisma/client";
import { CashDrawerTxnType, CashierShiftStatus } from "@prisma/client";
import { SelectInput } from "~/components/ui/SelectInput";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import {
  SoTTable,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
  SoTTd,
  SoTTh,
} from "~/components/ui/SoTTable";

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
      const q = Number(obj[d.key] ?? 0);
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
  const openStatuses: CashierShiftStatus[] = [
    CashierShiftStatus.PENDING_ACCEPT,
    CashierShiftStatus.OPEN,
    CashierShiftStatus.OPENING_DISPUTED,
    CashierShiftStatus.SUBMITTED,
    CashierShiftStatus.RECOUNT_REQUIRED,
  ];

  // Build filters
  const where: Prisma.CashierShiftWhereInput = {
    ...(me.role === "CASHIER" ? { cashierId: me.userId } : {}),
    ...(status === "open"
      ? {
          status: {
            in: openStatuses,
          },
        }
      : status === "closed"
      ? { status: CashierShiftStatus.FINAL_CLOSED }
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
        status: s.status,
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
      <SoTNonDashboardHeader
        title="Shift history"
        subtitle={
          role === "ADMIN"
            ? "Cashier drawer counts, cash movement, and rider variance."
            : "Your drawer counts, cash movement, and rider variance."
        }
        backTo="/cashier"
        backLabel="Cashier"
      />

      <div className="mx-auto max-w-6xl space-y-3 px-5 py-6">
        <SoTCard compact interaction="form">
          <Form method="get">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(10rem,12rem)_repeat(2,minmax(9rem,11rem))_1fr_auto] md:items-end">
              <div className="text-sm">
                <SelectInput
                  name="status"
                  label="Status"
                  defaultValue={filters.status}
                  options={[
                    { value: "open", label: "Open" },
                    { value: "closed", label: "Closed" },
                    { value: "all", label: "All" },
                  ]}
                />
              </div>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">From</span>
                <input
                  type="date"
                  name="from"
                  defaultValue={filters.from ?? ""}
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">To</span>
                <input
                  type="date"
                  name="to"
                  defaultValue={filters.to ?? ""}
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                />
              </label>

              {role === "ADMIN" ? (
                <div className="text-sm">
                  <SelectInput
                    name="cashierId"
                    label="Cashier"
                    defaultValue={filters.cashierId ?? ""}
                    options={[
                      { value: "", label: "All cashiers" },
                      ...cashiers.map((c) => ({ value: c.id, label: c.label })),
                    ]}
                  />
                </div>
              ) : (
                <div className="hidden md:block" />
              )}
              <div className="flex items-center justify-start gap-2 md:justify-end">
                <SoTButton type="submit" variant="primary" size="compact">
                  Apply
                </SoTButton>
                {params.toString() ? (
                  <Link
                    to="/cashier/shift-history"
                    className="inline-flex h-9 items-center rounded-xl px-3 text-sm font-medium text-indigo-700 transition-colors duration-150 hover:bg-indigo-50 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    Reset
                  </Link>
                ) : null}
              </div>
            </div>
          </Form>
        </SoTCard>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Shift audit
          </div>
          <SoTTable>
            <SoTTableHead>
              <SoTTableRow className="border-t-0">
                <SoTTh>Shift</SoTTh>
                <SoTTh>Cashier</SoTTh>
                <SoTTh>Status</SoTTh>
                <SoTTh align="right">Cash In</SoTTh>
                <SoTTh align="right">Drawer</SoTTh>
                <SoTTh align="right">Variance</SoTTh>
                <SoTTh align="right">Expected</SoTTh>
                <SoTTh align="right">Counted</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {shifts.map((s) => (
                <SoTTableRow key={s.id} className="hover:bg-slate-50/60">
                  <SoTTd>
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
                  </SoTTd>
                  <SoTTd>{s.cashier.displayName}</SoTTd>
                  <SoTTd>
                    {(() => {
                      const st = s.status;
                      if (st === "OPEN") {
                        return (
                          <SoTStatusBadge tone="success">OPEN</SoTStatusBadge>
                        );
                      }
                      if (st === "PENDING_ACCEPT") {
                        return (
                          <div>
                            <SoTStatusBadge tone="neutral">
                              PENDING ACCEPT
                            </SoTStatusBadge>
                            <div className="mt-1 text-xs text-slate-500">
                              Waiting opening
                            </div>
                          </div>
                        );
                      }
                      if (st === "OPENING_DISPUTED") {
                        return (
                          <div>
                            <SoTStatusBadge tone="danger">
                              OPENING DISPUTED
                            </SoTStatusBadge>
                            <div className="mt-1 text-xs text-slate-500">
                              Opening mismatch
                            </div>
                          </div>
                        );
                      }
                      if (st === "SUBMITTED") {
                        return (
                          <div>
                            <SoTStatusBadge tone="warning">
                              SUBMITTED
                            </SoTStatusBadge>
                            <div className="mt-1 text-xs text-slate-500">
                              Waiting close
                            </div>
                          </div>
                        );
                      }
                      if (st === "RECOUNT_REQUIRED") {
                        return (
                          <div>
                            <SoTStatusBadge tone="danger">
                              LEGACY RECOUNT
                            </SoTStatusBadge>
                            <div className="mt-1 text-xs text-slate-500">
                              Legacy
                            </div>
                          </div>
                        );
                      }
                      // FINAL_CLOSED (or anything else)
                      return (
                        <div>
                          <SoTStatusBadge tone="neutral">CLOSED</SoTStatusBadge>
                          {s.closedAt ? (
                            <div className="mt-1 text-xs text-slate-500">
                              {new Date(s.closedAt).toLocaleString()}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </SoTTd>
                  <SoTTd align="right" className="tabular-nums">
                    <div className="text-slate-900">{peso(s.cashInTotal)}</div>
                    <div className="text-xs text-slate-500">
                      Sales {peso(s.cashSalesIn)} • A/R {peso(s.arCashIn)}
                    </div>
                  </SoTTd>
                  <SoTTd align="right" className="tabular-nums">
                    <div className="text-slate-900">
                      Add {peso(s.drawerDeposits)}
                    </div>
                    <div className="text-xs text-slate-500">
                      Take {peso(s.drawerOut + s.drawerDrops)}
                    </div>
                  </SoTTd>
                  <SoTTd align="right" className="tabular-nums">
                    {s.varianceBridgeAmount > 0 ? (
                      <div>
                        <div className="font-medium text-amber-700">
                          {peso(s.varianceBridgeAmount)}
                        </div>
                        <div className="text-xs text-slate-500">
                          Rider shortage
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </SoTTd>
                  <SoTTd align="right" className="tabular-nums">
                    {peso(s.drawerBalance)}
                  </SoTTd>
                  <SoTTd align="right" className="tabular-nums">
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
                  </SoTTd>
                </SoTTableRow>
              ))}
              {shifts.length === 0 ? (
                <SoTTableEmptyRow colSpan={8} message="No shifts found." />
              ) : null}
            </tbody>
          </SoTTable>
        </div>
      </div>
    </main>
  );
}
