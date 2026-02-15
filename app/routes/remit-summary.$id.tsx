// app/routes/remit.$id.summary.tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

type LoaderData = {
  parent: {
    id: number;
    orderCode: string;
    customerName: string | null;
    customerFullName: string | null;
    riderName: string | null;
    paidAt: string | null; // ISO string for safe serialization
    status: string;
    receiptNo: string | null;
    totalBeforeDiscount: number | null;
    cashPaid: number; // NEW: sum of CASH payments on parent
    subtotal: number | null;
    items: Array<{
      id: number;
      productId: number;
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
    cashPaid: number; // NEW: sum of CASH payments on this child
    status: string; // normalized enum → string
    receiptNo: string | null;
    paidAt: string | null; // ISO string
    total: number;
    customerName: string;
    customerFullName: string;
    // most recent cash payment id for printing "Cash Received" correctly
    paymentId: number | null;
  }>;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["CASHIER", "ADMIN"]);
  const id = Number(params.id);
  if (!Number.isFinite(id))
    throw new Response("Invalid remit id", { status: 400 });

  const parentRaw = await db.order.findUnique({
    where: { id },
    select: {
      // for customer name resolution
      deliverTo: true,
      customer: {
        select: {
          alias: true,
          firstName: true,
          middleName: true,
          lastName: true,
        },
      },
      id: true,
      orderCode: true,
      riderName: true,
      paidAt: true,
      status: true,
      receiptNo: true,
      totalBeforeDiscount: true,
      payments: {
        select: { method: true, amount: true, tendered: true, change: true },
      }, // include tendered/change
      subtotal: true,
      items: {
        select: {
          id: true,
          productId: true,
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

  // ── Name helpers (declare BEFORE using anywhere below) ────────────────────
  const trim = (s?: string | null) => (typeof s === "string" ? s.trim() : "");
  const isPlaceholder = (s: string) =>
    /^walk[\s-]?in$/i.test(s) || /^n\/?a$/i.test(s) || /^-+$/.test(s);
  const safe = (s?: string | null) => {
    const t = trim(s);
    return t && !isPlaceholder(t) ? t : "";
  };
  const firstNonEmpty = (...vals: Array<string | undefined | null>) =>
    vals.map((v) => trim(v || "")).find((v) => v) || "";

  // robust CASH detector (enum/string defensively)
  const isCash = (m: unknown) => String(m).toUpperCase() === "CASH";

  // ── Parent display + full names ───────────────────────────────────────────
  const pAlias = safe(parentRaw.customer?.alias);
  const pFirst = safe(parentRaw.customer?.firstName);
  const pMid = safe(parentRaw.customer?.middleName);
  const pLast = safe(parentRaw.customer?.lastName);
  const parentFullFromCustomer = [pFirst, pMid, pLast]
    .filter(Boolean)
    .join(" ");
  const parentFromDeliverTo = (() => {
    const raw = trim(parentRaw.deliverTo);
    if (!raw) return "";
    const part = raw.split(/—|-|,/)[0]; // name before separator
    return safe(part);
  })();
  const parentCustomerName =
    firstNonEmpty(pAlias, parentFullFromCustomer, parentFromDeliverTo) || null;
  const parentCustomerFullName =
    firstNonEmpty(parentFullFromCustomer, pAlias, parentFromDeliverTo) ||
    parentCustomerName;
  // NEW: compute parent CASH collected using tendered/change when available
  const parentCashPaid = (parentRaw.payments || [])
    .filter((p) => isCash(p.method))
    .reduce((s, p) => {
      const tendered = p.tendered == null ? null : Number(p.tendered);
      const change = p.change == null ? 0 : Number(p.change);
      const amount = p.amount == null ? 0 : Number(p.amount);
      // If tendered recorded, prefer tendered - change; else fall back to amount
      const net = tendered != null ? tendered - change : amount;
      return s + Math.max(0, net);
    }, 0);

  const parent = {
    id: parentRaw.id,
    orderCode: parentRaw.orderCode,
    customerName: parentCustomerName,
    customerFullName: parentCustomerFullName,
    riderName: parentRaw.riderName,
    paidAt: parentRaw.paidAt ? parentRaw.paidAt.toISOString() : null,
    status: String(parentRaw.status), // enum → string
    cashPaid: parentCashPaid, // NEW
    receiptNo: parentRaw.receiptNo,
    totalBeforeDiscount:
      parentRaw.totalBeforeDiscount == null
        ? null
        : Number(parentRaw.totalBeforeDiscount),
    subtotal: parentRaw.subtotal == null ? null : Number(parentRaw.subtotal),
    items: parentRaw.items.map((it) => ({
      id: it.id,
      productId: it.productId,
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
        select: {
          id: true,
          method: true,
          amount: true,
          tendered: true,
          change: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: [{ id: "asc" }],
  });

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

    const fullNameFromCustomer = [first, mid, last].filter(Boolean).join(" ");
    const customerFullName = firstNonEmpty(
      fullNameFromCustomer,
      alias,
      deliverName,
      "Walk-in"
    );

    const cname = firstNonEmpty(fullFromCustomer, deliverName, "Walk-in");

    // Child CASH collected: prefer tendered - change if available
    const cashPaid = (o.payments || [])
      .filter((p) => isCash(p.method))
      .reduce((s, p) => {
        const tendered = p.tendered == null ? null : Number(p.tendered);
        const change = p.change == null ? 0 : Number(p.change);
        const amount = p.amount == null ? 0 : Number(p.amount);
        const net = tendered != null ? tendered - change : amount;
        return s + Math.max(0, net);
      }, 0);

    const paymentId = o.payments?.find((p) => isCash(p.method))?.id ?? null;
    return {
      id: o.id,
      orderCode: o.orderCode,
      status: String(o.status),
      receiptNo: o.receiptNo,
      paidAt: o.paidAt ? o.paidAt.toISOString() : null,
      total: Number(o.totalBeforeDiscount ?? 0),
      cashPaid, // NEW
      customerName: cname,
      customerFullName,
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

  // derived only from persisted numbers (no pricing recompute)
  // ✅ If totalBeforeDiscount is null but lineTotals exist, use sum(lineTotal) as final
  const original = Number(parent.subtotal || 0);
  const final =
    parent.totalBeforeDiscount != null
      ? Number(parent.totalBeforeDiscount || 0)
      : (parent.items || []).reduce(
          (s, it) => s + Number(it.lineTotal || 0),
          0
        );
  const discount = Math.max(0, Number((original - final).toFixed(2)));

  const cashChildren = children.filter((c) => c.status === "PAID");
  const creditChildren = children.filter((c) => c.status !== "PAID");

  // ── Remit totals (child-based) ────────────────────────────────────────────
  const cashTotal = cashChildren.reduce((s, c) => s + Number(c.total || 0), 0);
  const creditTotal = creditChildren.reduce(
    (s, c) => s + Number(c.total || 0),
    0
  );
  const grandChildren = cashTotal + creditTotal;
  const parentAfterDiscounts = final; // main delivery total (NOT load-out sales)

  // NEW: cash collected totals (actual CASH payments)
  const parentCash = Number(parent.cashPaid || 0);
  const childrenCash = children.reduce(
    (s, c) => s + Number(c.cashPaid || 0),
    0
  );

  // ✅ Cash collected must mean ACTUAL CASH received, not payable total.

  // (Parent after-discounts is "amount due", not "cash collected".)

  const grandTotalCollected = childrenCash + parentCash;
  const showParentCash = parentCash > 0.009; // hide zero to avoid confusion
  // ✅ Load-out Sales Total is ALWAYS children-only.
  // Parent is main delivery; show separately to avoid being "considered sold/load-out".
  const remitTotal = grandChildren;
  const cashCount = cashChildren.length;
  const creditCount = creditChildren.length;

  // ✅ Remaining / Utang (AR) — this removes “double compute” feeling
  const loadoutUtangRemaining = creditChildren.reduce((s, c) => {
    const total = Number(c.total || 0);
    const cash = Number(c.cashPaid || 0);
    return s + Math.max(0, Number((total - cash).toFixed(2)));
  }, 0);

  const parentUtangRemaining = Math.max(
    0,
    Number(
      (Number(parentAfterDiscounts || 0) - Number(parentCash || 0)).toFixed(2)
    )
  );

  const overallUtangRemaining = Number(
    (loadoutUtangRemaining + parentUtangRemaining).toFixed(2)
  );

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
                Main&nbsp;Delivery:
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

              <span
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs"
                title={parent.customerFullName || undefined}
              >
                Customer:
                <span className="font-medium">
                  {parent.customerName || "—"}
                </span>
                {parent.customerFullName &&
                  parent.customerFullName !== parent.customerName && (
                    <span className="hidden sm:inline text-slate-500">
                      &nbsp;• {parent.customerFullName}
                    </span>
                  )}
              </span>
            </div>

            {/* QUICK PILL: Grand cash collected (children only) */}
            <div className="mt-2">
              <span
                className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs"
                title="Kabuuang perang nakolekta: Children Cash + Parent Cash"
              >
                Grand Total Collected:
                <span className="font-semibold text-slate-900">
                  {peso(grandTotalCollected)}
                </span>
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Link
              to="/cashier"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ← Back to Cashier
            </Link>
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
            <div className="text-[11px] text-slate-500">Original subtotal</div>
            <div className="text-sm font-semibold tabular-nums">
              {peso(original)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] text-slate-500">Discounts</div>
            <div className="text-sm font-semibold tabular-nums text-rose-600">
              −{peso(discount)}
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
          <div className="hidden sm:block rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="text-[11px] text-slate-500">Paid At</div>
            <div className="text-sm font-medium">
              {parent.paidAt ? new Date(parent.paidAt).toLocaleString() : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Main content grid: LEFT = lists, RIGHT = sticky totals + parent items */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* LEFT: review lists */}
        <div className="lg:col-span-8 space-y-3">
          {/* CASH children */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-medium text-slate-800 tracking-wide">
                Load-out Cash Sales (Receipts)
              </h2>
              {cashChildren.length > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {cashCount} receipt{cashCount === 1 ? "" : "s"} •{" "}
                    {peso(cashTotal)}
                  </span>
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
                </div>
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
                        No load-out cash receipts.
                      </td>
                    </tr>
                  ) : (
                    cashChildren.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/40">
                        <td className="px-3 py-2 font-mono">
                          {c.receiptNo || "—"}
                        </td>
                        <td className="px-3 py-2">{c.orderCode}</td>
                        <td
                          className="px-3 py-2"
                          title={c.customerFullName || undefined}
                        >
                          <div className="truncate">{c.customerName}</div>
                          {c.customerFullName &&
                            c.customerFullName !== c.customerName && (
                              <div className="text-[11px] text-slate-500 truncate">
                                {c.customerFullName}
                              </div>
                            )}
                        </td>
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
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-medium text-slate-800 tracking-wide">
                Load-out Credit Sales (Acknowledgements)
              </h2>
              {creditChildren.length > 0 && (
                <div className="text-xs text-slate-500">
                  {creditCount} order{creditCount === 1 ? "" : "s"} •{" "}
                  {peso(loadoutUtangRemaining)} remaining
                </div>
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
                        No load-out credit orders.
                      </td>
                    </tr>
                  ) : (
                    creditChildren.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/40">
                        <td className="px-3 py-2">{c.orderCode}</td>
                        <td
                          className="px-3 py-2"
                          title={c.customerFullName || undefined}
                        >
                          <div className="truncate">{c.customerName}</div>
                          {c.customerFullName &&
                            c.customerFullName !== c.customerName && (
                              <div className="text-[11px] text-slate-500 truncate">
                                {c.customerFullName}
                              </div>
                            )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] ring-1 ring-inset ring-slate-200">
                            {c.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {peso(
                            Math.max(
                              0,
                              Number(c.total || 0) - Number(c.cashPaid || 0)
                            )
                          )}
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
        </div>

        {/* RIGHT: sticky totals + collapsible parent items */}
        <aside className="lg:col-span-4">
          <div className="sticky top-20 space-y-3">
            {/* Remit Totals */}
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-3 py-2">
                <h3 className="text-[12px] font-medium text-slate-800">
                  Load-out Summary
                </h3>
              </div>
              <div className="p-3 grid grid-cols-2 gap-2">
                {/* 🔵 PRIMARY: one number the cashier needs */}

                <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2">
                  <div className="text-[10px] text-slate-500">
                    Load-out Cash Sales
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums">
                    {peso(cashTotal)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {cashCount} receipt{cashCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2">
                  <div className="text-[10px] text-slate-500">
                    Load-out Utang Remaining
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums">
                    {peso(loadoutUtangRemaining)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {creditCount} order{creditCount === 1 ? "" : "s"}
                  </div>
                </div>
                {/* Load-out sales total (sum of child order totals) */}
                <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 col-span-2">
                  <div className="text-[10px] text-slate-500">
                    Load-out Sales Total
                  </div>
                  <div className="text-[14px] font-semibold tabular-nums">
                    {peso(remitTotal)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 col-span-2">
                  <div className="text-[10px] text-slate-500">
                    Main Delivery Total (After Discounts)
                  </div>
                  <div className="text-[14px] font-semibold tabular-nums">
                    {peso(parentAfterDiscounts)}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 col-span-2">
                  <div className="text-[10px] text-slate-500">
                    Overall Utang Remaining
                  </div>
                  <div className="text-[14px] font-semibold tabular-nums">
                    {peso(overallUtangRemaining)}
                  </div>
                </div>
                {/* keep parent amount separately above; no 'snapshot' wording */}
                <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2">
                  <div className="text-[10px] text-slate-500">
                    Load-out Cash
                  </div>
                  <div className="text-[13px] font-semibold tabular-nums">
                    {peso(childrenCash)}
                  </div>
                </div>
                {showParentCash && (
                  <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2">
                    <div className="text-[10px] text-slate-500">
                      Main Delivery (Cash)
                    </div>
                    <div className="text-[13px] font-semibold tabular-nums">
                      {peso(parentCash)}
                    </div>
                  </div>
                )}
              </div>
              {/* Info note only when there are no children yet */}
              {children.length === 0 && (
                <div className="px-3 pb-3 text-[11px] text-slate-500">
                  Walang child receipts pa. Lalabas ang Remit Total kapag may
                  na-log na cash/credit children.
                </div>
              )}
            </section>

            {/* Parent Items (collapsible) */}
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <details open className="group">
                <summary className="cursor-pointer list-none border-b border-slate-100 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[12px] font-medium text-slate-800">
                      Main Delivery Items
                    </h3>
                    <span className="text-[11px] text-slate-500 group-open:hidden">
                      Show
                    </span>
                    <span className="text-[11px] text-slate-500 hidden group-open:inline">
                      Hide
                    </span>
                  </div>
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
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
                                #{it.productId}
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
              </details>
            </section>
          </div>
        </aside>
      </div>

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
