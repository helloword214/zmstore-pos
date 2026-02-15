/* app/routes/store.clearance.tsx */
/* STORE MANAGER — Commercial Clearance Inbox (Walk-in + Delivery) */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";
import * as React from "react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { r2, peso } from "~/utils/money";

type WalkInRow = {
  // CCS SoT: inbox item identity is ClearanceCase
  caseId: number;
  orderId: number;
  orderCode: string;
  status: string;
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
  runId: number;
  runCode: string;
  receiptId: number;
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
      origin: true,
      flaggedAt: true,
      note: true,
      frozenTotal: true,
      cashCollected: true,
      orderId: true,
      runId: true,
      runReceiptId: true,

      order: {
        select: {
          id: true,
          orderCode: true,
          status: true,
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
        status: String(o.status ?? ""),
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
        runId: Number(r.run?.id ?? r.runId),
        runCode: String(r.run?.runCode ?? `RUN#${r.runId}`),
        receiptId: Number(r.id),
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

function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "amber" | "indigo";
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "indigo"
      ? "border-indigo-200 bg-indigo-50 text-indigo-800"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}
    >
      {children}
    </span>
  );
}

export default function StoreClearanceInbox() {
  const { walkIn, delivery, counts } = useLoaderData<LoaderData>();
  const [sp, setSp] = useSearchParams();
  const tab = String(sp.get("tab") || "all"); // all | walkin | delivery

  const showWalkIn = tab === "all" || tab === "walkin";
  const showDelivery = tab === "all" || tab === "delivery";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-6xl px-5 py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-900">
              Commercial Clearance — Inbox
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Unified list ng{" "}
              <span className="font-medium">
                kulang bayad / utang / release with balance
              </span>{" "}
              (walk-in + delivery). Manager decision layer ito — walang posting
              ng remit dito.
            </p>
          </div>
          <Link to="/store" className="text-sm text-indigo-600 hover:underline">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSp((p) => (p.set("tab", "all"), p))}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium shadow-sm border ${
              tab === "all"
                ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            All <span className="ml-1 font-semibold">{counts.total}</span>
          </button>
          <button
            type="button"
            onClick={() => setSp((p) => (p.set("tab", "walkin"), p))}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium shadow-sm border ${
              tab === "walkin"
                ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            Walk-in{" "}
            <span className="ml-1 font-semibold">{counts.walkInTotal}</span>
          </button>
          <button
            type="button"
            onClick={() => setSp((p) => (p.set("tab", "delivery"), p))}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium shadow-sm border ${
              tab === "delivery"
                ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            Delivery{" "}
            <span className="ml-1 font-semibold">{counts.deliveryTotal}</span>
          </button>
        </div>

        {showWalkIn ? (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
              <Pill tone="indigo">
                {walkIn.length} shown
                {counts.walkInTotal > walkIn.length
                  ? ` / ${counts.walkInTotal}`
                  : ""}
              </Pill>
            </div>

            <div className="divide-y divide-slate-100">
              {walkIn.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">
                  No walk-in clearance items.
                </div>
              ) : (
                walkIn.map((o) => (
                  <div key={o.caseId} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900">
                          <span className="font-mono text-indigo-700">
                            {o.orderCode}
                          </span>{" "}
                          <Pill tone="amber">balance {peso(o.balance)}</Pill>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-600">
                          {o.customerLabel}
                          {o.releasedApprovedBy ? (
                            <span className="ml-2 text-slate-500">
                              • releasedBy {o.releasedApprovedBy}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Frozen {peso(o.frozenTotal)} • Paid{" "}
                          {peso(o.paidSoFar)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link
                          to={`/store/clearance/${o.caseId}`}
                          className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                        >
                          Open case →
                        </Link>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}

        {showDelivery ? (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
              <Pill tone="indigo">
                {delivery.length} shown
                {counts.deliveryTotal > delivery.length
                  ? ` / ${counts.deliveryTotal}`
                  : ""}
              </Pill>
            </div>

            <div className="divide-y divide-slate-100">
              {delivery.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">
                  No delivery clearance items.
                </div>
              ) : (
                delivery.map((r) => (
                  <div key={r.caseId} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900">
                          <span className="font-mono text-indigo-700">
                            {r.runCode}
                          </span>{" "}
                          <Pill tone="slate">{r.kind}</Pill>{" "}
                          <Pill tone="amber">balance {peso(r.balance)}</Pill>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-600">
                          {r.customerLabel} •{" "}
                          <span className="font-mono">{r.receiptKey}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Frozen {peso(r.frozenTotal)} • Cash{" "}
                          {peso(r.cashCollected)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Link
                          to={`/store/clearance/${r.caseId}`}
                          className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                        >
                          Open case →
                        </Link>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
