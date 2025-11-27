import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

type LoaderData = {
  parent: {
    id: number;
    orderCode: string;
    riderName: string | null;
    deliveredAt: string | null; // ISO string
    subtotal: number | null;
    totalBeforeDiscount: number | null;
    items: Array<{
      id: number;
      name: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
    }>;
  };
  children: Array<{
    id: number;
    orderCode: string;
    deliveredAt: string | null; // ISO string
    deliverTo: string | null;
    customer: {
      alias: string | null;
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
    } | null;
    totalBeforeDiscount: number;
    payments: Array<{ method: string; amount: number }>;
  }>;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["CASHIER", "ADMIN"]);
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const parent = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderCode: true,
      riderName: true,
      deliveredAt: true,
      subtotal: true,
      totalBeforeDiscount: true,
      items: {
        select: {
          id: true,
          name: true,
          qty: true,
          unitPrice: true,
          lineTotal: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!parent) throw new Response("Not found", { status: 404 });

  const childrenRaw = await db.order.findMany({
    where: { remitParentId: id },
    select: {
      id: true,
      orderCode: true,
      deliveredAt: true,
      deliverTo: true,
      customer: {
        select: {
          alias: true,
          firstName: true,
          middleName: true,
          lastName: true,
        },
      },
      totalBeforeDiscount: true,
      payments: { select: { method: true, amount: true } },
    },
    orderBy: { id: "asc" },
  });

  // Normalize parent (Dates → ISO, Decimals → number)
  const parentNorm: LoaderData["parent"] = {
    id: parent.id,
    orderCode: parent.orderCode,
    riderName: parent.riderName,
    deliveredAt: parent.deliveredAt ? parent.deliveredAt.toISOString() : null,
    subtotal: parent.subtotal == null ? null : Number(parent.subtotal),
    totalBeforeDiscount:
      parent.totalBeforeDiscount == null
        ? null
        : Number(parent.totalBeforeDiscount),
    items: parent.items.map((it) => ({
      id: it.id,
      name: it.name,
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
    })),
  };

  const children: LoaderData["children"] = childrenRaw.map((o) => ({
    id: o.id,
    orderCode: o.orderCode,
    deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
    deliverTo: o.deliverTo ?? null,
    customer: o.customer
      ? {
          alias: o.customer.alias ?? null,
          firstName: o.customer.firstName ?? null,
          middleName: o.customer.middleName ?? null,
          lastName: o.customer.lastName ?? null,
        }
      : null,
    totalBeforeDiscount: Number(o.totalBeforeDiscount ?? 0),
    payments: (o.payments || []).map((p) => ({
      method: p.method,
      amount: Number(p.amount ?? 0),
    })),
  }));

  return json<LoaderData>(
    { parent: parentNorm, children },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export default function RiderReceipt() {
  const { parent, children } = useLoaderData<LoaderData>();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(Number(n || 0));

  // Persisted-only math (no recompute):
  const original = Number(parent.subtotal || 0); // pre-discount
  const final = Number(parent.totalBeforeDiscount || 0); // post-discount
  const discount = Math.max(0, Number((original - final).toFixed(2)));

  const grandTotal = children.reduce(
    (s, o) => s + Number(o.totalBeforeDiscount || 0),
    0
  );
  const grandPaid = children.reduce(
    (s, o) => s + o.payments.reduce((p, x) => p + Number(x.amount || 0), 0),
    0
  );

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-6 print:p-0 bg-[#f7f7fb] min-h-screen text-slate-900">
      {/* Header card */}
      <header className="mb-4 rounded-2xl border border-slate-200 bg-white/90 backdrop-blur shadow-sm print:border-0 print:shadow-none print:bg-transparent">
        <div className="px-4 py-4 md:px-5 md:py-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
              Rider Consolidated Receipt
            </h1>
            <div className="mt-1 text-sm text-slate-600 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs">
                Parent:
                <span className="font-mono text-slate-800">
                  {parent.orderCode}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs">
                Rider:
                <span className="font-medium">{parent.riderName || "—"}</span>
              </span>
              {parent.deliveredAt ? (
                <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs">
                  Delivered:
                  <span className="font-medium">
                    {new Date(parent.deliveredAt).toLocaleString()}
                  </span>
                </span>
              ) : null}
            </div>
          </div>

          <button
            onClick={() => window.print()}
            className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 print:hidden"
          >
            Print
          </button>
        </div>

        {/* Totals strip */}
        <div className="border-t border-slate-100 px-4 py-3 md:px-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] text-slate-500">Original subtotal</div>
            <div className="text-sm font-semibold tabular-nums">
              {peso(original)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] text-slate-500">
              Total after discounts
            </div>
            <div className="text-sm font-semibold tabular-nums">
              {peso(final)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] text-slate-500">Discounts</div>
            <div className="text-sm font-semibold tabular-nums text-rose-600">
              −{peso(discount)}
            </div>
          </div>
          <div className="hidden sm:block rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] text-slate-500">Child Orders</div>
            <div className="text-sm font-semibold tabular-nums">
              {children.length}
            </div>
          </div>
        </div>
      </header>

      {/* Parent remit items (for evaluation) */}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-0">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800 tracking-wide">
            Parent Items (Remit)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/90 backdrop-blur border-b border-slate-200 text-slate-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit</th>
                <th className="px-3 py-2 text-right">Line</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parent.items.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={4}>
                    No items on parent remit.
                  </td>
                </tr>
              ) : (
                parent.items.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50/40">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">
                        {it.name}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        #{it.id}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(it.qty)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {peso(Number(it.unitPrice))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {peso(Number(it.lineTotal))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-medium">
                <td className="px-3 py-2" colSpan={3}>
                  Original subtotal
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {peso(original)}
                </td>
              </tr>
              <tr className="font-medium">
                <td className="px-3 py-2" colSpan={3}>
                  Discounts
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-600">
                  −{peso(discount)}
                </td>
              </tr>
              <tr className="font-semibold">
                <td className="px-3 py-2" colSpan={3}>
                  Total after discounts
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {peso(final)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Children summary */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden print:shadow-none print:border-0">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800 tracking-wide">
            Child Orders
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/90 backdrop-blur border-b border-slate-200 text-slate-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {children.map((o) => {
                // Robust name resolution (ignore placeholders like "Walk-in", support multiple separators)
                const trim = (s?: string | null) =>
                  typeof s === "string" ? s.trim() : "";
                const isPlaceholder = (s: string) =>
                  /^walk[\s-]?in$/i.test(s) ||
                  /^n\/?a$/i.test(s) ||
                  /^-+$/.test(s);
                const safe = (s?: string | null) => {
                  const t = trim(s);
                  return t && !isPlaceholder(t) ? t : "";
                };
                const firstNonEmpty = (
                  ...vals: Array<string | undefined | null>
                ) => vals.map((v) => trim(v || "")).find((v) => v) || "";

                const alias = safe(o.customer?.alias);
                const first = safe(o.customer?.firstName);
                const mid = safe(o.customer?.middleName);
                const last = safe(o.customer?.lastName);
                const fromCustomer = firstNonEmpty(
                  alias,
                  [first, mid, last].filter(Boolean).join(" ")
                );
                const deliverName = (() => {
                  const raw = trim(o.deliverTo);
                  if (!raw) return "";
                  const part = raw.split(/—|-|,/)[0];
                  return safe(part);
                })();
                const name = firstNonEmpty(
                  fromCustomer,
                  deliverName,
                  "Walk-in"
                );
                const paid = o.payments.reduce(
                  (s, p) => s + Number(p.amount || 0),
                  0
                );
                return (
                  <tr key={o.id} className="hover:bg-slate-50/40">
                    <td className="px-3 py-2 font-mono">{o.orderCode}</td>
                    <td className="px-3 py-2">{name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {peso(o.totalBeforeDiscount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {peso(paid)}
                    </td>
                  </tr>
                );
              })}
              {children.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-8 text-center text-slate-500"
                  >
                    No child orders
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-medium">
                <td className="px-3 py-2" colSpan={2}>
                  Grand Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {peso(grandTotal)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {peso(grandPaid)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Print styles helper (keeps layout tidy when printing) */}
      <style>{`
        @media print {
          body, html { background: #fff !important; }
          main { padding: 0 !important; }
          table thead th { border-bottom: 1px solid #e5e7eb; }
          table tfoot td { border-top: 1px solid #e5e7eb; }
        }
      `}</style>
    </main>
  );
}
