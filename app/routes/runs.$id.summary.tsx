// app/routes/runs.$id.summary.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { loadRunRecap } from "~/services/runRecap.server";
import { r2 as r2Money } from "~/utils/money";

// Local helper: money rounding (prefer single rounding source)
const r2 = (n: number) => r2Money(Number(n) || 0);

type Row = {
  productId: number;
  name: string;
  loaded: number;
  sold: number;
  returned: number;
};

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: "PLANNED" | "DISPATCHED" | "CHECKED_IN" | "CLOSED" | "CANCELLED";
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
  };
  ui: {
    isFinalized: boolean; // CHECKED_IN or CLOSED
  };
  role: string;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["ADMIN", "STORE_MANAGER", "EMPLOYEE"]); // 🔒 guard
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  // ✅ server-only import (avoid bundling `.server` into client build)
  const { getFrozenPricingFromOrder } = await import(
    "~/services/frozenPricing.server"
  );

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
          cashCollected: true,
          note: true,
          parentOrderId: true,
          customerId: true,
          customerName: true,
          customerPhone: true,
          lines: {
            select: {
              productId: true,
              name: true,
              qty: true,
              unitPrice: true,
              lineTotal: true,
            },
            orderBy: { id: "asc" },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!run) throw new Response("Not found", { status: 404 });

  const isFinalized = run.status === "CHECKED_IN" || run.status === "CLOSED";

  // Qty recap:
  // - Before CHECKED_IN, show LOADED only (Sold/Returned not final yet)
  // - After CHECKED_IN/CLOSED, use recap service (source of truth)
  const recap = isFinalized
    ? await loadRunRecap(db, id)
    : { recapRows: [] as any[], hasDiffIssues: false };

  // ─────────────────────────────────────────────────────────────
  // Parent overrides + payments:
  // Prefer DB RunReceipt(kind=PARENT), fallback snapshot legacy.
  // ─────────────────────────────────────────────────────────────
  const rawSnap = run.riderCheckinSnapshot as any;
  const parentOverrideMap = new Map<number, boolean>(); // orderId -> isCredit
  const parentPaymentMap = new Map<number, number>(); // orderId -> cashCollected
  // 1) DB receipts (PARENT) are manager-grade truth
  for (const r of run.receipts || []) {
    if (r.kind !== "PARENT") continue;
    if (!r.parentOrderId) continue;

    const oid = Number(r.parentOrderId);
    if (!Number.isFinite(oid) || oid <= 0) continue;

    const cash = Number(r.cashCollected ?? 0);
    const add = cash > 0 ? cash : 0;
    parentPaymentMap.set(oid, (parentPaymentMap.get(oid) || 0) + add);
    // IMPORTANT:
    // For PARENT receipts, cashCollected is often 0 during DISPATCHED stage.
    // Do NOT infer credit from cashCollected.
    // Default to CASH unless note explicitly says isCredit=true.
    let isCredit = false;
    try {
      const meta = r.note ? JSON.parse(r.note) : null;
      if (meta && typeof meta.isCredit === "boolean") isCredit = meta.isCredit;
    } catch {}
    parentOverrideMap.set(oid, isCredit);
  }

  // 2) Snapshot fallback (legacy)
  if (rawSnap && typeof rawSnap === "object") {
    if (Array.isArray(rawSnap.parentOverrides)) {
      for (const row of rawSnap.parentOverrides) {
        const oid = Number(row?.orderId ?? 0);
        if (!oid) continue;
        if (!parentOverrideMap.has(oid))
          parentOverrideMap.set(oid, !!row?.isCredit);
      }
    }
    if (Array.isArray(rawSnap.parentPayments)) {
      for (const row of rawSnap.parentPayments) {
        const oid = Number(row?.orderId ?? 0);
        if (!oid) continue;
        if (parentPaymentMap.has(oid)) continue;
        const amt = Number(row?.cashCollected ?? 0);
        if (!Number.isFinite(amt) || amt < 0) continue;
        parentPaymentMap.set(oid, amt);
      }
    }
  }
  // Rider label
  let riderLabel: string | null = null;
  if (run.riderId) {
    const r = await db.employee.findUnique({
      where: { id: run.riderId },
      select: { firstName: true, lastName: true, alias: true },
    });
    riderLabel =
      (r?.alias?.trim() ||
        [r?.firstName, r?.lastName].filter(Boolean).join(" ") ||
        null) ??
      null;
  }

  // Linked orders (sold + payments + AR)
  const links = await db.deliveryRunOrder.findMany({
    where: { runId: id },
    include: {
      order: {
        select: {
          id: true,
          isOnCredit: true,
          orderCode: true,
          subtotal: true,
          totalBeforeDiscount: true,
          customerId: true,
          items: {
            select: {
              productId: true,
              name: true,
              qty: true,
              unitPrice: true, // para consistent sa pricing na ginamit sa POS
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

  // If not finalized, still show LOADED rows from loadoutSnapshot (if available)
  let preRows: Row[] = [];
  if (!isFinalized) {
    const snap = (run as any).loadoutSnapshot as any;
    // NOTE: best-effort parse; keep stable and safe
    const loadedByPid = new Map<number, { name: string; loaded: number }>();
    const items = Array.isArray(snap?.items) ? snap.items : [];
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

  // Money totals
  let cash = 0;
  let ar = 0;

  // ✅ Roadside money SOT: RunReceipt(kind=ROAD)
  // Same logic as remit loader: total = sum(lineTotal), cash = min(total, cashCollected), ar = total - cash
  if (isFinalized) {
    for (const rr of run.receipts || []) {
      if (rr.kind !== "ROAD") continue;
      const cashCollected = Math.max(0, Number(rr.cashCollected ?? 0));
      let receiptIsCredit = cashCollected <= 0;
      try {
        const meta = rr.note ? JSON.parse(rr.note) : null;
        if (meta && typeof meta.isCredit === "boolean")
          receiptIsCredit = meta.isCredit;
      } catch {}

      const total = r2(
        (rr.lines || []).reduce((sum, ln: any) => {
          const qty = Math.max(0, Number(ln.qty ?? 0));
          const up = Math.max(0, Number(ln.unitPrice ?? 0));
          const lt = ln.lineTotal != null ? Number(ln.lineTotal) : qty * up;
          return sum + (Number.isFinite(lt) ? lt : 0);
        }, 0)
      );
      const paid = r2(Math.max(0, Math.min(total, cashCollected)));
      const bal = r2(Math.max(0, total - paid));
      cash += paid;
      // A/R counts if credit OR partial balance remains
      const isCreditEffective = receiptIsCredit || bal > 0.009;
      if (isCreditEffective) ar += bal;
    }
  }

  // parent money from receipts (service) — needs caps based on order totals + credit flag
  for (const L of links) {
    const o = L.order;
    if (!o) continue;
    const isRoadside = !!o.orderCode && o.orderCode.startsWith("RS-");
    if (isRoadside) continue; // roadside money already counted above

    // ✅ Parent/POS totals SOT: frozen OrderItem snapshot (same as remit)
    const fp = getFrozenPricingFromOrder({
      id: Number(o.id),
      subtotal: (o as any).subtotal,
      totalBeforeDiscount: (o as any).totalBeforeDiscount,
      items: (o.items || []).map((it: any) => ({
        qty: Number(it.qty ?? 0),
        unitKind: it.unitKind === "RETAIL" ? "RETAIL" : "PACK",
        baseUnitPrice: Number(it.baseUnitPrice ?? it.unitPrice ?? 0),
        unitPrice: Number(it.unitPrice ?? 0),
        discountAmount: Number(it.discountAmount ?? 0),
        lineTotal: Number(it.lineTotal ?? 0),
      })),
    });
    const orderTotal = fp.computedSubtotal;

    const override = parentOverrideMap.get(o.id);
    const isCredit = override !== undefined ? override : !!o.isOnCredit;

    // ✅ Parent cash SOT: RunReceipt(kind=PARENT).cashCollected sum (already built in parentPaymentMap)
    const rawCash = Number(parentPaymentMap.get(o.id) || 0);
    const paid = Math.max(0, Math.min(orderTotal, rawCash));
    if (isFinalized) cash += paid;
    if (isFinalized && isCredit) ar += Math.max(0, orderTotal - paid);
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

  // Totals & delta
  const totalsLoaded = rows.reduce((s, r) => s + (Number(r.loaded) || 0), 0);
  const totalsSold = rows.reduce((s, r) => s + (Number(r.sold) || 0), 0);
  const totalsReturned = rows.reduce(
    (s, r) => s + (Number(r.returned) || 0),
    0
  );
  const delta = rows.reduce(
    (s, r) => s + (Number(r.loaded) - (Number(r.sold) + Number(r.returned))),
    0
  );

  return json<LoaderData>({
    run: {
      id: run.id,
      runCode: run.runCode,
      status: run.status as any,
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
    },
    ui: { isFinalized },
    role: me.role,
  });
}

export default function RunSummaryPage() {
  const { run, rows, totals, role, ui } = useLoaderData<LoaderData>();
  const [sp] = useSearchParams();
  const justPosted = sp.get("posted") === "1";
  const backHref = role === "EMPLOYEE" ? "/rider" : "/store";
  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl p-5">
        <div className="mb-3">
          <Link
            to={"/runs"}
            className="text-sm text-indigo-600 hover:underline"
          >
            ← Back to Runs
          </Link>
          <Link
            to={backHref}
            className="ml-3 text-sm text-slate-600 hover:underline"
          >
            Back to Dashboard
          </Link>
        </div>

        <header className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-800">
              Run Summary
            </h1>
            <div className="mt-1 text-sm text-slate-500">
              Run{" "}
              <span className="font-mono font-medium text-indigo-700">
                {run.runCode}
              </span>
              {run.riderLabel ? (
                <span className="ml-2">• Rider: {run.riderLabel}</span>
              ) : null}
            </div>
          </div>
          <div className="text-xs">
            <span
              className={`rounded-full border px-2 py-1 ${
                run.status === "CLOSED"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {run.status}
            </span>
          </div>
        </header>

        {justPosted && (
          <div
            className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
            role="status"
            aria-live="polite"
          >
            Run remit posted. This run is now closed and read-only.
          </div>
        )}
        {run.status === "CLOSED" && !justPosted && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            View-only: this run is closed.
          </div>
        )}

        {!ui.isFinalized && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Not finalized yet: this run is still{" "}
            <span className="font-semibold">DISPATCHED</span>. Qty shows{" "}
            <span className="font-semibold">Loaded only</span>. Cash/A-R will
            appear after Rider Check-in.
          </div>
        )}

        <div className="grid gap-4">
          {/* Stock / qty recap */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-right font-medium">Loaded</th>
                  <th className="px-3 py-2 text-right font-medium">Sold</th>
                  <th className="px-3 py-2 text-right font-medium">Returned</th>
                  <th className="px-3 py-2 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-slate-500"
                    >
                      No data.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const delta = r.loaded - (r.sold + r.returned);
                    return (
                      <tr
                        key={r.productId}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2">{r.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.loaded}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.sold}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.returned}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            delta === 0 ? "text-slate-500" : "text-rose-600"
                          }`}
                        >
                          {delta}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr className="border-t border-slate-200">
                  <td className="px-3 py-2 font-medium">Totals</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {totals.loaded}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {totals.sold}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {totals.returned}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold tabular-nums ${
                      totals.delta === 0 ? "text-slate-600" : "text-rose-600"
                    }`}
                  >
                    {totals.delta}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Cash / AR recap */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Cash collected</div>
              <div className="text-lg font-semibold">{peso(totals.cash)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">A/R created</div>
              <div className="text-lg font-semibold">{peso(totals.ar)}</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
