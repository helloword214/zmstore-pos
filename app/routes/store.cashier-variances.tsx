/* app/routes/store.cashier-variances.tsx */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { CashierVarianceStatus, Prisma } from "@prisma/client";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTDataRow } from "~/components/ui/SoTDataRow";
import { SoTEmptyState } from "~/components/ui/SoTEmptyState";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import {
  SoTTable,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
  SoTTh,
  SoTTd,
} from "~/components/ui/SoTTable";

type Denoms = {
  bills?: Record<string, number>;
  coins?: Record<string, number>;
};

type CashierUserLite = {
  id: number;
  email: string | null;
  employee: {
    firstName: string;
    lastName: string;
    alias: string | null;
  } | null;
};

type LoaderData = {
  tab: "open" | "history";
  counts: { open: number; history: number };
  rows: Array<{
    id: number;
    status: string;
    resolution: string | null;
    createdAt: string;
    expected: number;
    counted: number;
    variance: number;
    note: string | null;
    managerApprovedAt: string | null;
    shift: {
      id: number;
      openedAt: string;
      closedAt: string | null;
      deviceId: string | null;
      closingDenoms: Denoms | null;
      cashier: { id: number; name: string; email: string | null };
    };
  }>;
};

const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function peso(n: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number.isFinite(n) ? n : 0);
}

function safeTab(raw: string | null): LoaderData["tab"] {
  return raw === "history" ? "history" : "open";
}

function varianceTone(variance: number): "neutral" | "success" | "danger" {
  if (Math.abs(variance) < 0.005) return "neutral";
  return variance > 0 ? "success" : "danger";
}

function statusTone(status: string): "neutral" | "warning" | "success" {
  if (status === "OPEN") return "warning";
  if (status === "MANAGER_APPROVED" || status === "CLOSED") return "success";
  return "neutral";
}

function nameOfUser(u: CashierUserLite) {
  const emp = u?.employee;
  return (
    emp?.alias ||
    [emp?.firstName, emp?.lastName].filter(Boolean).join(" ") ||
    u?.email ||
    `User#${u?.id ?? "?"}`
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v != null;
}

function normalizeDenoms(raw: unknown): Denoms | null {
  if (!isRecord(raw)) return null;
  const bills = isRecord(raw.bills) ? raw.bills : {};
  const coins = isRecord(raw.coins) ? raw.coins : {};
  // ensure numeric
  const clean = (o: Record<string, unknown>) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) {
      const n = Number(v);
      out[String(k)] = Number.isFinite(n) ? n : 0;
    }
    return out;
  };
  return { bills: clean(bills), coins: clean(coins) };
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);

  const url = new URL(request.url);
  const tab = safeTab(url.searchParams.get("tab"));

  // Badge counts
  const historyStatuses: CashierVarianceStatus[] = [
    CashierVarianceStatus.WAIVED,
    CashierVarianceStatus.CLOSED,
    CashierVarianceStatus.MANAGER_APPROVED,
  ];
  const [openCount, historyCount] = await Promise.all([
    db.cashierShiftVariance.count({ where: { status: CashierVarianceStatus.OPEN } }),
    db.cashierShiftVariance.count({
      where: {
        status: { in: historyStatuses },
      },
    }),
  ]);

  const where: Prisma.CashierShiftVarianceWhereInput =
    tab === "open"
      ? { status: CashierVarianceStatus.OPEN }
      : {
          status: { in: historyStatuses },
        };

  const rows = await db.cashierShiftVariance.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: tab === "history" ? 150 : 250,
    select: {
      id: true,
      status: true,
      resolution: true,
      createdAt: true,
      expected: true,
      counted: true,
      variance: true,
      note: true,
      managerApprovedAt: true,
      shift: {
        select: {
          id: true,
          openedAt: true,
          closedAt: true,
          deviceId: true,
          closingDenoms: true,
          cashier: {
            select: {
              id: true,
              email: true,
              employee: {
                select: { firstName: true, lastName: true, alias: true },
              },
            },
          },
        },
      },
    },
  });

  const out: LoaderData = {
    tab,
    counts: { open: openCount, history: historyCount },
    rows: rows.map((v) => ({
      id: v.id,
      status: String(v.status ?? ""),
      resolution: v.resolution ? String(v.resolution) : null,
      createdAt: v.createdAt.toISOString(),
      expected: r2(Number(v.expected ?? 0)),
      counted: r2(Number(v.counted ?? 0)),
      variance: r2(Number(v.variance ?? 0)),
      note: v.note ?? null,
      managerApprovedAt: v.managerApprovedAt
        ? v.managerApprovedAt.toISOString()
        : null,
      shift: {
        id: v.shift.id,
        openedAt: v.shift.openedAt.toISOString(),
        closedAt: v.shift.closedAt ? v.shift.closedAt.toISOString() : null,
        deviceId: v.shift.deviceId ?? null,
        closingDenoms: normalizeDenoms(v.shift.closingDenoms),
        cashier: {
          id: v.shift.cashier.id,
          email: v.shift.cashier.email ?? null,
          name: nameOfUser(v.shift.cashier),
        },
      },
    })),
  };

  return json(out, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER"]);
  throw new Response(
    "Read-only: manager decisions are recorded in /store/cashier-shifts during final close.",
    { status: 405 },
  );
}

function DenomsTable({ denoms }: { denoms: Denoms | null }) {
  if (!denoms) return <span className="text-slate-400">—</span>;

  const billsOrder = ["1000", "500", "200", "100", "50", "20"];
  const coinsOrder = ["25", "10", "5", "1"];

  const bills = denoms.bills ?? {};
  const coins = denoms.coins ?? {};

  // NOTE: "25" is 25 centavos, not ₱25
  const denomValue = (d: string) => {
    if (d === "25") return 0.25;
    const n = Number(d);
    return Number.isFinite(n) ? n : 0;
  };
  const sumPart = (order: string[], map: Record<string, number>) =>
    order.reduce((acc, d) => acc + Number(map[d] || 0) * denomValue(d), 0);

  const billsTotal = sumPart(billsOrder, bills);
  const coinsTotal = sumPart(coinsOrder, coins);
  const total = billsTotal + coinsTotal;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <SoTDataRow label="Bills" value={peso(billsTotal)} />
        <SoTDataRow label="Coins" value={peso(coinsTotal)} />
      </div>

      <div className="text-[11px] text-slate-600">
        Total from denoms:{" "}
        <span className="font-medium text-slate-900">{peso(total)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <div className="mb-1 font-semibold text-slate-700">Bills</div>
          <div className="space-y-1">
            {billsOrder.map((d) => (
              <div key={d} className="flex items-center justify-between">
                <span className="text-slate-600">₱{d}</span>
                <span className="tabular-nums text-slate-900">
                  {Number(bills[d] || 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 font-semibold text-slate-700">Coins</div>
          <div className="space-y-1">
            {coinsOrder.map((d) => (
              <div key={d} className="flex items-center justify-between">
                <span className="text-slate-600">₱{d}</span>
                <span className="tabular-nums text-slate-900">
                  {Number(coins[d] || 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StoreCashierVariancesPage() {
  const { rows, tab, counts } = useLoaderData<LoaderData>();
  const [sp] = useSearchParams();

  const tabLink = (t: "open" | "history") => {
    const next = new URLSearchParams(sp);
    next.set("tab", t);
    return `?${next.toString()}`;
  };

  const isHistory = tab === "history";
  const pageTitle = isHistory ? "Variance History" : "Open Variances";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Cashier Shift Variances"
        subtitle="Review close-count mismatches."
        backTo="/store"
        backLabel="Dashboard"
      />

      <div className="mx-auto max-w-6xl px-5 py-6">
        <SoTCard className="overflow-hidden p-0">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-slate-800">
                {pageTitle}
              </div>
              <div className="text-xs text-slate-500">
                Final close stays in Shift Manager.
              </div>
              <SoTActionBar
                className="mb-0"
                left={
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Link
                      to={tabLink("open")}
                      className={`inline-flex items-center rounded-full border px-2 py-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 ${
                        tab === "open"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Open
                      {counts.open > 0 ? (
                        <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                          {counts.open}
                        </span>
                      ) : null}
                    </Link>
                    <Link
                      to={tabLink("history")}
                      className={`inline-flex items-center rounded-full border px-2 py-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 ${
                        tab === "history"
                          ? "border-slate-300 bg-slate-100 text-slate-800"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      History
                      {counts.history > 0 ? (
                        <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                          {counts.history}
                        </span>
                      ) : null}
                    </Link>
                  </div>
                }
                right={
                  <div className="text-xs text-slate-500">
                    Showing {rows.length} item(s)
                  </div>
                }
              />
            </div>
          </div>

          <SoTTable>
            <SoTTableHead>
              <SoTTableRow className="border-t-0">
                <SoTTh>Shift</SoTTh>
                <SoTTh>Cashier</SoTTh>
                <SoTTh>Status</SoTTh>
                <SoTTh align="right">Expected</SoTTh>
                <SoTTh align="right">Counted</SoTTh>
                <SoTTh align="right">Diff</SoTTh>
                <SoTTh>Evidence</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {rows.length === 0 ? (
                    <SoTTableEmptyRow
                      colSpan={7}
                      message={
                        <SoTEmptyState
                          title="No cashier shift variances."
                          hint="Open and resolved close-count records will appear here."
                        />
                      }
                    />
              ) : (
                rows.map((v) => {
                  const isZero = Math.abs(v.variance) < 0.005;
                  const diffClass = isZero
                    ? "text-slate-600"
                    : v.variance > 0
                      ? "text-emerald-700"
                      : "text-rose-700";
                  const badgeLabel = isZero
                    ? "MATCH"
                    : v.variance > 0
                      ? "OVER"
                      : "SHORT";

                  return (
                    <SoTTableRow key={v.id}>
                      <SoTTd>
                        <div className="text-slate-900">
                          {new Date(v.shift.openedAt).toLocaleString()}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Shift <span className="font-mono">#{v.shift.id}</span>{" "}
                          • Variance <span className="font-mono">#{v.id}</span>
                          {v.shift.deviceId ? (
                            <>
                              {" "}
                              •{" "}
                              <span className="font-mono">{v.shift.deviceId}</span>
                            </>
                          ) : null}
                        </div>
                        {v.shift.closedAt ? (
                          <div className="mt-1 text-[11px] text-slate-500">
                            Closed {new Date(v.shift.closedAt).toLocaleString()}
                          </div>
                        ) : (
                          <div className="mt-1 text-[11px] text-amber-700">
                            Shift record still open
                          </div>
                        )}
                      </SoTTd>

                      <SoTTd>
                        <div className="text-slate-900">{v.shift.cashier.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {v.shift.cashier.email ?? "—"}
                        </div>
                      </SoTTd>

                      <SoTTd>
                        <SoTStatusBadge tone={statusTone(v.status)}>
                          {v.status}
                        </SoTStatusBadge>
                        {v.resolution ? (
                          <div className="mt-1 text-[11px] text-slate-500">
                            {v.resolution}
                          </div>
                        ) : null}
                        <div className="mt-1 text-[11px] text-slate-500">
                          Manager review{" "}
                          <span className="font-medium">
                            {v.managerApprovedAt
                              ? new Date(v.managerApprovedAt).toLocaleString()
                              : "Pending"}
                          </span>
                        </div>
                      </SoTTd>

                      <SoTTd align="right" className="tabular-nums">
                        {peso(v.expected)}
                      </SoTTd>
                      <SoTTd align="right" className="tabular-nums">
                        {peso(v.counted)}
                      </SoTTd>
                      <SoTTd align="right" className="tabular-nums">
                        <div className="flex items-center justify-end gap-2">
                          <SoTStatusBadge tone={varianceTone(v.variance)}>
                            {badgeLabel}
                          </SoTStatusBadge>
                          <span className={["font-medium", diffClass].join(" ")}>
                            {v.variance >= 0 ? "+" : ""}
                            {peso(v.variance)}
                          </span>
                        </div>
                      </SoTTd>

                      <SoTTd>
                        <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <summary className="cursor-pointer text-xs font-medium text-slate-700">
                            Evidence
                          </summary>
                          <div className="mt-3 space-y-3 text-[11px] text-slate-600">
                            <DenomsTable denoms={v.shift.closingDenoms} />
                            {v.note ? (
                              <div>
                                Cashier note:{" "}
                                <span className="font-medium">{v.note}</span>
                              </div>
                            ) : null}
                            <div>
                              Manager review:{" "}
                              <span className="font-medium">
                                {v.managerApprovedAt
                                  ? new Date(v.managerApprovedAt).toLocaleString()
                                  : "Pending"}
                              </span>
                            </div>
                          </div>
                        </details>
                      </SoTTd>
                    </SoTTableRow>
                  );
                })
              )}
            </tbody>
          </SoTTable>
        </SoTCard>
      </div>
    </main>
  );
}
