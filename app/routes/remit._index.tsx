// app/routes/remit._index.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";

type RemitRow = {
  id: number;
  orderCode: string;
  status: "UNPAID" | "PARTIALLY_PAID";
  riderName: string | null;
  subtotal: number;
  totalBeforeDiscount: number;
  printedAt: string | null;
  dispatchedAt: string | null;
};

export async function loader({ request }: LoaderFunctionArgs) {
  // Cashier/admin with open shift lang ang makaka-access
  await requireOpenShift(request);

  const orders = await db.order.findMany({
    where: {
      channel: "DELIVERY",
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dispatchedAt: { not: null },
    },
    orderBy: { id: "desc" },
    take: 100,
    select: {
      id: true,
      orderCode: true,
      status: true,
      riderName: true,
      subtotal: true,
      totalBeforeDiscount: true,
      printedAt: true,
      dispatchedAt: true,
    },
  });

  const rows: RemitRow[] = orders.map((o) => ({
    id: o.id,
    orderCode: o.orderCode,
    status: o.status as any,
    riderName: o.riderName,
    subtotal: Number(o.subtotal ?? 0),
    totalBeforeDiscount: Number(o.totalBeforeDiscount ?? 0),
    printedAt: o.printedAt ? o.printedAt.toISOString() : null,
    dispatchedAt: o.dispatchedAt ? o.dispatchedAt.toISOString() : null,
  }));

  return json({ rows });
}

export default function DeliveryRemitIndexPage() {
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
            Delivery Remit
          </h1>

          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500">
              {rows.length} item(s)
            </span>

            <a
              href="/cashier"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ← Dashboard
            </a>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Order</th>
                <th className="px-3 py-2 text-left font-medium">Rider</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">
                  Total (final)
                </th>
                <th className="px-3 py-2 text-left font-medium">Dispatched</th>
                <th className="px-3 py-2 text-left font-medium">Printed</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-4 text-center text-slate-500"
                  >
                    No delivery orders to remit.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono">{r.orderCode}</td>
                    <td className="px-3 py-2">
                      {r.riderName ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs">
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {peso(r.totalBeforeDiscount || r.subtotal)}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.dispatchedAt
                        ? new Date(r.dispatchedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.printedAt
                        ? new Date(r.printedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/remit/${r.id}`}
                        className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                      >
                        Open Remit
                      </Link>
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
