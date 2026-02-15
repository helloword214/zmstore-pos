// app/routes/cashier.delivery._index.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";
import { loadRunReceiptCashMaps } from "~/services/runReceipts.server";

type RunRow = {
  id: number;
  runCode: string;
  status: "PLANNED" | "DISPATCHED" | "CHECKED_IN" | "CLOSED" | "CANCELLED";
  riderLabel: string | null;
  openOrderCount: number;
  // IMPORTANT: run-scope cash to remit (matches Step 2 concept)
  // sum of remaining vs riderCash, NOT full order balance
  openOrderTotal: number;
  lockedByMe: boolean;
  lockedByOther: boolean;
  lockOwnerLabel: string | null;
};

type LoaderData = {
  rows: RunRow[];
};

export async function loader({ request }: LoaderFunctionArgs) {
  // Cashier/admin with open shift lang ang makaka-access
  const me = await requireOpenShift(request);

  // Lock identity for delivery remit:
  //  - per CASHIER user lang (userId), hindi per shift
  //  - para kahit mag logout / magpalit shift, siya pa rin ang may-ari ng lock
  const myToken = String(me.userId);

  // All delivery runs na CLOSED na (tapos na kay store manager)
  // pero may mga DELIVERY orders pa na UNPAID / PARTIALLY_PAID
  const runs = await db.deliveryRun.findMany({
    where: {
      status: "CLOSED",
      orders: {
        some: {
          order: {
            status: { in: ["UNPAID", "PARTIALLY_PAID"] },
          },
        },
      },
    },
    orderBy: { id: "desc" },
    take: 100,
    include: {
      orders: {
        include: {
          order: {
            select: {
              id: true,
              orderCode: true,
              channel: true,
              status: true,
              subtotal: true,
              totalBeforeDiscount: true,
              lockedAt: true,
              // string token: e.g. "123"
              lockedBy: true,
              lockNote: true,
              payments: { select: { amount: true } },
              isOnCredit: true,
            },
          },
        },
      },
    },
  });

  // ─────────────────────────────────────────
  // Resolve cashier labels for lock owners
  // ─────────────────────────────────────────
  const lockOwnerIds = new Set<number>();
  for (const run of runs) {
    for (const ro of run.orders) {
      const o = ro.order as any;
      if (!o) continue;
      if (o.status !== "UNPAID" && o.status !== "PARTIALLY_PAID") continue;
      const token = (o.lockedBy ?? "").trim();
      if (!token) continue;
      const id = Number(token);
      if (!Number.isFinite(id)) continue;
      if (id === me.userId) continue; // sarili hindi na kailangan i-resolve
      lockOwnerIds.add(id);
    }
  }

  let cashierLabelMap = new Map<number, string>();
  if (lockOwnerIds.size > 0) {
    const cashiers = await db.user.findMany({
      where: { id: { in: Array.from(lockOwnerIds) } },
      select: {
        id: true,
        email: true,
        employee: {
          select: { alias: true, firstName: true, lastName: true },
        },
      },
    });
    cashierLabelMap = new Map(
      cashiers.map((u) => {
        const emp = u.employee;
        const label =
          (emp?.alias && emp.alias.trim()) ||
          [emp?.firstName, emp?.lastName].filter(Boolean).join(" ") ||
          u.email ||
          `User #${u.id}`;
        return [u.id, label];
      })
    );
  }

  // Rider labels via employee table kung may riderId
  const riderIds = Array.from(
    new Set(
      runs.map((run) => run.riderId).filter((id): id is number => id != null)
    )
  );

  let riderLabelMap = new Map<number, string>();
  if (riderIds.length > 0) {
    const riders = await db.employee.findMany({
      where: { id: { in: riderIds } },
      select: { id: true, alias: true, firstName: true, lastName: true },
    });
    riderLabelMap = new Map(
      riders.map((r) => {
        const label =
          (r.alias && r.alias.trim()) ||
          [r.firstName, r.lastName].filter(Boolean).join(" ") ||
          `Employee #${r.id}`;
        return [r.id, label];
      })
    );
  }

  const computedRows: RunRow[] = await Promise.all(
    runs.map(async (run) => {
      const riderLabel = run.riderId
        ? riderLabelMap.get(run.riderId) ?? null
        : null;

      const openOrders = run.orders
        .map((ro: any) => ro.order)
        .filter(
          (o: any) =>
            o && (o.status === "UNPAID" || o.status === "PARTIALLY_PAID")
        );
      const openOrderCount = openOrders.filter(
        (o: any) => !o.channel || o.channel === "DELIVERY"
      ).length;
      // ─────────────────────────────────────────
      // IMPORTANT CHANGE:
      // Step 1 should match Step 2’s meaning:
      // "Cash to remit" = remaining vs riderCash (run-scope),
      // not full order balance (which includes AR).
      //
      // Source of truth for riderCash:
      // - ROAD: roadsideCashByOrderCode (RS-*)
      // - PARENT: parentCashByOrderId (orderId)
      // Fallback (legacy): if no receipts, assume:
      //    isOnCredit ? 0 : totalBeforeDiscount/subtotal
      // ─────────────────────────────────────────

      let openOrderTotal = 0;

      // Keep lock flags (below) consistent with new cash-to-remit meaning:
      // lock matters only if remainingForRun > 0

      // Resolve maps (best-effort)
      let roadsideCashByOrderCode: Map<string, { cash: number }> = new Map();
      let parentCashByOrderId: Map<number, number> = new Map();
      try {
        const maps = await loadRunReceiptCashMaps(db, run.id);
        roadsideCashByOrderCode = maps.roadsideCashByOrderCode as any;
        parentCashByOrderId = maps.parentCashByOrderId as any;
      } catch {
        // best-effort fallback: keep empty maps
      }

      const getRiderCash = (o: any, total: number) => {
        const isRoadside =
          typeof o.orderCode === "string" && o.orderCode.startsWith("RS-");
        if (isRoadside) {
          const rs = roadsideCashByOrderCode.get(String(o.orderCode ?? ""));
          const cash = rs ? Number(rs.cash ?? 0) : 0;
          return Math.max(0, Math.min(total, cash));
        }
        const prCash = parentCashByOrderId.get(Number(o.id));
        if (prCash != null && Number.isFinite(prCash)) {
          return Math.max(0, Math.min(total, Number(prCash)));
        }
        return o.isOnCredit ? 0 : Math.max(0, total);
      };

      for (const o of openOrders) {
        // only count DELIVERY for remit totals
        if (o.channel && o.channel !== "DELIVERY") continue;

        const total = Number(o.totalBeforeDiscount ?? o.subtotal ?? 0);
        const paid = Array.isArray(o.payments)
          ? o.payments.reduce((s: number, p: any) => {
              const a = Number(p?.amount ?? 0);
              return s + (Number.isFinite(a) ? a : 0);
            }, 0)
          : 0;

        const riderCash = getRiderCash(o, total);

        const paidForRun = Math.min(Math.max(0, paid), riderCash);
        const remainingForRun = Math.max(0, riderCash - paidForRun);
        openOrderTotal += remainingForRun;
      }

      // Lock state per run:
      //  - lockedByMe: at least one open order.lockedBy === myToken
      //  - lockedByOther: at least one open order.lockedBy !== "" and !== myToken
      //  - lockOwnerLabel: pangalan/alias ng cashier (for "other" case)
      let lockedByMe = false;
      let lockedByOther = false;
      let lockOwnerLabel: string | null = null;

      for (const o of openOrders) {
        // lock only matters if there's still CASH-TO-REMIT (run-scope) to settle
        if (o.channel && o.channel !== "DELIVERY") continue;

        const total = Number(o.totalBeforeDiscount ?? o.subtotal ?? 0);
        const paid = Array.isArray(o.payments)
          ? o.payments.reduce((s: number, p: any) => {
              const a = Number(p?.amount ?? 0);
              return s + (Number.isFinite(a) ? a : 0);
            }, 0)
          : 0;

        const riderCash = getRiderCash(o, total);

        const paidForRun = Math.min(Math.max(0, paid), riderCash);
        const remainingForRun = Math.max(0, riderCash - paidForRun);
        if (!(Number.isFinite(remainingForRun) && remainingForRun > 0))
          continue;

        const token = (o.lockedBy ?? "").trim();
        if (!token) continue;
        const ownerId = Number(token);

        if (token === myToken) {
          lockedByMe = true;
        } else {
          lockedByOther = true;
          if (!lockOwnerLabel && Number.isFinite(ownerId)) {
            lockOwnerLabel = cashierLabelMap.get(ownerId) ?? `User #${ownerId}`;
          }
        }
      }

      return {
        id: run.id,
        runCode: run.runCode,
        status: run.status as RunRow["status"],
        riderLabel,
        openOrderCount,
        openOrderTotal,
        lockedByMe,
        lockedByOther,
        lockOwnerLabel,
      };
    })
  );
  // safety: huwag na ipakita runs na walang open orders (double guard)
  const rows: RunRow[] = computedRows.filter((r) => r.openOrderCount > 0);

  return json<LoaderData>({ rows });
}

export default function CashierDeliveryIndexPage() {
  const { rows } = useLoaderData<typeof loader>();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">
            Delivery Remit — Closed Runs
          </h1>

          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500">{rows.length} run(s)</span>

            <a
              href="/cashier"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ← Cashier Dashboard
            </a>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Run</th>
                <th className="px-3 py-2 text-left font-medium">Rider</th>
                <th className="px-3 py-2 text-right font-medium">
                  # Delivery Orders
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Cash to remit
                </th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-4 text-center text-slate-500"
                  >
                    No closed delivery runs to remit.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs font-semibold text-slate-800">
                        {r.runCode}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Run #{r.id}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {r.riderLabel ?? (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.openOrderCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {peso(r.openOrderTotal)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${
                          r.lockedByOther
                            ? "border border-amber-200 bg-amber-50 text-amber-700"
                            : r.lockedByMe
                            ? "border border-indigo-200 bg-indigo-50 text-indigo-700"
                            : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {r.lockedByOther
                          ? `Locked by ${r.lockOwnerLabel ?? "another cashier"}`
                          : r.lockedByMe
                          ? "Your remit in progress"
                          : "Ready for remit"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.lockedByOther ? (
                        <span className="inline-flex cursor-not-allowed items-center rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-400">
                          Open Remit
                        </span>
                      ) : (
                        <Link
                          to={`/cashier/delivery/${r.id}`}
                          onClick={(e) => {
                            const msg = r.lockedByMe
                              ? `Resume remit for run ${r.runCode}?\n\nThis run is already assigned to you and will remain locked while you are remitting.`
                              : `Open remit for run ${r.runCode}?\n\nThis run will be locked to you as cashier while you are remitting.`;
                            const ok = window.confirm(msg);
                            if (!ok) e.preventDefault();
                          }}
                          className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                        >
                          {r.lockedByMe ? "Resume Remit" : "Open Remit"}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
