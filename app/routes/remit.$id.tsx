// app/routes/remit.$id.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { UnitKind } from "@prisma/client";
import {
  applyDiscounts,
  buildCartFromOrderItems,
  computeUnitPriceForCustomer,
  fetchActiveCustomerRules,
  type Cart,
  type Rule,
} from "~/services/pricing";
import { allocateReceiptNo } from "~/utils/receipt";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: {
            select: {
              price: true,
              srp: true,
              allowPackSale: true,
              stock: true,
              packingStock: true,
            },
          },
        },
      },
      payments: true,
      customer: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!order) throw new Response("Not found", { status: 404 });
  if (order.channel !== "DELIVERY") {
    // you can allow remit anyway, but this prevents pickup accidents
    throw new Response("Not a delivery order", { status: 400 });
  }
  if (order.status === "PAID") {
    throw new Response("Order already settled", { status: 400 });
  }

  const rules: Rule[] = await fetchActiveCustomerRules(
    db,
    order.customerId ?? null
  );
  const cart: Cart = buildCartFromOrderItems({
    items: order.items.map((it) => ({
      ...it,
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      product: {
        price: it.product?.price == null ? null : Number(it.product.price),
        srp: it.product?.srp == null ? null : Number(it.product.srp),
        allowPackSale: it.product?.allowPackSale ?? null,
      },
    })),
    rules,
  });
  const pricing = applyDiscounts(cart, rules, { id: order.customerId ?? null });

  return json({ order, pricing });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  const fd = await request.formData();

  const cashGiven = Number(fd.get("cashGiven") || 0);
  const releaseWithBalance = fd.get("releaseWithBalance") === "1";
  const releasedApprovedBy =
    String(fd.get("releasedApprovedBy") || "").trim() || null;
  const printReceipt = fd.get("printReceipt") === "1";

  if (!Number.isFinite(cashGiven) || cashGiven < 0) {
    return json(
      { ok: false, error: "Invalid collected cash." },
      { status: 400 }
    );
  }

  const order = await db.order.findUnique({
    where: { id },
    include: { items: true, payments: true },
  });
  if (!order)
    return json({ ok: false, error: "Order not found" }, { status: 404 });
  if (order.status === "PAID") {
    return json({ ok: false, error: "Order already paid" }, { status: 400 });
  }

  // pricing rules & product bases for inference + stock
  const productIds = Array.from(new Set(order.items.map((i) => i.productId)));
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      allowPackSale: true,
      price: true,
      srp: true,
      stock: true,
      packingStock: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const rules: Rule[] = await fetchActiveCustomerRules(
    db,
    order.customerId ?? null
  );

  // Effective total using the shared engine
  const cart: Cart = buildCartFromOrderItems({
    items: order.items.map((it: any) => ({
      ...it,
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      product: byId.get(it.productId)
        ? {
            price: Number(byId.get(it.productId)!.price ?? 0),
            srp: Number(byId.get(it.productId)!.srp ?? 0),
            allowPackSale: Boolean(
              byId.get(it.productId)!.allowPackSale ?? true
            ),
          }
        : { price: 0, srp: 0, allowPackSale: true },
    })),
    rules,
  });
  const pricing = applyDiscounts(cart, rules, { id: order.customerId ?? null });
  const total = pricing.total ?? Number(order.totalBeforeDiscount);

  const alreadyPaid = (order.payments ?? []).reduce(
    (s, p) => s + Number(p.amount),
    0
  );
  const dueBefore = Math.max(0, total - alreadyPaid);

  const appliedPayment = Math.min(Math.max(0, cashGiven), dueBefore);
  const change = Math.max(0, cashGiven - appliedPayment);
  const nowPaid = alreadyPaid + appliedPayment;
  const remaining = Math.max(0, total - nowPaid);

  // Build stock deltas (unit inference allows for customer pricing)
  const errors: Array<{ id: number; reason: string }> = [];
  const deltas = new Map<number, { pack: number; retail: number }>();

  // Unit inference: compare actual snapshot unitPrice vs allowed for both unit kinds, pick nearest
  for (const it of order.items) {
    const p = byId.get(it.productId);
    if (!p) {
      errors.push({ id: it.productId, reason: "Product missing" });
      continue;
    }
    const unitPrice = Number(it.unitPrice);
    const qty = Number(it.qty);
    const baseRetail = Number(p.price ?? 0);
    const basePack = Number(p.srp ?? 0);

    const [allowedRetail, allowedPack] = await Promise.all([
      baseRetail > 0
        ? computeUnitPriceForCustomer(db as any, {
            customerId: order.customerId ?? null,
            productId: p.id,
            unitKind: UnitKind.RETAIL,
            baseUnitPrice: baseRetail,
          })
        : Promise.resolve(NaN),
      basePack > 0
        ? computeUnitPriceForCustomer(db as any, {
            customerId: order.customerId ?? null,
            productId: p.id,
            unitKind: UnitKind.PACK,
            baseUnitPrice: basePack,
          })
        : Promise.resolve(NaN),
    ]);

    let inferred: "RETAIL" | "PACK" | null = null;
    const dRetail = Number.isFinite(allowedRetail)
      ? Math.abs(unitPrice - Number(allowedRetail))
      : Number.POSITIVE_INFINITY;
    const dPack = Number.isFinite(allowedPack)
      ? Math.abs(unitPrice - Number(allowedPack))
      : Number.POSITIVE_INFINITY;

    if (
      dRetail === Number.POSITIVE_INFINITY &&
      dPack === Number.POSITIVE_INFINITY
    ) {
      // fallback to base compare
      const approx = (a: number, b: number, eps = 0.25) =>
        Math.abs(a - b) <= eps;
      if (p.allowPackSale && baseRetail > 0 && approx(unitPrice, baseRetail))
        inferred = "RETAIL";
      else if (basePack > 0 && approx(unitPrice, basePack)) inferred = "PACK";
    } else {
      inferred = dRetail <= dPack && p.allowPackSale ? "RETAIL" : "PACK";
    }

    if (!inferred) {
      errors.push({ id: it.productId, reason: "Cannot infer unit kind" });
      continue;
    }

    const packStock = Number(p.stock ?? 0);
    const retailStock = Number(p.packingStock ?? 0);
    if (inferred === "RETAIL") {
      if (qty > retailStock) {
        errors.push({
          id: it.productId,
          reason: `Not enough retail stock (${retailStock} available)`,
        });
        continue;
      }
      const c = deltas.get(p.id) ?? { pack: 0, retail: 0 };
      c.retail += qty;
      deltas.set(p.id, c);
    } else {
      if (qty > packStock) {
        errors.push({
          id: it.productId,
          reason: `Not enough pack stock (${packStock} available)`,
        });
        continue;
      }
      const c = deltas.get(p.id) ?? { pack: 0, retail: 0 };
      c.pack += qty;
      deltas.set(p.id, c);
    }
  }

  // Deduct now only if fully paid OR releasing-with-balance now (and not yet released)
  const willDeductNow =
    remaining <= 1e-6 || (releaseWithBalance && !order.releasedAt);
  if (errors.length && willDeductNow) {
    return json({ ok: false, errors }, { status: 400 });
  }

  let createdPaymentId: number | null = null;

  await db.$transaction(async (tx) => {
    // 1) Record payment for the applied portion
    if (appliedPayment > 0) {
      const p = await tx.payment.create({
        data: {
          orderId: order.id,
          method: "CASH",
          amount: appliedPayment,
          refNo: "RIDER-REMIT",
        },
        select: { id: true },
      });
      createdPaymentId = p.id;
    }

    // 2) Deduct inventory if needed (release)
    if (willDeductNow) {
      for (const [pid, c] of deltas.entries()) {
        const p = byId.get(pid)!;
        await tx.product.update({
          where: { id: pid },
          data: {
            stock: Number(p.stock ?? 0) - c.pack,
            packingStock: Number(p.packingStock ?? 0) - c.retail,
          },
        });
      }
    }

    // 3) Update order state
    if (remaining <= 1e-6) {
      // fully paid
      const receiptNo = await allocateReceiptNo(tx);
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          receiptNo,
          dispatchedAt: order.dispatchedAt ?? new Date(),
          ...(releaseWithBalance && !order.releasedAt
            ? {
                releaseWithBalance: true,
                releasedApprovedBy,
                releasedAt: new Date(),
              }
            : {}),
          deliveredAt: order.deliveredAt ?? new Date(), // set delivered if not yet set
        },
      });
    } else {
      // partial
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PARTIALLY_PAID",
          isOnCredit: true,
          dispatchedAt:
            order.dispatchedAt ??
            (releaseWithBalance ? new Date() : order.dispatchedAt),
          ...(releaseWithBalance && !order.releasedAt
            ? {
                releaseWithBalance: true,
                releasedApprovedBy,
                releasedAt: new Date(),
              }
            : {}),
          deliveredAt: order.deliveredAt ?? new Date(),
        },
      });
    }
  });

  // 4) Print
  if (remaining <= 1e-6 && printReceipt) {
    return redirect(`/orders/${id}/receipt?autoprint=1&autoback=1`);
  }
  if (remaining > 0 && printReceipt && createdPaymentId) {
    const qs = new URLSearchParams({
      autoprint: "1",
      autoback: "1",
      pid: String(createdPaymentId),
    });
    return redirect(`/orders/${id}/ack?${qs.toString()}`);
  }

  return redirect("/cashier");
}

export default function RemitOrderPage() {
  const { order, pricing } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const alreadyPaid = (order.payments ?? []).reduce(
    (s: number, p: any) => s + Number(p.amount),
    0
  );
  const total = pricing.total ?? Number(order.totalBeforeDiscount);
  const due = Math.max(0, total - alreadyPaid);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-xl px-5 py-6">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h1 className="text-sm font-medium tracking-wide text-slate-800">
              Rider Remit — Order{" "}
              <span className="font-mono text-indigo-700">
                {order.orderCode}
              </span>
            </h1>
          </div>

          <div className="px-4 py-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Total (after discounts)</span>
              <span className="font-semibold">{peso(total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Already paid</span>
              <span className="font-semibold">{peso(alreadyPaid)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-700">Due now</span>
              <span className="font-semibold text-indigo-700">{peso(due)}</span>
            </div>

            <Form method="post" className="mt-2 space-y-3">
              <label className="block">
                <span className="block text-slate-700">Cash collected</span>
                <input
                  name="cashGiven"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={due.toFixed(2)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                />
              </label>

              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="printReceipt"
                  value="1"
                  className="h-4 w-4 accent-indigo-600"
                  defaultChecked
                />
                <span>Print receipt/ack after posting</span>
              </label>

              <details className="rounded-xl border border-slate-200 bg-white">
                <summary className="cursor-pointer select-none list-none px-3 py-2 text-sm text-slate-800">
                  If releasing goods with balance
                </summary>
                <div className="px-3 pb-3 space-y-3">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="releaseWithBalance"
                      value="1"
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span>Release goods now (with balance)</span>
                  </label>
                  <label className="block text-xs text-slate-600">
                    Manager PIN/Name
                    <input
                      name="releasedApprovedBy"
                      type="text"
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                      placeholder="e.g. 1234 or MGR-ANA"
                    />
                  </label>
                </div>
              </details>

              <button
                className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                disabled={nav.state !== "idle"}
              >
                {nav.state !== "idle" ? "Posting…" : "Post Remit"}
              </button>
            </Form>
          </div>
        </div>
      </div>
    </main>
  );
}
