// app/routes/remit.$id.summary.tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";

type LoaderData = {
  parent: {
    id: number;
    orderCode: string;
    riderName: string | null;
    paidAt: string | null; // ISO string for safe serialization
    status: string;
    receiptNo: string | null;
    totalBeforeDiscount: number | null;
    subtotal: number | null;
    items: Array<{
      id: number;
      name: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
    }>;
  };
  // cash children (PAID) and credit children (PARTIALLY_PAID), both linked to this parent remit
  children: Array<{
    id: number;
    orderCode: string;
    status: string; // normalized enum → string
    receiptNo: string | null;
    paidAt: string | null; // ISO string
    total: number;
    customerName: string;
    // most recent cash payment id for printing "Cash Received" correctly
    paymentId: number | null;
  }>;
};

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id))
    throw new Response("Invalid remit id", { status: 400 });

  const parentRaw = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderCode: true,
      riderName: true,
      paidAt: true,
      status: true,
      receiptNo: true,
      totalBeforeDiscount: true,
      subtotal: true,
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

  if (!parentRaw) throw new Response("Remit parent not found", { status: 404 });

  // 🔧 Normalize Prisma Decimals/enums → plain numbers/strings to satisfy LoaderData
  const parent = {
    id: parentRaw.id,
    orderCode: parentRaw.orderCode,
    riderName: parentRaw.riderName,
    paidAt: parentRaw.paidAt ? parentRaw.paidAt.toISOString() : null,
    status: String(parentRaw.status), // enum → string
    receiptNo: parentRaw.receiptNo,
    totalBeforeDiscount:
      parentRaw.totalBeforeDiscount == null
        ? null
        : Number(parentRaw.totalBeforeDiscount),
    subtotal: parentRaw.subtotal == null ? null : Number(parentRaw.subtotal),
    items: parentRaw.items.map((it) => ({
      id: it.id,
      name: it.name,
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
    })),
  };

  // --- B) children query if scalar only ---
  const childrenRaw = await db.order.findMany({
    where: { remitParentId: id },
    select: {
      id: true,
      orderCode: true,
      status: true,
      receiptNo: true,
      paidAt: true,
      totalBeforeDiscount: true,
      deliverTo: true,
      deliverPhone: true,
      customer: {
        select: {
          alias: true,
          firstName: true,
          middleName: true,
          lastName: true,
        },
      },
      payments: {
        select: { id: true, method: true, amount: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: [{ id: "asc" }],
  });

  // ── Robust name resolution helpers (treat placeholder aliases as empty) ──
  const trim = (s?: string | null) => (typeof s === "string" ? s.trim() : "");
  const isPlaceholder = (s: string) =>
    /^walk[\s-]?in$/i.test(s) || /^n\/?a$/i.test(s) || /^-+$/.test(s);
  const safe = (s?: string | null) => {
    const t = trim(s);
    return t && !isPlaceholder(t) ? t : "";
  };
  const firstNonEmpty = (...vals: Array<string | undefined | null>) =>
    vals.map((v) => trim(v || "")).find((v) => v) || "";

  const children = childrenRaw.map((o) => {
    // Prefer a real alias, but ignore placeholders like "Walk-in"
    const alias = safe(o.customer?.alias);
    const first = safe(o.customer?.firstName);
    const mid = safe(o.customer?.middleName);
    const last = safe(o.customer?.lastName);

    // If there is a proper alias, it wins; otherwise use composed full name
    const fullFromCustomer = firstNonEmpty(
      alias,
      [first, mid, last].filter(Boolean).join(" ")
    );

    // If no customer record or names, try to extract a name from deliverTo:
    // formats like "Name — address", "Name - address", or "Name, address"
    const deliverName = (() => {
      const raw = trim(o.deliverTo);
      if (!raw) return "";
      const part = raw.split(/—|-|,/)[0];
      return safe(part);
    })();

    const cname = firstNonEmpty(fullFromCustomer, deliverName, "Walk-in");

    const paymentId = o.payments?.find((p) => p.method === "CASH")?.id ?? null;
    return {
      id: o.id,
      orderCode: o.orderCode,
      status: String(o.status),
      receiptNo: o.receiptNo,
      paidAt: o.paidAt ? o.paidAt.toISOString() : null,
      total: Number(o.totalBeforeDiscount ?? 0),
      customerName: cname,
      paymentId,
    };
  });

  return json<LoaderData>(
    { parent, children },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export default function RemitSummaryPage() {
  const { parent, children } = useLoaderData<typeof loader>();
  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n || 0);

  const cashChildren = children.filter((c) => c.status === "PAID");
  const creditChildren = children.filter((c) => c.status !== "PAID");

  return (
    <main className="mx-auto p-4 md:p-6 text-slate-900 bg-[#f7f7fb] min-h-screen">
      {/* Header Card */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white/90 backdrop-blur shadow-sm">
        <div className="px-4 py-4 md:px-5 md:py-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
              Rider Remit Summary
            </h1>
            <div className="mt-1 text-sm text-slate-600 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs">
                Parent&nbsp;Order:
                <span className="font-mono text-slate-800">
                  {parent.orderCode}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs">
                Rider:
                <span className="font-medium">{parent.riderName || "—"}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs">
                Status:
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] ring-1 ring-inset ring-slate-200">
                  {parent.status}
                </span>
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              to={`/orders/${parent.id}/receipt?autoprint=1&autoback=1`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-slate-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
            >
              Reprint Parent
            </Link>
            <Link
              to={`/remit-receipt/${parent.id}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
            >
              Print Rider Consolidated
            </Link>
          </div>
        </div>

        {/* Totals strip */}
        <div className="border-t border-slate-100 px-4 py-3 md:px-5 grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] text-slate-500">Subtotal</div>
            <div className="text-sm font-semibold tabular-nums">
              {peso(Number(parent.subtotal || 0))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] text-slate-500">Total</div>
            <div className="text-sm font-semibold tabular-nums">
              {peso(Number(parent.totalBeforeDiscount || 0))}
            </div>
          </div>
          <div className="hidden sm:block rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] text-slate-500">Paid At</div>
            <div className="text-sm font-medium">
              {parent.paidAt ? new Date(parent.paidAt).toLocaleString() : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* PARENT (REMIT) ITEMS — evaluation */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800 tracking-wide">
            Parent Items (Remit)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-0 bg-white/90 backdrop-blur border-b border-slate-200 text-slate-600">
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
                  Subtotal
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {peso(Number(parent.subtotal || 0))}
                </td>
              </tr>
              <tr className="font-medium">
                <td className="px-3 py-2" colSpan={3}>
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {peso(Number(parent.totalBeforeDiscount || 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* CASH children */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800 tracking-wide">
            Cash Sales (Child Receipts)
          </h2>
          {cashChildren.length > 0 && (
            <button
              type="button"
              onClick={() => {
                cashChildren.forEach((c) => {
                  const qs = new URLSearchParams({
                    autoprint: "1",
                    autoback: "1",
                  });
                  if (c.paymentId) qs.set("pid", String(c.paymentId));
                  window.open(
                    `/orders/${c.id}/receipt?${qs.toString()}`,
                    "_blank",
                    "noopener,noreferrer"
                  );
                });
              }}
              className="text-xs text-indigo-600 hover:underline"
            >
              Print all
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/90 backdrop-blur border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Receipt</th>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Paid At</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cashChildren.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={6}>
                    No cash child receipts.
                  </td>
                </tr>
              ) : (
                cashChildren.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/40">
                    <td className="px-3 py-2 font-mono">
                      {c.receiptNo || "—"}
                    </td>
                    <td className="px-3 py-2">{c.orderCode}</td>
                    <td className="px-3 py-2">{c.customerName}</td>
                    <td className="px-3 py-2">
                      {c.paidAt ? new Date(c.paidAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {peso(c.total)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <a
                        href={`/orders/${c.id}/receipt?autoprint=1${
                          c.paymentId ? `&pid=${c.paymentId}` : ""
                        }&autoback=1`}
                        className="rounded-lg px-2 py-1 text-indigo-600 hover:bg-indigo-50"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Reprint
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* CREDIT children */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800 tracking-wide">
            Credit Sales (Acknowledgements)
          </h2>
          {creditChildren.length > 0 && (
            <button
              type="button"
              onClick={() => {
                creditChildren.forEach((c) => {
                  window.open(
                    `/orders/${c.id}/ack?autoprint=1&autoback=1`,
                    "_blank",
                    "noopener,noreferrer"
                  );
                });
              }}
              className="text-xs text-indigo-600 hover:underline"
            >
              Print all
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/90 backdrop-blur border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {creditChildren.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={5}>
                    No credit child orders.
                  </td>
                </tr>
              ) : (
                creditChildren.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/40">
                    <td className="px-3 py-2">{c.orderCode}</td>
                    <td className="px-3 py-2">{c.customerName}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] ring-1 ring-inset ring-slate-200">
                        {c.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {peso(c.total)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <a
                        href={`/orders/${c.id}/ack?autoprint=1&autoback=1`}
                        className="rounded-lg px-2 py-1 text-indigo-600 hover:bg-indigo-50"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Reprint ACK
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6">
        <Link
          to="/receipts"
          className="text-sm text-slate-600 underline hover:text-slate-800"
        >
          Go to Receipts index
        </Link>
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  // Show something instead of a blank screen
  console.error(error);
  const msg =
    error instanceof Error
      ? error.message
      : "Unexpected error in Summary page.";
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-base font-semibold text-red-700">Error</h1>
      <pre className="mt-2 rounded-md bg-red-50 p-3 text-xs text-red-900 whitespace-pre-wrap">
        {msg}
      </pre>
      <p className="mt-3 text-sm text-slate-600">
        Check the server console for a full stack trace.
      </p>
    </main>
  );
}
