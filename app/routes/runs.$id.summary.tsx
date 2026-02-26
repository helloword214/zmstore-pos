// app/routes/runs.$id.summary.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
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
import { loadRunRecap } from "~/services/runRecap.server";
import { r2 as r2Money } from "~/utils/money";

const r2 = (n: number) => r2Money(Number(n) || 0);
const MONEY_EPS = 0.009;

const isVoidedNote = (note: unknown) =>
  typeof note === "string" && note.trim().toUpperCase().startsWith("VOIDED:");

type RunStatus =
  | "PLANNED"
  | "DISPATCHED"
  | "CHECKED_IN"
  | "CLOSED"
  | "SETTLED"
  | "CANCELLED";

type Row = {
  productId: number;
  name: string;
  loaded: number;
  sold: number;
  returned: number;
};

type DecisionKindUI =
  | "APPROVE_OPEN_BALANCE"
  | "APPROVE_DISCOUNT_OVERRIDE"
  | "APPROVE_HYBRID"
  | "REJECT";

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: RunStatus;
    riderLabel: string | null;
  };
  rows: Row[];
  totals: {
    loaded: number;
    sold: number;
    returned: number;
    delta: number;
    cash: number;
    ar: number;
    systemDiscount: number;
    overrideDiscount: number;
  };
  counts: {
    parentOrders: number;
    runReceipts: number;
    clearancePending: number;
    clearanceDecided: number;
    clearanceApproved: number;
    clearanceRejected: number;
    clearanceVoided: number;
  };
  amounts: {
    pendingClearance: number;
    rejectedUnresolved: number;
  };
  ui: {
    isFinalized: boolean;
    stageLabel: string;
    stageNote: string;
  };
  role: string;
};

type CaseInfo = {
  status: "NEEDS_CLEARANCE" | "DECIDED";
  decisionKind: DecisionKindUI | null;
  arBalance: number;
  overrideDiscount: number;
};

const sumLineDiscountTotal = (
  lines: Array<{ qty: unknown; discountAmount?: unknown | null }>,
) =>
  r2(
    (lines || []).reduce((sum, ln) => {
      const qty = Math.max(0, Number(ln.qty ?? 0));
      const disc = Math.max(0, Number(ln.discountAmount ?? 0));
      return sum + qty * disc;
    }, 0),
  );

const parseDecisionKind = (raw: unknown): DecisionKindUI | null =>
  raw === "REJECT"
    ? "REJECT"
    : raw === "APPROVE_OPEN_BALANCE"
      ? "APPROVE_OPEN_BALANCE"
      : raw === "APPROVE_DISCOUNT_OVERRIDE"
        ? "APPROVE_DISCOUNT_OVERRIDE"
        : raw === "APPROVE_HYBRID"
          ? "APPROVE_HYBRID"
          : null;

const stageMeta = (status: RunStatus) => {
  if (status === "PLANNED") {
    return {
      stageLabel: "Staging",
      stageNote: "Prepare rider, vehicle, and loadout before dispatch.",
    };
  }
  if (status === "DISPATCHED") {
    return {
      stageLabel: "In Transit",
      stageNote:
        "Quick read mode: loadout is visible. Cash, A/R, and overrides appear after rider check-in.",
    };
  }
  if (status === "CHECKED_IN") {
    return {
      stageLabel: "Checked In",
      stageNote:
        "Rider submitted check-in. Review variances and clearance outcomes before closing.",
    };
  }
  if (status === "CLOSED" || status === "SETTLED") {
    return {
      stageLabel: "Final Report",
      stageNote:
        "Run is finalized. Values below are read-only and decision-aligned.",
    };
  }
  return {
    stageLabel: "Cancelled",
    stageNote: "Run cancelled. Data is shown for traceability.",
  };
};

const applyDecisionFinancial = (remainingRaw: number, c?: CaseInfo) => {
  const remaining = r2(Math.max(0, Number(remainingRaw || 0)));
  if (remaining <= MONEY_EPS) {
    return { ar: 0, overrideDiscount: 0, pending: 0, rejected: 0 };
  }

  if (!c) {
    return { ar: remaining, overrideDiscount: 0, pending: 0, rejected: 0 };
  }

  if (c.status === "NEEDS_CLEARANCE") {
    return { ar: 0, overrideDiscount: 0, pending: remaining, rejected: 0 };
  }

  if (c.decisionKind === "REJECT") {
    return { ar: 0, overrideDiscount: 0, pending: 0, rejected: remaining };
  }

  if (c.decisionKind === "APPROVE_DISCOUNT_OVERRIDE") {
    const override =
      c.overrideDiscount > MONEY_EPS
        ? r2(Math.min(remaining, c.overrideDiscount))
        : remaining;
    return { ar: 0, overrideDiscount: override, pending: 0, rejected: 0 };
  }

  if (c.decisionKind === "APPROVE_HYBRID") {
    const ar =
      c.arBalance > MONEY_EPS ? r2(Math.min(remaining, c.arBalance)) : 0;
    const override =
      c.overrideDiscount > MONEY_EPS
        ? r2(Math.min(remaining, c.overrideDiscount))
        : r2(Math.max(0, remaining - ar));
    return { ar, overrideDiscount: override, pending: 0, rejected: 0 };
  }

  const ar =
    c.arBalance > MONEY_EPS ? r2(Math.min(remaining, c.arBalance)) : remaining;
  return { ar, overrideDiscount: 0, pending: 0, rejected: 0 };
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["ADMIN", "STORE_MANAGER", "EMPLOYEE"]);
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const { getFrozenPricingFromOrder } = await import("~/services/frozenPricing.server");

  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: {
      id: true,
      runCode: true,
      status: true,
      riderId: true,
      loadoutSnapshot: true,
      riderCheckinSnapshot: true,
      receipts: {
        select: {
          id: true,
          kind: true,
          receiptKey: true,
          cashCollected: true,
          note: true,
          parentOrderId: true,
          lines: {
            select: {
              productId: true,
              name: true,
              qty: true,
              unitPrice: true,
              lineTotal: true,
              discountAmount: true,
            },
            orderBy: { id: "asc" },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!run) throw new Response("Not found", { status: 404 });

  const runStatus = run.status as RunStatus;
  const isFinalized =
    runStatus === "CHECKED_IN" || runStatus === "CLOSED" || runStatus === "SETTLED";

  const recap = isFinalized
    ? await loadRunRecap(db, id)
    : { recapRows: [] as any[], hasDiffIssues: false };

  const rawSnap = run.riderCheckinSnapshot as any;
  const parentPaymentMap = new Map<number, number>();
  const parentVoidedMap = new Map<number, boolean>();
  const voidedReceiptKeys = new Set<string>();

  for (const r of run.receipts || []) {
    const rk = String(r.receiptKey || `${r.kind}:${r.id}`).slice(0, 64);
    if (isVoidedNote(r.note)) {
      voidedReceiptKeys.add(rk);
      if (r.kind === "PARENT" && r.parentOrderId) {
        parentVoidedMap.set(Number(r.parentOrderId), true);
      }
    }

    if (r.kind !== "PARENT") continue;
    if (!r.parentOrderId) continue;

    const oid = Number(r.parentOrderId);
    if (!Number.isFinite(oid) || oid <= 0) continue;

    const cash = Number(r.cashCollected ?? 0);
    const add = cash > 0 ? cash : 0;
    parentPaymentMap.set(oid, r2((parentPaymentMap.get(oid) || 0) + add));
  }

  if (rawSnap && typeof rawSnap === "object" && Array.isArray(rawSnap.parentPayments)) {
    for (const row of rawSnap.parentPayments) {
      const oid = Number(row?.orderId ?? 0);
      if (!oid) continue;
      if (parentPaymentMap.has(oid)) continue;
      const amt = Number(row?.cashCollected ?? 0);
      if (!Number.isFinite(amt) || amt < 0) continue;
      parentPaymentMap.set(oid, r2(amt));
    }
  }

  let riderLabel: string | null = null;
  if (run.riderId) {
    const r = await db.employee.findUnique({
      where: { id: run.riderId },
      select: { firstName: true, lastName: true, alias: true },
    });
    riderLabel =
      (r?.alias?.trim() || [r?.firstName, r?.lastName].filter(Boolean).join(" ") || null) ??
      null;
  }

  const links = await db.deliveryRunOrder.findMany({
    where: { runId: id },
    include: {
      order: {
        select: {
          id: true,
          orderCode: true,
          subtotal: true,
          totalBeforeDiscount: true,
          items: {
            select: {
              productId: true,
              qty: true,
              unitPrice: true,
              lineTotal: true,
              baseUnitPrice: true,
              discountAmount: true,
              unitKind: true,
            },
          },
        },
      },
    },
  });

  const cases = await db.clearanceCase.findMany({
    where: {
      runId: id,
      status: { in: ["NEEDS_CLEARANCE", "DECIDED"] },
    } as any,
    select: {
      receiptKey: true,
      status: true,
      decisions: {
        select: {
          kind: true,
          arBalance: true,
          overrideDiscountApproved: true,
        },
        orderBy: { id: "desc" },
        take: 1,
      },
    },
  });

  let clearancePending = 0;
  let clearanceDecided = 0;
  let clearanceApproved = 0;
  let clearanceRejected = 0;

  const caseByReceiptKey = new Map<string, CaseInfo>();
  for (const c of cases || []) {
    const rk = String((c as any).receiptKey || "").slice(0, 64);
    if (!rk) continue;

    const status = String((c as any).status || "");
    if (status !== "NEEDS_CLEARANCE" && status !== "DECIDED") continue;

    const d = (c as any)?.decisions?.[0];
    const decisionKind = parseDecisionKind(d?.kind);
    if (status === "NEEDS_CLEARANCE") {
      clearancePending += 1;
    } else {
      clearanceDecided += 1;
      if (decisionKind === "REJECT") {
        clearanceRejected += 1;
      } else if (decisionKind) {
        clearanceApproved += 1;
      }
    }

    caseByReceiptKey.set(rk, {
      status,
      decisionKind,
      arBalance: r2(Math.max(0, Number(d?.arBalance ?? 0))),
      overrideDiscount: r2(Math.max(0, Number(d?.overrideDiscountApproved ?? 0))),
    });
  }

  let preRows: Row[] = [];
  if (!isFinalized) {
    const snapRaw = run.loadoutSnapshot as any;
    const items = Array.isArray(snapRaw)
      ? snapRaw
      : Array.isArray(snapRaw?.items)
        ? snapRaw.items
        : [];
    const loadedByPid = new Map<number, { name: string; loaded: number }>();
    for (const it of items) {
      const pid = Number(it?.productId ?? 0);
      if (!pid) continue;
      const name = String(it?.name ?? `#${pid}`);
      const qty = Math.max(0, Number(it?.qty ?? 0));
      const cur = loadedByPid.get(pid);
      loadedByPid.set(pid, {
        name,
        loaded: (cur?.loaded || 0) + qty,
      });
    }
    preRows = Array.from(loadedByPid.entries())
      .map(([productId, v]) => ({
        productId,
        name: v.name,
        loaded: v.loaded,
        sold: 0,
        returned: 0,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  let cash = 0;
  let ar = 0;
  let systemDiscount = 0;
  let overrideDiscount = 0;
  let pendingClearanceAmount = 0;
  let rejectedUnresolvedAmount = 0;

  for (const rr of run.receipts || []) {
    if (rr.kind !== "ROAD") continue;
    const rk = String(rr.receiptKey || `ROAD:${rr.id}`).slice(0, 64);
    if (voidedReceiptKeys.has(rk)) continue;

    systemDiscount += sumLineDiscountTotal(rr.lines || []);

    if (!isFinalized) continue;

    const total = r2(
      (rr.lines || []).reduce((sum, ln: any) => {
        const qty = Math.max(0, Number(ln.qty ?? 0));
        const up = Math.max(0, Number(ln.unitPrice ?? 0));
        const lt = ln.lineTotal != null ? Number(ln.lineTotal) : qty * up;
        return sum + (Number.isFinite(lt) ? lt : 0);
      }, 0),
    );

    const cashCollected = Math.max(0, Number(rr.cashCollected ?? 0));
    const paid = r2(Math.max(0, Math.min(total, cashCollected)));
    const remaining = r2(Math.max(0, total - paid));

    cash += paid;

    const d = applyDecisionFinancial(remaining, caseByReceiptKey.get(rk));
    ar += d.ar;
    overrideDiscount += d.overrideDiscount;
    pendingClearanceAmount += d.pending;
    rejectedUnresolvedAmount += d.rejected;
  }

  for (const L of links) {
    const o = L.order;
    if (!o) continue;

    const isRoadside = !!o.orderCode && o.orderCode.startsWith("RS-");
    if (isRoadside) continue;

    const orderKey = `PARENT:${o.id}`;
    if (voidedReceiptKeys.has(orderKey) || parentVoidedMap.get(o.id)) continue;

    const orderItems = (o.items || []).map((it: any) => ({
      qty: Number(it.qty ?? 0),
      unitKind: it.unitKind === "RETAIL" ? "RETAIL" : "PACK",
      baseUnitPrice: Number(it.baseUnitPrice ?? it.unitPrice ?? 0),
      unitPrice: Number(it.unitPrice ?? 0),
      discountAmount: Number(it.discountAmount ?? 0),
      lineTotal: Number(it.lineTotal ?? 0),
    }));

    systemDiscount += sumLineDiscountTotal(
      (o.items || []).map((it: any) => ({
        qty: it.qty,
        discountAmount: it.discountAmount,
      })),
    );

    if (!isFinalized) continue;

    const fp = getFrozenPricingFromOrder({
      id: Number(o.id),
      subtotal: (o as any).subtotal,
      totalBeforeDiscount: (o as any).totalBeforeDiscount,
      items: orderItems,
    });
    const orderTotal = r2(Math.max(0, Number(fp.computedSubtotal || 0)));

    const rawCash = Number(parentPaymentMap.get(o.id) || 0);
    const paid = r2(Math.max(0, Math.min(orderTotal, rawCash)));
    const remaining = r2(Math.max(0, orderTotal - paid));

    cash += paid;

    const d = applyDecisionFinancial(remaining, caseByReceiptKey.get(orderKey));
    ar += d.ar;
    overrideDiscount += d.overrideDiscount;
    pendingClearanceAmount += d.pending;
    rejectedUnresolvedAmount += d.rejected;
  }

  const rows: Row[] = isFinalized
    ? recap.recapRows
        .slice()
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((r) => ({
          productId: r.productId,
          name: r.name,
          loaded: r.loaded,
          sold: r.sold,
          returned: r.returned,
        }))
    : preRows;

  const totalsLoaded = rows.reduce((s, r) => s + (Number(r.loaded) || 0), 0);
  const totalsSold = rows.reduce((s, r) => s + (Number(r.sold) || 0), 0);
  const totalsReturned = rows.reduce((s, r) => s + (Number(r.returned) || 0), 0);
  const delta = rows.reduce(
    (s, r) => s + (Number(r.loaded) - (Number(r.sold) + Number(r.returned))),
    0,
  );

  const { stageLabel, stageNote } = stageMeta(runStatus);

  return json<LoaderData>({
    run: {
      id: run.id,
      runCode: run.runCode,
      status: runStatus,
      riderLabel,
    },
    rows,
    totals: {
      loaded: totalsLoaded,
      sold: totalsSold,
      returned: totalsReturned,
      delta,
      cash: r2(cash),
      ar: r2(ar),
      systemDiscount: r2(systemDiscount),
      overrideDiscount: r2(overrideDiscount),
    },
    counts: {
      parentOrders: links.length,
      runReceipts: (run.receipts || []).length,
      clearancePending,
      clearanceDecided,
      clearanceApproved,
      clearanceRejected,
      clearanceVoided: voidedReceiptKeys.size,
    },
    amounts: {
      pendingClearance: r2(pendingClearanceAmount),
      rejectedUnresolved: r2(rejectedUnresolvedAmount),
    },
    ui: { isFinalized, stageLabel, stageNote },
    role: me.role,
  });
}

function MetricCard({
  label,
  value,
  tone = "slate",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "slate" | "emerald" | "amber" | "rose" | "indigo";
  hint?: string;
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "rose"
          ? "text-rose-700"
          : tone === "indigo"
            ? "text-indigo-700"
            : "text-slate-900";

  return (
    <SoTCard compact>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div> : null}
    </SoTCard>
  );
}

function SmallCard({ label, value }: { label: string; value: string | number }) {
  return (
    <SoTCard compact className="rounded-xl px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 font-semibold tabular-nums text-slate-900">{value}</div>
    </SoTCard>
  );
}

export default function RunSummaryPage() {
  const { run, rows, totals, counts, amounts, role, ui } = useLoaderData<LoaderData>();
  const [sp] = useSearchParams();
  const justPosted = sp.get("posted") === "1";
  const backHref = role === "EMPLOYEE" ? "/rider" : "/store";
  const backLabel = "Dashboard";
  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const stageTone = (
    status: RunStatus,
  ): "neutral" | "info" | "success" | "warning" | "danger" =>
    status === "CLOSED" || status === "SETTLED"
      ? "success"
      : status === "CHECKED_IN"
        ? "info"
        : status === "DISPATCHED" || status === "PLANNED"
          ? "warning"
          : status === "CANCELLED"
            ? "danger"
            : "neutral";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Run Summary Report"
        subtitle={`Run ${run.runCode}${run.riderLabel ? ` • Rider ${run.riderLabel}` : ""} • ${run.status}`}
        backTo={backHref}
        backLabel={backLabel}
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl px-5 py-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Run Snapshot</h2>
              <div className="mt-1 text-sm text-slate-600">
                Run <span className="font-mono font-medium text-indigo-700">{run.runCode}</span>
                {run.riderLabel ? <span className="ml-2">• Rider: {run.riderLabel}</span> : null}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <SoTStatusBadge tone={stageTone(run.status)}>{run.status}</SoTStatusBadge>
              <SoTStatusBadge>{ui.stageLabel}</SoTStatusBadge>
            </div>
          </div>
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {ui.stageNote}
          </p>
        </section>

        {justPosted ? (
          <SoTAlert tone="success" className="mt-3 text-sm" role="status" aria-live="polite">
            Run remit posted. This run is now closed and read-only.
          </SoTAlert>
        ) : null}

        <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Loaded" value={totals.loaded} />
          <MetricCard label="Sold" value={totals.sold} />
          <MetricCard label="Returned" value={totals.returned} />
          <MetricCard
            label="Variance (Δ)"
            value={totals.delta}
            tone={totals.delta === 0 ? "slate" : "rose"}
          />
          <MetricCard label="Cash Collected" value={peso(totals.cash)} tone="emerald" />
          <MetricCard label="Outstanding A/R" value={peso(totals.ar)} tone="amber" />
          <MetricCard
            label="System Discount"
            value={peso(totals.systemDiscount)}
            hint="Frozen line discounts"
          />
          <MetricCard
            label="Override Discount"
            value={peso(totals.overrideDiscount)}
            tone="indigo"
            hint="Manager-approved"
          />
        </section>

        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800">Quick Read Snapshot</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <SmallCard label="Parent Orders" value={counts.parentOrders} />
            <SmallCard label="Run Receipts" value={counts.runReceipts} />
            <SmallCard label="Pending Clearance" value={counts.clearancePending} />
            <SmallCard label="Decided Clearance" value={counts.clearanceDecided} />
            <SmallCard label="Approved Decisions" value={counts.clearanceApproved} />
            <SmallCard label="Rejected Decisions" value={counts.clearanceRejected} />
            <SmallCard label="Voided Receipts" value={counts.clearanceVoided} />
            <SmallCard label="Pending Amount" value={peso(amounts.pendingClearance)} />
          </div>
          {amounts.rejectedUnresolved > MONEY_EPS ? (
            <SoTAlert tone="danger" className="mt-3 text-sm">
              Rejected unresolved amount: <span className="font-mono">{peso(amounts.rejectedUnresolved)}</span>
            </SoTAlert>
          ) : null}
          {!ui.isFinalized ? (
            <div className="mt-3 text-[11px] text-slate-500">
              Final cash, A/R, and override discount settle after rider check-in and manager decision.
            </div>
          ) : (
            <div className="mt-3 text-[11px] text-slate-500">
              A/R and override discount are computed from clearance decisions per receipt/order.
            </div>
          )}
        </section>

        <section className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h2 className="text-sm font-medium text-slate-800">Stock Movement</h2>
          </div>
          <SoTTable>
            <SoTTableHead className="bg-white">
              <tr>
                <SoTTh>Product</SoTTh>
                <SoTTh align="right">Loaded</SoTTh>
                <SoTTh align="right">Sold</SoTTh>
                <SoTTh align="right">Returned</SoTTh>
                <SoTTh align="right">Δ</SoTTh>
              </tr>
            </SoTTableHead>
            <tbody>
              {rows.length === 0 ? (
                <SoTTableEmptyRow
                  colSpan={5}
                  message={
                    run.status === "DISPATCHED"
                      ? "No loadout rows found yet. Confirm dispatch loadout snapshot."
                      : "No data."
                  }
                />
              ) : (
                rows.map((r) => {
                  const delta = r.loaded - (r.sold + r.returned);
                  return (
                    <SoTTableRow key={r.productId}>
                      <SoTTd>{r.name}</SoTTd>
                      <SoTTd align="right" className="tabular-nums">{r.loaded}</SoTTd>
                      <SoTTd align="right" className="tabular-nums">{r.sold}</SoTTd>
                      <SoTTd align="right" className="tabular-nums">{r.returned}</SoTTd>
                      <SoTTd
                        align="right"
                        className={`tabular-nums ${delta === 0 ? "text-slate-500" : "text-rose-600"}`}
                      >
                        {delta}
                      </SoTTd>
                    </SoTTableRow>
                  );
                })
              )}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr className="border-t border-slate-200">
                <SoTTd className="font-medium">Totals</SoTTd>
                <SoTTd align="right" className="font-semibold tabular-nums">{totals.loaded}</SoTTd>
                <SoTTd align="right" className="font-semibold tabular-nums">{totals.sold}</SoTTd>
                <SoTTd align="right" className="font-semibold tabular-nums">{totals.returned}</SoTTd>
                <SoTTd
                  align="right"
                  className={`font-semibold tabular-nums ${
                    totals.delta === 0 ? "text-slate-600" : "text-rose-600"
                  }`}
                >
                  {totals.delta}
                </SoTTd>
              </tr>
            </tfoot>
          </SoTTable>
        </section>
      </div>
    </main>
  );
}
