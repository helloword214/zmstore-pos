/* app/routes/store.clearance.tsx */
/* STORE MANAGER — Commercial Clearance Inbox (Walk-in + Delivery) */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTCard } from "~/components/ui/SoTCard";
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

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { r2, peso } from "~/utils/money";

type WalkInRow = {
  // CCS SoT: inbox item identity is ClearanceCase
  caseId: number;
  orderId: number;
  orderCode: string;
  customerLabel: string;
  frozenTotal: number;
  paidSoFar: number;
  balance: number;
  releasedAt: string | null;
  releasedApprovedBy: string | null;
};

type DeliveryRow = {
  // CCS SoT: inbox item identity is ClearanceCase
  caseId: number;
  runCode: string;
  receiptKey: string;
  customerLabel: string;
  frozenTotal: number;
  cashCollected: number;
  balance: number;
  kind: "ROAD" | "PARENT";
};

function coerceReceiptKind(v: unknown): "ROAD" | "PARENT" {
  return v === "PARENT" ? "PARENT" : "ROAD";
}

type LoaderData = {
  walkIn: WalkInRow[];
  delivery: DeliveryRow[];
  counts: {
    walkInTotal: number;
    deliveryTotal: number;
    total: number; // total pending across sources
  };
};

function buildCustomerLabelFromOrder(o: any) {
  const c = o?.customer;
  const name =
    [c?.firstName, c?.middleName, c?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "";
  const alias = c?.alias ? ` (${c.alias})` : "";
  const phone = c?.phone ? ` • ${c.phone}` : "";
  const fallback = o?.customerId
    ? `Customer #${o.customerId}`
    : "Walk-in / Unknown";
  return `${name || fallback}${alias}${phone}`.trim();
}

function buildCustomerLabelFromReceipt(r: any) {
  const base =
    (r?.customerName && String(r.customerName).trim()) ||
    (r?.customerId ? `Customer #${r.customerId}` : "Walk-in / Unknown");
  const phone = r?.customerPhone ? ` • ${r.customerPhone}` : "";
  return `${base}${phone}`.trim();
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  // ---------------------------
  // CCS INBOX (SOURCE OF TRUTH)
  // ---------------------------
  // Use ClearanceCase.status=NEEDS_CLEARANCE as the manager inbox.
  // This keeps the UI aligned with the CCS workflow (claims/decisions/AR).
  const cases = await db.clearanceCase.findMany({
    where: { status: "NEEDS_CLEARANCE" } as any,
    select: {
      id: true,
      flaggedAt: true,
      frozenTotal: true,
      cashCollected: true,
      orderId: true,
      runReceiptId: true,

      order: {
        select: {
          id: true,
          orderCode: true,
          channel: true,
          customerId: true,
          releasedAt: true,
          releasedApprovedBy: true,
          customer: {
            select: {
              firstName: true,
              middleName: true,
              lastName: true,
              alias: true,
              phone: true,
            },
          },
          items: { select: { lineTotal: true } },
          payments: { select: { amount: true } },
        },
      },

      runReceipt: {
        select: {
          id: true,
          kind: true,
          receiptKey: true,
          cashCollected: true,
          customerId: true,
          customerName: true,
          customerPhone: true,
          runId: true,
          run: { select: { id: true, runCode: true } },
          lines: { select: { lineTotal: true } },
        },
      },
    },
    orderBy: [{ flaggedAt: "desc" }, { id: "desc" }],
    take: 250,
  });

  const walkInAll: WalkInRow[] = cases
    .filter((c: any) => c?.order?.id && !c?.runReceipt?.id)
    .map((c: any) => {
      const o = c.order;
      // Prefer ClearanceCase snapshot, fallback to order sums if needed.
      const frozenTotal = r2(
        Number(c?.frozenTotal ?? 0) ||
          (o.items || []).reduce(
            (s: number, it: any) => s + Number(it?.lineTotal ?? 0),
            0,
          ),
      );
      // CCS SoT: prefer ClearanceCase.cashCollected as "paid so far" snapshot,
      // fallback to payments sum for legacy/backfill gaps.
      const paidFallback = (o.payments || []).reduce(
        (s: number, p: any) => s + Number(p?.amount ?? 0),
        0,
      );
      const paidSoFar = r2(
        Math.max(0, Number(c?.cashCollected ?? 0) || paidFallback),
      );
      const balance = r2(Math.max(0, frozenTotal - paidSoFar));
      return {
        caseId: Number(c.id),
        orderId: Number(o.id),
        orderCode: String(o.orderCode ?? `#${o.id}`),
        customerLabel: buildCustomerLabelFromOrder(o),
        frozenTotal,
        paidSoFar,
        balance,
        releasedAt: o.releasedAt ? new Date(o.releasedAt).toISOString() : null,
        releasedApprovedBy: o.releasedApprovedBy ?? null,
      };
    });
  // UI cap (keep list small)
  const walkIn = walkInAll.slice(0, 120);

  const deliveryAll: DeliveryRow[] = cases
    .filter((c: any) => c?.runReceipt?.id)
    .map((c: any) => {
      const r = c.runReceipt;
      const frozenTotal = r2(
        Number(c?.frozenTotal ?? 0) ||
          (r.lines || []).reduce(
            (s: number, ln: any) => s + Number(ln?.lineTotal ?? 0),
            0,
          ),
      );
      const cashCollected = r2(
        Math.max(0, Number(c?.cashCollected ?? r.cashCollected ?? 0)),
      );
      const balance = r2(Math.max(0, frozenTotal - cashCollected));
      return {
        caseId: Number(c.id),
        runCode: String(r.run?.runCode ?? `RUN#${r.runId}`),
        receiptKey: String(
          r.receiptKey || `${String(r.kind || "ROAD")}-RR${r.id}`,
        ),
        customerLabel: buildCustomerLabelFromReceipt(r),
        frozenTotal,
        cashCollected,
        balance,
        kind: coerceReceiptKind(r.kind),
      };
    });
  const delivery = deliveryAll.slice(0, 120);

  const data: LoaderData = {
    walkIn,
    delivery,
    counts: {
      walkInTotal: walkInAll.length,
      deliveryTotal: deliveryAll.length,
      total: walkInAll.length + deliveryAll.length,
    },
  };

  return json<LoaderData>(data);
}

export default function StoreClearanceInbox() {
  const { walkIn, delivery, counts } = useLoaderData<LoaderData>();
  const [sp, setSp] = useSearchParams();
  const tab = String(sp.get("tab") || "all"); // all | walkin | delivery

  const showWalkIn = tab === "all" || tab === "walkin";
  const showDelivery = tab === "all" || tab === "delivery";
  const tabButtonClass = (active: boolean) =>
    `rounded-xl border px-3 py-1.5 text-xs font-medium shadow-sm ${
      active
        ? "border-indigo-200 bg-indigo-50 text-indigo-800"
        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
    }`;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Commercial Clearance — Inbox"
        subtitle="Unified list of kulang bayad / utang / release with balance (walk-in + delivery)."
        backTo="/store"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl space-y-4 px-5 py-6">
        <SoTAlert tone="info">
          Manager decision layer ito; walang posting ng remit sa page na ito.
        </SoTAlert>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSp((p) => (p.set("tab", "all"), p))}
            className={tabButtonClass(tab === "all")}
          >
            All <span className="ml-1 font-semibold">{counts.total}</span>
          </button>
          <button
            type="button"
            onClick={() => setSp((p) => (p.set("tab", "walkin"), p))}
            className={tabButtonClass(tab === "walkin")}
          >
            Walk-in{" "}
            <span className="ml-1 font-semibold">{counts.walkInTotal}</span>
          </button>
          <button
            type="button"
            onClick={() => setSp((p) => (p.set("tab", "delivery"), p))}
            className={tabButtonClass(tab === "delivery")}
          >
            Delivery{" "}
            <span className="ml-1 font-semibold">{counts.deliveryTotal}</span>
          </button>
        </div>

        {showWalkIn ? (
          <SoTCard className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-medium text-slate-800">
                  Walk-in (Cashier → Manager)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  PICKUP orders na{" "}
                  <span className="font-medium">
                    PARTIALLY_PAID + released with balance
                  </span>
                  .
                </p>
              </div>
              <SoTStatusBadge tone="info">
                {walkIn.length} shown
                {counts.walkInTotal > walkIn.length
                  ? ` / ${counts.walkInTotal}`
                  : ""}
              </SoTStatusBadge>
            </div>

            <SoTTable>
              <SoTTableHead>
                <SoTTableRow className="border-t-0">
                  <SoTTh>Order</SoTTh>
                  <SoTTh>Customer</SoTTh>
                  <SoTTh align="right">Frozen</SoTTh>
                  <SoTTh align="right">Paid</SoTTh>
                  <SoTTh align="right">Balance</SoTTh>
                  <SoTTh align="right">Action</SoTTh>
                </SoTTableRow>
              </SoTTableHead>
              <tbody>
                {walkIn.length === 0 ? (
                  <SoTTableEmptyRow
                    colSpan={6}
                    message="No walk-in clearance items."
                  />
                ) : (
                  walkIn.map((o) => (
                    <SoTTableRow key={o.caseId}>
                      <SoTTd>
                        <div className="font-mono text-sm font-semibold text-indigo-700">
                          {o.orderCode}
                        </div>
                      </SoTTd>
                      <SoTTd>
                        <div className="text-sm text-slate-800">{o.customerLabel}</div>
                        {o.releasedApprovedBy ? (
                          <div className="text-xs text-slate-500">
                            releasedBy {o.releasedApprovedBy}
                          </div>
                        ) : null}
                      </SoTTd>
                      <SoTTd align="right" className="tabular-nums">
                        {peso(o.frozenTotal)}
                      </SoTTd>
                      <SoTTd align="right" className="tabular-nums">
                        {peso(o.paidSoFar)}
                      </SoTTd>
                      <SoTTd align="right">
                        <SoTStatusBadge tone="warning">{peso(o.balance)}</SoTStatusBadge>
                      </SoTTd>
                      <SoTTd align="right">
                        <Link
                          to={`/store/clearance/${o.caseId}`}
                          className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                        >
                          Open case
                        </Link>
                      </SoTTd>
                    </SoTTableRow>
                  ))
                )}
              </tbody>
            </SoTTable>
          </SoTCard>
        ) : null}

        {showDelivery ? (
          <SoTCard className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-medium text-slate-800">
                  Delivery (Run receipts → Manager)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  CHECKED_IN runs na may receipt na{" "}
                  <span className="font-medium">
                    cashCollected &lt; frozen total
                  </span>
                  .
                </p>
              </div>
              <SoTStatusBadge tone="info">
                {delivery.length} shown
                {counts.deliveryTotal > delivery.length
                  ? ` / ${counts.deliveryTotal}`
                  : ""}
              </SoTStatusBadge>
            </div>

            <SoTTable>
              <SoTTableHead>
                <SoTTableRow className="border-t-0">
                  <SoTTh>Run</SoTTh>
                  <SoTTh>Receipt</SoTTh>
                  <SoTTh>Customer</SoTTh>
                  <SoTTh align="right">Frozen</SoTTh>
                  <SoTTh align="right">Cash</SoTTh>
                  <SoTTh align="right">Balance</SoTTh>
                  <SoTTh align="right">Action</SoTTh>
                </SoTTableRow>
              </SoTTableHead>
              <tbody>
                {delivery.length === 0 ? (
                  <SoTTableEmptyRow
                    colSpan={7}
                    message="No delivery clearance items."
                  />
                ) : (
                  delivery.map((r) => (
                    <SoTTableRow key={r.caseId}>
                      <SoTTd>
                        <div className="font-mono text-sm font-semibold text-indigo-700">
                          {r.runCode}
                        </div>
                      </SoTTd>
                      <SoTTd>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-slate-700">
                            {r.receiptKey}
                          </span>
                          <SoTStatusBadge tone="neutral">{r.kind}</SoTStatusBadge>
                        </div>
                      </SoTTd>
                      <SoTTd>
                        <div className="text-sm text-slate-800">{r.customerLabel}</div>
                      </SoTTd>
                      <SoTTd align="right" className="tabular-nums">
                        {peso(r.frozenTotal)}
                      </SoTTd>
                      <SoTTd align="right" className="tabular-nums">
                        {peso(r.cashCollected)}
                      </SoTTd>
                      <SoTTd align="right">
                        <SoTStatusBadge tone="warning">{peso(r.balance)}</SoTStatusBadge>
                      </SoTTd>
                      <SoTTd align="right">
                        <Link
                          to={`/store/clearance/${r.caseId}`}
                          className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                        >
                          Open case
                        </Link>
                      </SoTTd>
                    </SoTTableRow>
                  ))
                )}
              </tbody>
            </SoTTable>
          </SoTCard>
        ) : null}
      </div>
    </main>
  );
}
