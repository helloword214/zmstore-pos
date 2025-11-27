// app/routes/runs.$id.summary.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

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
  role: string;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["ADMIN", "STORE_MANAGER", "EMPLOYEE"]); // 🔒 guard
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: {
      id: true,
      runCode: true,
      status: true,
      riderId: true,
      loadoutSnapshot: true,
      riderCheckinSnapshot: true,
    },
  });
  if (!run) throw new Response("Not found", { status: 404 });

  // ─────────────────────────────────────────────────────────────
  // Rider check-in snapshot: parent overrides, payments, quick sales
  // ─────────────────────────────────────────────────────────────
  const rawSnap = run.riderCheckinSnapshot as any;
  const parentOverrideMap = new Map<number, boolean>(); // orderId -> isCredit
  const parentPaymentMap = new Map<number, number>(); // orderId -> cashCollected
  let soldRowsSnap: any[] = [];

  if (rawSnap && typeof rawSnap === "object") {
    if (Array.isArray(rawSnap.parentOverrides)) {
      for (const row of rawSnap.parentOverrides) {
        const oid = Number(row?.orderId ?? 0);
        if (!oid) continue;
        parentOverrideMap.set(oid, !!row?.isCredit);
      }
    }
    if (Array.isArray(rawSnap.parentPayments)) {
      for (const row of rawSnap.parentPayments) {
        const oid = Number(row?.orderId ?? 0);
        if (!oid) continue;
        const amt = Number(row?.cashCollected ?? 0);
        if (!Number.isFinite(amt) || amt < 0) continue;
        parentPaymentMap.set(oid, amt);
      }
    }
    if (Array.isArray(rawSnap.soldRows)) {
      soldRowsSnap = rawSnap.soldRows;
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

  // Loaded map (prefer snapshot; fallback to stock movements if snapshot empty)
  const loadedMap = new Map<number, { name: string; qty: number }>();
  const snap = Array.isArray(run.loadoutSnapshot)
    ? (run.loadoutSnapshot as any[])
    : [];
  if (snap.length > 0) {
    for (const row of snap) {
      const pid = Number(row?.productId);
      const name = String(row?.name ?? "");
      const qty = Math.max(0, Math.floor(Number(row?.qty ?? 0)));
      if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue;
      const cur = loadedMap.get(pid) ?? { name, qty: 0 };
      cur.qty += qty;
      cur.name = cur.name || name;
      loadedMap.set(pid, cur);
    }
  } else {
    // Fallback: any LOADOUT_OUT movements logged for this run
    const outs = await db.stockMovement.findMany({
      where: { refKind: "RUN", refId: id, type: "LOADOUT_OUT" },
      select: {
        productId: true,
        qty: true,
        product: { select: { name: true } },
      },
    });
    for (const m of outs) {
      const pid = Number(m.productId);
      const qty = Math.max(0, Math.floor(Number(m.qty || 0)));
      if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue;
      const cur = loadedMap.get(pid) ?? {
        name: m.product?.name ?? `#${pid}`,
        qty: 0,
      };
      cur.qty += qty;
      loadedMap.set(pid, cur);
    }
  }

  // Returned map from RETURN_IN
  const returnedMap = new Map<number, number>();
  const returns = await db.stockMovement.findMany({
    where: { refKind: "RUN", refId: id, type: "RETURN_IN" },
    select: { productId: true, qty: true },
  });
  for (const m of returns) {
    const pid = Number(m.productId);
    const qty = Math.max(0, Math.floor(Number(m.qty || 0)));
    if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue;
    returnedMap.set(pid, (returnedMap.get(pid) || 0) + qty);
  }

  // Linked orders (sold + payments + AR)
  const links = await db.deliveryRunOrder.findMany({
    where: { runId: id },
    include: {
      order: {
        select: {
          id: true,
          status: true,
          isOnCredit: true,
          totalBeforeDiscount: true,
          items: {
            select: {
              productId: true,
              name: true,
              qty: true,
              unitPrice: true, // para consistent sa pricing na ginamit sa POS
            },
          },
          payments: { select: { amount: true } },
        },
      },
    },
  });

  const soldMap = new Map<number, { name: string; qty: number }>();
  let cash = 0;
  let ar = 0;
  for (const L of links) {
    const o = L.order;
    if (!o) continue;

    // sold qty by product (parent POS orders)
    for (const it of o.items) {
      const pid = Number(it.productId);
      const name = String(it.name || "");
      const qty = Math.max(0, Math.floor(Number(it.qty || 0)));
      if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue;
      const cur = soldMap.get(pid) ?? { name, qty: 0 };
      cur.qty += qty;
      cur.name = cur.name || name;
      soldMap.set(pid, cur);
    }

    // CASH ON HAND vs A/R (per run)
    //
    // Logic:
    // - Kung may riderCheckinSnapshot (parentOverrides / parentPayments)
    //   at HINDI pa CLOSED ang run → gamitin yun.
    // - Kapag wala pang check-in snapshot (o CLOSED na) →
    //   fallback sa original isOnCredit behavior.

    // Prefer actual line totals (qty * unitPrice) para aligned sa pricing engine.
    const computedTotal = o.items.reduce((sum, it: any) => {
      const qty = Number(it.qty || 0);
      const up = Number(it.unitPrice || 0);
      if (!Number.isFinite(qty) || !Number.isFinite(up)) return sum;
      return sum + qty * up;
    }, 0);

    const orderTotal =
      (Number.isFinite(computedTotal) && computedTotal > 0
        ? computedTotal
        : Number(o.totalBeforeDiscount || 0)) || 0;

    // Snapshot-based override (only while run is not CLOSED)
    const hasSnapshotControls =
      run.status !== "CLOSED" &&
      (parentOverrideMap.has(o.id) || parentPaymentMap.has(o.id));

    if (hasSnapshotControls) {
      const isCredit = parentOverrideMap.has(o.id)
        ? !!parentOverrideMap.get(o.id)
        : !!o.isOnCredit;

      const rawPaid = parentPaymentMap.get(o.id);
      const paid =
        rawPaid != null
          ? Math.max(0, Math.min(orderTotal, rawPaid))
          : isCredit
          ? 0
          : orderTotal;

      cash += paid;
      if (isCredit) {
        ar += Math.max(0, orderTotal - paid);
      }
    } else {
      // Fallback: original behavior (pre-check-in o CLOSED na)
      if (o.isOnCredit) {
        ar += orderTotal;
      } else {
        cash += orderTotal;
      }
    }
  }

  // 🔹 Idagdag: SOLD qty + CASH / AR galing sa rider snapshot (roadside quick sales)
  //
  // Idea:
  // - Habang hindi pa CLOSED ang run, pwede nating gamitin yung snapshot
  //   (soldRows sa riderCheckinSnapshot) para ipakita agad yung
  //   cash-on-hand ng rider.
  // - Pag CLOSED na, assume na na-post na sa remit/cashier, at
  //   orders/payments na lang ang source of truth.
  if (run.status !== "CLOSED" && soldRowsSnap.length > 0) {
    for (const r of soldRowsSnap) {
      const pid = Number(r?.productId ?? 0);
      const name = String(r?.name ?? "");
      const qty = Math.max(0, Math.floor(Number(r?.qty ?? 0)));
      const unitPrice = Math.max(0, Number(r?.unitPrice ?? 0));
      if (qty <= 0 || unitPrice <= 0) continue;

      const lineTotal = qty * unitPrice;
      const isCredit = !!(r?.onCredit ?? r?.isCredit);

      // 1) qty side: idagdag sa SOLD map para di mawala sa stock recap
      if (pid > 0) {
        const cur = soldMap.get(pid) ?? { name, qty: 0 };
        cur.qty += qty;
        cur.name = cur.name || name;
        soldMap.set(pid, cur);
      }

      // 2) money side: gamitin cashAmount kung CREDIT, para tama ang AR
      if (isCredit) {
        const rawCash = Number(r?.cashAmount ?? 0);
        const paid = Number.isFinite(rawCash)
          ? Math.max(0, Math.min(lineTotal, rawCash))
          : 0;

        cash += paid;
        ar += Math.max(0, lineTotal - paid);
      } else {
        // cash sale → full line total as cash on hand
        cash += lineTotal;
      }
    }
  }

  // Merge into rows
  // Rule:
  // - If may loadoutSnapshot / LOADOUT_OUT: yun ang loaded.
  // - Kung wala (0 or undefined) pero may SOLD / RETURNED:
  //   assume loaded = sold + returned (para hindi magmukhang "sold from 0").
  const allPids = new Set<number>([
    ...Array.from(loadedMap.keys()),
    ...Array.from(soldMap.keys()),
    ...Array.from(returnedMap.keys()),
  ]);
  const rows: Row[] = Array.from(allPids).map((pid) => {
    const loadedEntry = loadedMap.get(pid);
    const soldEntry = soldMap.get(pid);

    const rawLoaded = loadedEntry?.qty ?? 0;
    const sold = soldEntry?.qty ?? 0;
    const returned = returnedMap.get(pid) ?? 0;

    // kung walang na-log na loadout pero may benta/return,
    // gawa tayong inferred loaded = sold + returned
    const loaded =
      rawLoaded > 0 ? rawLoaded : sold + returned > 0 ? sold + returned : 0;

    const name = loadedEntry?.name || soldEntry?.name || `#${pid}`;

    return { productId: pid, name, loaded, sold, returned };
  });

  // Totals & delta
  const totalsLoaded = rows.reduce((s, r) => s + r.loaded, 0);
  const totalsSold = rows.reduce((s, r) => s + r.sold, 0);
  const totalsReturned = rows.reduce((s, r) => s + r.returned, 0);
  const delta = totalsLoaded - (totalsSold + totalsReturned);

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
      cash: Math.round(cash * 100) / 100,
      ar: Math.round(ar * 100) / 100,
    },
    role: me.role,
  });
}

export default function RunSummaryPage() {
  const { run, rows, totals, role } = useLoaderData<LoaderData>();
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
