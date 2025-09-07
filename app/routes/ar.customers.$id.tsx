import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";

import {
  Form,
  useLoaderData,
  useNavigation,
  useSearchParams,
  Link,
} from "@remix-run/react";
import { Prisma } from "@prisma/client";

import { db } from "~/utils/db.server";
import type { Cart, Rule } from "~/services/pricing";

// ── Minimal pricing helpers (mirror cashier logic) ─────────────
const r2 = (n: number) => +Number(n).toFixed(2);
const applyDiscountsLocal = (cart: Cart, rules: Rule[]) => {
  let subtotal = 0;
  let total = 0;
  for (const it of cart.items) {
    const qty = Number(it.qty);
    const unit = Number(it.unitPrice);
    subtotal = r2(subtotal + qty * unit);
    let eff = unit;
    // tolerant matcher: unknown item.unitKind = wildcard
    const matches = rules.filter((r) => {
      const byPid = r.selector?.productIds?.includes(it.productId) ?? false;
      if (!byPid) return false;
      if (r.selector?.unitKind)
        return !it.unitKind || r.selector.unitKind === it.unitKind;
      return true;
    });
    const override = matches.find((m) => m.kind === "PRICE_OVERRIDE");
    const percents = matches.filter((m) => m.kind === "PERCENT_OFF");
    if (override && override.kind === "PRICE_OVERRIDE") {
      eff = r2(override.priceOverride);
    }
    for (const p of percents) {
      if (p.kind !== "PERCENT_OFF") continue;
      const pct = Math.max(0, Number(p.percentOff ?? 0));
      if (pct <= 0) continue;
      eff = r2(eff * (1 - pct / 100));
    }
    total = r2(total + qty * eff);
  }
  return { subtotal: r2(subtotal), total: r2(total) };
};
const mapRules = (
  rows: Array<{
    id: number;
    productId: number;
    unitKind: "RETAIL" | "PACK";
    mode: "FIXED_PRICE" | "PERCENT_DISCOUNT" | "FIXED_DISCOUNT";
    value: Prisma.Decimal | number | null;
    product: {
      price: Prisma.Decimal | number | null;
      srp: Prisma.Decimal | number | null;
    };
  }>
): Rule[] =>
  rows.map((r) => {
    const selector = { productIds: [r.productId], unitKind: r.unitKind };
    const v = Number(r.value ?? 0);
    if (r.mode === "FIXED_PRICE") {
      return {
        id: `CIP:${r.id}`,
        name: "Customer Price",
        scope: "ITEM",
        kind: "PRICE_OVERRIDE",
        priceOverride: v,
        selector,
        priority: 10,
        enabled: true,
        stackable: false,
        notes: `unit=${r.unitKind}`,
      } as Rule;
    }
    if (r.mode === "PERCENT_DISCOUNT") {
      return {
        id: `CIP:${r.id}`,
        name: "Customer % Off",
        scope: "ITEM",
        kind: "PERCENT_OFF",
        percentOff: v,
        selector,
        priority: 10,
        enabled: true,
        stackable: true,
        notes: `unit=${r.unitKind}`,
      } as Rule;
    }
    const base =
      r.unitKind === "RETAIL"
        ? Number(r.product.price ?? 0)
        : Number(r.product.srp ?? 0);
    const override = Math.max(0, +(base - v).toFixed(2));
    return {
      id: `CIP:${r.id}`,
      name: "Customer Fixed Off",
      scope: "ITEM",
      kind: "PRICE_OVERRIDE",
      priceOverride: override,
      selector,
      priority: 10,
      enabled: true,
      stackable: false,
      notes: `unit=${r.unitKind}`,
    } as Rule;
  });
const buildCartFromOrder = (
  order: {
    items: Array<{
      id: number;
      productId: number;
      qty: Prisma.Decimal | number;
      unitPrice: Prisma.Decimal | number;
      product: {
        price: Prisma.Decimal | number | null;
        srp: Prisma.Decimal | number | null;
        allowPackSale: boolean;
      };
    }>;
  },
  rules: Rule[]
): Cart => {
  const eq = (a: number, b: number, eps = 0.25) => Math.abs(a - b) <= eps;
  return {
    items: order.items.map((it) => {
      const baseRetail = Number(it.product?.price ?? 0);
      const basePack = Number(it.product?.srp ?? 0);
      const u = Number(it.unitPrice);
      let unitKind: "RETAIL" | "PACK" | undefined;
      const retailClose = baseRetail > 0 && eq(u, baseRetail);
      const packClose = basePack > 0 && eq(u, basePack);
      if (retailClose && !packClose) unitKind = "RETAIL";
      else if (packClose && !retailClose) unitKind = "PACK";
      else if (retailClose && packClose)
        unitKind = baseRetail <= basePack ? "RETAIL" : "PACK";
      if (!unitKind) {
        const hasPack = rules.some(
          (r) =>
            r.selector?.unitKind === "PACK" &&
            r.selector?.productIds?.includes(it.productId)
        );
        const hasRetail = rules.some(
          (r) =>
            r.selector?.unitKind === "RETAIL" &&
            r.selector?.productIds?.includes(it.productId)
        );
        if (hasPack && !hasRetail) unitKind = "PACK";
        else if (hasRetail && !hasPack) unitKind = "RETAIL";
      }
      return {
        id: it.id,
        productId: it.productId,
        name: "",
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        unitKind,
      };
    }),
  };
};

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const customer = await db.customer.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
      creditLimit: true,
      orders: {
        where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
        select: {
          id: true,
          orderCode: true,
          createdAt: true,
          dueDate: true,
          // totalBeforeDiscount kept implicitly via items; we compute discounted total instead
          items: {
            select: {
              id: true,
              productId: true,
              qty: true,
              unitPrice: true,
              product: {
                select: { price: true, srp: true, allowPackSale: true },
              },
            },
          },
          payments: {
            select: {
              id: true,
              amount: true,
              method: true,
              refNo: true,
              createdAt: true,
            },
          },
          status: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!customer) throw new Response("Not found", { status: 404 });

  // Build ledger rows: charges (order) & credits (payments)
  type Row =
    | {
        kind: "order";
        date: string;
        label: string;
        amount: number;
        orderId: number;
        due?: string | null;
      }
    | {
        kind: "payment";
        date: string;
        label: string;
        amount: number;
        orderId: number;
        ref?: string | null;
      };

  // Load active rules for this customer (as of now)
  const now = new Date();
  const rawRules = await db.customerItemPrice.findMany({
    where: {
      customerId: customer.id,
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    select: {
      id: true,
      productId: true,
      unitKind: true,
      mode: true,
      value: true,
      product: { select: { price: true, srp: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  const rules = mapRules(rawRules);

  const rows: Row[] = [];
  let balance = 0;
  for (const o of customer.orders) {
    // compute discounted total from items + rules
    const cart = buildCartFromOrder({ items: o.items }, rules);
    const pricing = applyDiscountsLocal(cart, rules);
    const orderAmt = pricing.total;
    rows.push({
      kind: "order",
      date: o.createdAt.toISOString(),
      label: `Order ${o.orderCode}`,
      amount: orderAmt,
      orderId: o.id,
      due: o.dueDate ? o.dueDate.toISOString() : null,
    });
    balance += orderAmt;

    for (const p of o.payments) {
      rows.push({
        kind: "payment",
        date: p.createdAt.toISOString(),
        label: `Payment ${p.method}${p.refNo ? ` • ${p.refNo}` : ""}`,
        amount: Number(p.amount),
        orderId: o.id,
        ref: p.refNo ?? null,
      });
      balance -= Number(p.amount);
    }
  }

  // sort by date ascending
  rows.sort((a, b) => +new Date(a.date) - +new Date(b.date));

  const displayName = `${customer.firstName}${
    customer.middleName ? ` ${customer.middleName}` : ""
  } ${customer.lastName}`.trim();

  return json({
    customer: {
      id: customer.id,
      name: displayName,
      alias: customer.alias ?? null,
      phone: customer.phone ?? null,
      creditLimit: customer.creditLimit ?? null,
    },
    rows,
    balance: Number(balance.toFixed(2)),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const customerId = Number(params.id);
  if (!Number.isFinite(customerId))
    return json({ ok: false, error: "Invalid ID" }, { status: 400 });

  const fd = await request.formData();
  const act = String(fd.get("_action") || "");

  if (act === "recordPayment") {
    const amount = Number(fd.get("amount") || 0);
    const method = String(fd.get("method") || "CASH") as
      | "CASH"
      | "GCASH"
      | "CARD";
    const refNo = String(fd.get("refNo") || "").trim() || null;
    const orderId = Number(fd.get("orderId") || 0); // optional: apply to one order

    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ ok: false, error: "Enter amount > 0" }, { status: 400 });
    }

    // Helper: (re)compute an order's remaining using discounted total inside tx
    const getRemaining = async (tx: Prisma.TransactionClient, oid: number) => {
      const ord = await tx.order.findUnique({
        where: { id: oid },
        select: {
          customerId: true,
          items: {
            select: {
              id: true,
              productId: true,
              qty: true,
              unitPrice: true,
              product: {
                select: { price: true, srp: true, allowPackSale: true },
              },
            },
          },
        },
      });
      if (!ord) return 0;
      // load active rules for this order's customer
      let rules: Rule[] = [];
      if (ord.customerId) {
        const now = new Date();
        const raw = await tx.customerItemPrice.findMany({
          where: {
            customerId: ord.customerId,
            active: true,
            AND: [
              { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
              { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
            ],
          },
          select: {
            id: true,
            productId: true,
            unitKind: true,
            mode: true,
            value: true,
            product: { select: { price: true, srp: true } },
          },
          orderBy: [{ createdAt: "desc" }],
        });
        rules = mapRules(raw);
      }
      const cart = buildCartFromOrder({ items: ord.items }, rules);
      const pricing = applyDiscountsLocal(cart, rules);
      const effectiveTotal = pricing.total;
      const paidAgg = await tx.payment.aggregate({
        where: { orderId: oid },
        _sum: { amount: true },
      });
      const paid = Number(paidAgg._sum.amount ?? 0);
      return Math.max(0, effectiveTotal - paid);
    };

    let change = 0;
    // Track which order(s) we actually applied payment to
    const appliedOrderIds: number[] = [];

    // If we're auto-allocating, fetch open orders OUTSIDE the tx so we can validate/early-return safely.
    let openOrders: Array<{ id: number; createdAt: Date }> = [];
    if (!orderId) {
      openOrders = await db.order.findMany({
        where: {
          customerId,
          status: { in: ["UNPAID", "PARTIALLY_PAID"] },
        },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      if (openOrders.length === 0) {
        return json({ ok: false, error: "No open orders." }, { status: 400 });
      }
    }

    await db.$transaction(async (tx) => {
      let remainingToApply = amount;

      if (orderId) {
        // apply only to the chosen order
        const rem = await getRemaining(tx, orderId);
        const apply = Math.min(remainingToApply, rem);
        if (apply > 0) {
          await tx.payment.create({
            data: { orderId, method, amount: apply, refNo },
          });
          remainingToApply -= apply;
          appliedOrderIds.push(orderId);

          // update order status after payment
          const remAfter = await getRemaining(tx, orderId);
          await tx.order.update({
            where: { id: orderId },
            data: {
              status: remAfter <= 1e-6 ? "PAID" : "PARTIALLY_PAID",
              ...(remAfter <= 1e-6 ? { paidAt: new Date() } : {}),
            },
          });
        }
        change = Math.max(0, remainingToApply);
      } else {
        for (const o of openOrders) {
          if (remainingToApply <= 0) break;
          const rem = await getRemaining(tx, o.id);
          if (rem <= 0) continue;
          const apply = Math.min(remainingToApply, rem);
          await tx.payment.create({
            data: { orderId: o.id, method, amount: apply, refNo },
          });
          remainingToApply -= apply;
          appliedOrderIds.push(o.id);
          const remAfter = await getRemaining(tx, o.id);
          await tx.order.update({
            where: { id: o.id },
            data: {
              status: remAfter <= 1e-6 ? "PAID" : "PARTIALLY_PAID",
              ...(remAfter <= 1e-6 ? { paidAt: new Date() } : {}),
            },
          });
        }
        change = Math.max(0, remainingToApply);
      }
    });

    // Build redirect with optional change banner
    const qs = new URLSearchParams();
    if (change > 0) qs.set("change", change.toFixed(2));

    // If “Save & Print Ack” was used:
    const shouldPrint = String(fd.get("printAck") || "0") === "1";
    if (shouldPrint) {
      const targetForAck =
        (orderId && appliedOrderIds.includes(orderId) ? orderId : null) ??
        (appliedOrderIds.length > 0 ? appliedOrderIds[0] : null);
      if (targetForAck) {
        const qs = new URLSearchParams({
          autoprint: "1",
          autoback: "1",
          tendered: amount.toFixed(2),
        });
        if (change > 0) qs.set("change", change.toFixed(2));
        return redirect(`/orders/${targetForAck}/ack?${qs.toString()}`);
      }
      // Fallback: go back to AR with a small banner
      qs.set("printed", "1");
      return redirect(`/ar/customers/${customerId}?${qs.toString()}`);
    }
    return redirect(`/ar/customers/${customerId}?${qs.toString()}`);
  }
  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CustomerLedgerPage() {
  const { customer, rows, balance } = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();
  const nav = useNavigation();
  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Customer Ledger
            </h1>
            <div className="text-sm text-slate-600">
              {customer.name}
              {customer.alias ? ` (${customer.alias})` : ""} •{" "}
              {customer.phone ?? "—"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right">
            <div className="text-xs text-slate-500">Current Balance</div>
            <div className="text-lg font-semibold text-slate-900">
              {peso(balance)}
            </div>
            {/* Optional change banner after redirect */}
            {sp.get("change") && (
              <div className="mx-auto max-w-4xl px-5 pb-3">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Change due to customer:{" "}
                  <b>₱{Number(sp.get("change")).toFixed(2)}</b>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-5 py-6 grid lg:grid-cols-3 gap-6">
        {/* Ledger */}
        <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Activity
          </div>
          <div className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-600">
                No activity yet.
              </div>
            ) : (
              rows.map((r, i) => (
                <div
                  key={i}
                  className="px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <div className="text-sm text-slate-900">
                      {r.kind === "order" ? "Charge" : "Payment"} • {r.label}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(r.date).toLocaleString()}
                      {r.kind === "order" && r.due
                        ? ` • due ${new Date(r.due).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold ${
                      r.kind === "order" ? "text-slate-900" : "text-emerald-700"
                    }`}
                  >
                    {r.kind === "order" ? "+" : "−"} {peso(r.amount)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Record Payment */}
        <aside className="lg:col-span-1 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Record Payment
          </div>
          <Form method="post" className="p-4 space-y-3">
            <input type="hidden" name="_action" value="recordPayment" />
            <label className="block text-sm">
              <span className="text-slate-700">Amount</span>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                inputMode="decimal"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <label className="block text-sm">
              <span className="text-slate-700">Method</span>
              <select
                name="method"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                defaultValue="CASH"
              >
                <option value="CASH">Cash</option>
                <option value="GCASH">GCash</option>
                <option value="CARD">Card</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="text-slate-700">Apply to Order (optional)</span>
              <input
                name="orderId"
                type="number"
                placeholder="Order ID (blank = oldest open)"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <label className="block text-sm">
              <span className="text-slate-700">Reference (optional)</span>
              <input
                name="refNo"
                placeholder="GCash ref / last 4 / notes"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                name="printAck"
                value="0"
                className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                disabled={nav.state !== "idle"}
              >
                {nav.state !== "idle" ? "Saving…" : "Save Payment"}
              </button>
              <button
                type="submit"
                name="printAck"
                value="1"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={nav.state !== "idle"}
              >
                {nav.state !== "idle" ? "Saving…" : "Save & Print Ack"}
              </button>
              <Link
                to={`/customers/${customer.id}`}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                View Customer Profile
              </Link>
            </div>
          </Form>
        </aside>
      </div>
    </main>
  );
}
