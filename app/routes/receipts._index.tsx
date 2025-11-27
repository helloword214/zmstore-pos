// app/routes/receipts._index.tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["CASHIER", "ADMIN"]);
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") || "").trim();
  // helper for case-insensitive string filter
  const ci = q ? { contains: q, mode: "insensitive" as const } : undefined;

  const where: Prisma.OrderWhereInput = {
    status: "PAID",
    ...(q
      ? {
          OR: [
            { orderCode: ci! },
            { receiptNo: ci! },
            { riderName: ci! },
            // relation fields must use `is: { ... }`
            { customer: { is: { alias: ci! } } },
            { customer: { is: { firstName: ci! } } },
            { customer: { is: { lastName: ci! } } },
          ],
        }
      : {}),
  };
  const orders = await db.order.findMany({
    where,
    select: {
      id: true,
      orderCode: true,
      receiptNo: true,
      paidAt: true,
      channel: true,
      riderName: true,
      totalBeforeDiscount: true,
      customer: { select: { alias: true, firstName: true, lastName: true } },
    },
    orderBy: [{ paidAt: "desc" }],
    take: 200,
  });

  return json({ q, orders });
}

export default function ReceiptsIndex() {
  const { q, orders } = useLoaderData<typeof loader>();
  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n || 0);

  return (
    <main className="mx-auto max-w-5xl p-5">
      <h1 className="text-base font-semibold text-slate-800">Receipts</h1>
      <Form method="get" className="mt-3">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search order code / receipt no / rider / customer…"
          className="w-full rounded-xl border border-slate-300 px-3 py-2"
        />
      </Form>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-slate-100 text-slate-600">
            <tr>
              <th className="p-2 text-left">Paid At</th>
              <th className="p-2 text-left">Receipt</th>
              <th className="p-2 text-left">Order</th>
              <th className="p-2 text-left">Customer / Rider</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const cname =
                o.customer?.alias ||
                [o.customer?.firstName, o.customer?.lastName]
                  .filter(Boolean)
                  .join(" ") ||
                "—";
              return (
                <tr key={o.id} className="border-b border-slate-100">
                  <td className="p-2">
                    {o.paidAt ? new Date(o.paidAt).toLocaleString() : "—"}
                  </td>
                  <td className="p-2 font-mono">{o.receiptNo || "—"}</td>
                  <td className="p-2">{o.orderCode}</td>
                  <td className="p-2">
                    <div>{cname}</div>
                    {o.channel === "DELIVERY" && (
                      <div className="text-[11px] text-slate-500">
                        Rider: {o.riderName || "—"}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {peso(o.totalBeforeDiscount)}
                  </td>
                  <td className="p-2 text-right">
                    <a
                      href={`/orders/${o.id}/receipt?autoprint=1&autoback=1`}
                      className="text-indigo-600 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Reprint
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
