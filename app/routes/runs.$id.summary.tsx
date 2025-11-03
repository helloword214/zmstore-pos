/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";

import { db } from "~/utils/db.server";

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
    status: "PLANNED" | "DISPATCHED" | "CLOSED" | "CANCELLED";
    riderLabel: string | null;
  };
  rows: Row[];
  totals: {
    loaded: number;
    sold: number;
    returned: number;
    delta: number;
    balanced: boolean;
    cash: number;
    ar: number;
  };
};

export async function loader({ params }: LoaderFunctionArgs) {
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
    },
  });
  if (!run) throw new Response("Not found", { status: 404 });

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
          totalBeforeDiscount: true,
          items: { select: { productId: true, name: true, qty: true } },
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
    // sold qty by product
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
    // payments / AR
    const paid = (o.payments ?? []).reduce(
      (s, p) => s + Number(p.amount || 0),
      0
    );
    cash += paid;
    const due = Math.max(0, Number(o.totalBeforeDiscount || 0) - paid);
    ar += due;
  }

  // Merge into rows
  const allPids = new Set<number>([
    ...Array.from(loadedMap.keys()),
    ...Array.from(soldMap.keys()),
    ...Array.from(returnedMap.keys()),
  ]);
  const rows: Row[] = Array.from(allPids).map((pid) => ({
    productId: pid,
    name: loadedMap.get(pid)?.name || soldMap.get(pid)?.name || `#${pid}`,
    loaded: loadedMap.get(pid)?.qty || 0,
    sold: soldMap.get(pid)?.qty || 0,
    returned: returnedMap.get(pid) || 0,
  }));

  // Totals & balance
  const totalsLoaded = rows.reduce((s, r) => s + r.loaded, 0);
  const totalsSold = rows.reduce((s, r) => s + r.sold, 0);
  const totalsReturned = rows.reduce((s, r) => s + r.returned, 0);
  const delta = totalsLoaded - (totalsSold + totalsReturned);
  const balanced = delta === 0;

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
      balanced,
      cash: Math.round(cash * 100) / 100,
      ar: Math.round(ar * 100) / 100,
    },
  });
}

type ActionData = { ok: true } | { ok: false; error: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id))
    return json<ActionData>(
      { ok: false, error: "Invalid ID" },
      { status: 400 }
    );
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  if (intent !== "close") return redirect(`/runs/${id}/summary`);

  // Recompute balance server-side (same guards as loader)
  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: { id: true, status: true, loadoutSnapshot: true },
  });
  if (!run)
    return json<ActionData>({ ok: false, error: "Not found" }, { status: 404 });
  if (run.status === "CLOSED") return redirect(`/runs/${id}/summary`);

  const loadedMap = new Map<number, number>();
  const snap = Array.isArray(run.loadoutSnapshot)
    ? (run.loadoutSnapshot as any[])
    : [];
  if (snap.length > 0) {
    for (const row of snap) {
      const pid = Number(row?.productId);
      const qty = Math.max(0, Math.floor(Number(row?.qty ?? 0)));
      if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue;
      loadedMap.set(pid, (loadedMap.get(pid) || 0) + qty);
    }
  } else {
    const outs = await db.stockMovement.findMany({
      where: { refKind: "RUN", refId: id, type: "LOADOUT_OUT" },
      select: { productId: true, qty: true },
    });
    for (const m of outs) {
      const pid = Number(m.productId);
      const qty = Math.max(0, Math.floor(Number(m.qty || 0)));
      if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue;
      loadedMap.set(pid, (loadedMap.get(pid) || 0) + qty);
    }
  }
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
  const links = await db.deliveryRunOrder.findMany({
    where: { runId: id },
    include: {
      order: { select: { items: { select: { productId: true, qty: true } } } },
    },
  });
  const soldMap = new Map<number, number>();
  for (const L of links) {
    for (const it of L.order?.items ?? []) {
      const pid = Number(it.productId);
      const qty = Math.max(0, Math.floor(Number(it.qty || 0)));
      if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue;
      soldMap.set(pid, (soldMap.get(pid) || 0) + qty);
    }
  }
  let loaded = 0,
    sold = 0,
    returned = 0;
  for (const v of loadedMap.values()) loaded += v;
  for (const v of soldMap.values()) sold += v;
  for (const v of returnedMap.values()) returned += v;
  const delta = loaded - (sold + returned);
  if (delta !== 0) {
    return json<ActionData>(
      { ok: false, error: "Not balanced: Loaded must equal Sold + Returned." },
      { status: 400 }
    );
  }

  await db.deliveryRun.update({
    where: { id },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  return redirect(`/runs/${id}/summary?closed=1`);
}

export default function RunSummaryPage() {
  const { run, rows, totals } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [sp] = useSearchParams();
  const justClosed = sp.get("closed") === "1";
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

        {justClosed && (
          <div
            className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
            role="status"
            aria-live="polite"
          >
            Run closed. Dispatch & remit are now locked.
          </div>
        )}
        {run.status === "CLOSED" && !justClosed && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            View-only: this run is closed.
          </div>
        )}

        {actionData && !actionData.ok && (
          <div
            className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            role="alert"
            aria-live="polite"
          >
            {actionData.error}
          </div>
        )}

        <div className="grid gap-4">
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Cash collected</div>
              <div className="text-lg font-semibold">{peso(totals.cash)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">A/R created</div>
              <div className="text-lg font-semibold">{peso(totals.ar)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-500">Balance</div>
              <div
                className={`text-lg font-semibold ${
                  totals.balanced ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {totals.balanced ? "Balanced" : `Δ ${totals.delta}`}
              </div>
            </div>
          </div>

          {run.status !== "CLOSED" && (
            <div className="flex items-center justify-end">
              <Form method="post" replace>
                <button
                  name="intent"
                  value="close"
                  disabled={busy || !totals.balanced}
                  onClick={(e) => {
                    if (
                      !window.confirm(
                        "Close run? This will lock dispatch/remit and finalize returns."
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                  className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm disabled:opacity-50"
                >
                  {busy ? "Closing…" : "Close Run"}
                </button>
              </Form>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
