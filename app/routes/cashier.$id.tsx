/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  Form,
  useNavigation,
} from "@remix-run/react";
import React, { useMemo } from "react";
import { allocateReceiptNo } from "~/utils/receipt";
import { CustomerPicker } from "~/components/CustomerPicker";
import { computeUnitPriceForCustomer } from "~/services/pricing";
import { UnitKind } from "@prisma/client";
import { applyDiscounts, type Cart, type Rule } from "~/services/pricing";

import { db } from "~/utils/db.server";

// Lock TTL: 5 minutes (same as queue page)
const LOCK_TTL_MS = 5 * 60 * 1000;

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: true,
      payments: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          alias: true,
          phone: true,
        },
      },
    },
  });

  if (!order) throw new Response("Not found", { status: 404 });
  const now = Date.now();
  const isStale = order.lockedAt
    ? now - order.lockedAt.getTime() > LOCK_TTL_MS
    : true;
  const lockExpiresAt = order.lockedAt
    ? order.lockedAt.getTime() + LOCK_TTL_MS
    : null;

  return json({
    order,
    isStale,
    lockExpiresAt,
    activePricingRules: [] as import("~/services/pricing").Rule[],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  const fd = await request.formData();
  const act = String(fd.get("_action") || "");
  if (act === "reprint") {
    await db.order.update({
      where: { id },
      data: { printCount: { increment: 1 }, printedAt: new Date() },
    });
    return json({ ok: true, didReprint: true });
  }
  if (act === "release") {
    await db.order.update({
      where: { id },
      data: { lockedAt: null, lockedBy: null },
    });
    return redirect("/cashier");
  }
  if (act === "settlePayment") {
    const cashGiven = Number(fd.get("cashGiven") || 0);
    const printReceipt = fd.get("printReceipt") === "1";
    const releaseWithBalance = fd.get("releaseWithBalance") === "1";
    const releasedApprovedBy =
      String(fd.get("releaseApprovedBy") || "").trim() || null;
    const discountApprovedBy =
      String(fd.get("discountApprovedBy") || "").trim() || null;

    const customerId = Number(fd.get("customerId") || 0) || null;

    // Cashier requires an actual payment (> 0). Full-utang is a separate flow.
    if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
      return json(
        {
          ok: false,
          error: "Enter cash > 0. For full utang, use “Record as Credit”.",
        },
        { status: 400 }
      );
    }

    // Load order (with items + payments for running balance)
    const order = await db.order.findUnique({
      where: { id },
      include: { items: true, payments: true },
    });
    if (!order)
      return json({ ok: false, error: "Order not found" }, { status: 404 });
    if (order.status !== "UNPAID" && order.status !== "PARTIALLY_PAID") {
      return json(
        { ok: false, error: "Order is already settled/voided" },
        { status: 400 }
      );
    }

    const total = Number(order.totalBeforeDiscount);
    const alreadyPaid = (order.payments ?? []).reduce(
      (s, p) => s + Number(p.amount),
      0
    );

    const nowPaid = alreadyPaid + cashGiven;
    const remaining = Math.max(0, total - nowPaid);

    // For utang/partial balance, require a customer to carry the balance
    if (remaining > 0 && !customerId) {
      return json(
        {
          ok: false,
          error: "Select or create a customer before allowing utang.",
        },
        { status: 400 }
      );
    }
    // If releasing goods with balance, require manager approval note
    if (remaining > 0 && releaseWithBalance && !releasedApprovedBy) {
      return json(
        {
          ok: false,
          error: "Manager PIN/Name is required to release with balance.",
        },
        { status: 400 }
      );
    }

    // Fetch products (for possible deduction)
    const productIds = Array.from(new Set(order.items.map((i) => i.productId)));
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        allowPackSale: true,
        price: true,
        srp: true,
        stock: true, // packs
        packingStock: true, // retail units
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // 🔒 Final price guard: ensure no item is cheaper than allowed price for this customer
    const priceViolations: Array<{
      itemId: number;
      name: string;
      allowed: number;
      actual: number;
    }> = [];
    for (const it of order.items) {
      const p = byId.get(it.productId);
      if (!p) continue;
      // infer unit kind from snapshot vs product base
      const approx = (a: number, b: number, eps = 0.01) =>
        Math.abs(a - b) <= eps;
      const isRetail =
        p.allowPackSale &&
        Number(p.price ?? 0) > 0 &&
        approx(Number(it.unitPrice), Number(p.price ?? 0));
      const unitKind = isRetail ? UnitKind.RETAIL : UnitKind.PACK;
      const base =
        unitKind === UnitKind.RETAIL
          ? Number(p.price ?? 0)
          : Number(p.srp ?? 0);
      const allowed = await computeUnitPriceForCustomer(db, {
        customerId: order.customerId ?? null,
        productId: p.id,
        unitKind,
        baseUnitPrice: base,
      });
      const actual = Number(it.unitPrice);
      // if cashier somehow priced below allowed (e.g., older item or UI hack), block
      if (actual + 1e-6 < allowed) {
        priceViolations.push({ itemId: it.id, name: it.name, allowed, actual });
      }
    }
    if (priceViolations.length) {
      // allow only with manager override
      if (!discountApprovedBy) {
        const details = priceViolations
          .map(
            (v) =>
              `• ${v.name}: allowed ₱${v.allowed.toFixed(
                2
              )}, actual ₱${v.actual.toFixed(2)}`
          )
          .join("\n");
        return json(
          {
            ok: false,
            error:
              "Price below allowed. Manager approval required.\n" + details,
          },
          { status: 400 }
        );
      }
    }

    // Build deltas (retail vs pack) using price inference
    const errors: Array<{ id: number; reason: string }> = [];
    const deltas = new Map<number, { pack: number; retail: number }>();
    const approxEqual = (a: number, b: number, eps = 0.01) =>
      Math.abs(a - b) <= eps;

    for (const it of order.items) {
      const p = byId.get(it.productId);
      if (!p) {
        errors.push({ id: it.productId, reason: "Product missing" });
        continue;
      }
      const unitPrice = Number(it.unitPrice);
      const qty = Number(it.qty);
      const price = Number(p.price ?? 0);
      const srp = Number(p.srp ?? 0);
      const packStock = Number(p.stock ?? 0);
      const retailStock = Number(p.packingStock ?? 0);

      if (p.allowPackSale && price > 0 && approxEqual(unitPrice, price)) {
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
      } else if (srp > 0 && approxEqual(unitPrice, srp)) {
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
      } else {
        errors.push({
          id: it.productId,
          reason: "Cannot infer mode from unitPrice (price changed?)",
        });
      }
    }

    // We only need to block on stock errors when we are going to deduct now:
    // - full payment (remaining == 0) OR
    // - partial but releasing with balance (releaseWithBalance) and not yet released.
    const willDeductNow =
      remaining <= 1e-6 || (releaseWithBalance && !order.releasedAt);
    if (errors.length && willDeductNow) {
      return json({ ok: false, errors }, { status: 400 });
    }

    let createdPaymentId: number | null = null;

    // Perform everything atomically
    await db.$transaction(async (tx) => {
      // 0) Attach/keep customer if provided
      if (customerId) {
        await tx.order.update({
          where: { id: order.id },
          data: { customerId },
        });
      }

      // 1) Record payment (cashier path always > 0 now)
      const p = await tx.payment.create({
        data: { orderId: order.id, method: "CASH", amount: cashGiven },
        select: { id: true },
      });
      createdPaymentId = p.id;

      // 2) Deduct inventory only when needed (see rule above)
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

      // 2.a) Price audit per item (allowed unit price + policy + optional manager override)
      for (const it of order.items) {
        const p = byId.get(it.productId);
        if (!p) continue;
        const approx = (a: number, b: number, eps = 0.01) =>
          Math.abs(a - b) <= eps;
        const isRetail =
          p.allowPackSale &&
          Number(p.price ?? 0) > 0 &&
          approx(Number(it.unitPrice), Number(p.price ?? 0));
        const unitKind = isRetail ? UnitKind.RETAIL : UnitKind.PACK;
        const baseUnitPrice =
          unitKind === UnitKind.RETAIL
            ? Number(p.price ?? 0)
            : Number(p.srp ?? 0);

        const allowed = await computeUnitPriceForCustomer(tx as any, {
          customerId: order.customerId ?? null,
          productId: p.id,
          unitKind,
          baseUnitPrice,
        });
        const pricePolicy =
          Math.abs(allowed - baseUnitPrice) <= 0.009 ? "BASE" : "PER_ITEM";

        await tx.orderItem.update({
          where: { id: it.id },
          data: {
            allowedUnitPrice: allowed,
            pricePolicy,
            ...(Number(it.unitPrice) + 1e-6 < allowed && discountApprovedBy
              ? { discountApprovedBy }
              : {}),
          },
        });
      }

      // 3) Update order status & fields
      if (remaining <= 1e-6) {
        // Fully paid
        const receiptNo = await allocateReceiptNo(tx);
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "PAID",
            paidAt: new Date(),
            receiptNo,
            lockedAt: null,
            lockedBy: null,
            // if cashier picked a customer anyway, persist it
            ...(customerId ? { customerId } : {}),
            // If this full payment also did a release now, persist release metadata.
            ...(releaseWithBalance && !order.releasedAt
              ? {
                  releaseWithBalance: true,
                  releasedApprovedBy,
                  releasedAt: new Date(),
                }
              : {}),
          },
        });
      } else {
        // Partial payment
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "PARTIALLY_PAID",
            isOnCredit: true,
            ...(customerId ? { customerId } : {}),
            lockedAt: null,
            lockedBy: null,
            ...(releaseWithBalance && !order.releasedAt
              ? {
                  releaseWithBalance: true,
                  releasedApprovedBy,
                  releasedAt: new Date(),
                }
              : {}),
          },
        });
      }
    });

    // Navigate
    if (remaining <= 1e-6 && printReceipt) {
      // Official Receipt for fully-paid
      return redirect(`/orders/${id}/receipt?autoprint=1&autoback=1`);
    }

    // Partial payment → Acknowledgment
    if (remaining > 0 && printReceipt && createdPaymentId) {
      const qs = new URLSearchParams({
        autoprint: "1",
        autoback: "1",
        pid: String(createdPaymentId),
      });
      return redirect(`/orders/${id}/ack?${qs.toString()}`);
    }

    // Otherwise just go back to queue (ensures we don't fall through)
    return redirect("/cashier");
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CashierOrder() {
  const { order, isStale, lockExpiresAt, activePricingRules } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [printReceipt, setPrintReceipt] = React.useState(true); // default: checked like order-pad toggle
  // Cash input + change preview
  const [cashGiven, setCashGiven] = React.useState("");
  const [customer, setCustomer] = React.useState<{
    id: number;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    alias?: string | null;
    phone?: string | null;
  } | null>(order.customer ?? null);
  const total = Number(order.totalBeforeDiscount);
  const alreadyPaid =
    order.payments?.reduce((s: number, p: any) => s + Number(p.amount), 0) || 0;
  const entered = Number(cashGiven) || 0;
  const dueBefore = Math.max(0, total - alreadyPaid);
  const changePreview = entered > 0 ? Math.max(0, entered - dueBefore) : 0;
  const balanceAfterThisPayment = Math.max(0, total - alreadyPaid - entered);
  const willBePartial = balanceAfterThisPayment > 0;

  const [remaining, setRemaining] = React.useState(
    lockExpiresAt ? lockExpiresAt - Date.now() : 0
  );

  // ...inside CashierOrder component (top of render state)

  React.useEffect(() => {
    if (actionData && (actionData as any).redirectToReceipt) {
      window.location.assign((actionData as any).redirectToReceipt);
    }
  }, [actionData]);
  React.useEffect(() => {
    if (!lockExpiresAt) return;
    const id = setInterval(() => {
      setRemaining(lockExpiresAt - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [lockExpiresAt]);

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  // ---------- Discount engine (read-only preview) ----------
  // 1) Build a Cart from current order items
  const cart = useMemo<Cart>(
    () => ({
      items: (order.items ?? []).map((it: any) => ({
        id: it.id,
        productId: it.productId,
        name: it.name,
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        // optional selectors (use if you have them on loader include)
        categoryId: (it as any).product?.categoryId ?? null,
        brandId: (it as any).product?.brandId ?? null,
        sku: (it as any).product?.sku ?? null,
      })),
    }),
    [order.items]
  );

  // 2) Active rules (memoized; filter out null/undefined just in case)
  const rules = useMemo<Rule[]>(
    () =>
      Array.isArray(activePricingRules)
        ? (activePricingRules.filter(Boolean) as Rule[])
        : [],
    [activePricingRules]
  );

  // 3) Customer context (minimal for now)
  const ctx = useMemo(
    () => ({
      id: order.customer?.id ?? null,
    }),
    [order.customer?.id]
  );

  // 4) Compute
  const pricing = useMemo(
    () => applyDiscounts(cart, rules, ctx),
    [cart, rules, ctx]
  );
  // ---------------------------------------------------------

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Page header */}
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                Order{" "}
                <span className="font-mono text-indigo-700">
                  {order.orderCode}
                </span>
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ring-1 ${
                    order.lockedBy
                      ? "bg-amber-50 text-amber-700 ring-amber-200"
                      : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                  {order.lockedBy ? `Locked by ${order.lockedBy}` : "Unlocked"}
                  {isStale && <span className="ml-1 opacity-70">• stale</span>}
                </span>

                {!isStale && typeof remaining === "number" && remaining > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 ring-1 ring-slate-200">
                    Lock expires in{" "}
                    <span className="font-mono tabular-nums">
                      {String(
                        Math.max(0, Math.floor(remaining / 60000))
                      ).padStart(2, "0")}
                      :
                      {String(
                        Math.max(0, Math.floor((remaining % 60000) / 1000))
                      ).padStart(2, "0")}
                    </span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Form method="post">
                <input type="hidden" name="_action" value="reprint" />
                <button className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 active:shadow-none">
                  Reprint
                </button>
              </Form>
              <Form method="post">
                <input type="hidden" name="_action" value="release" />
                <button className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 active:shadow-none">
                  Release
                </button>
              </Form>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-5 py-6">
        {/* Content grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left: items */}
          <section className="lg:col-span-2">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-medium tracking-wide text-slate-700">
                  Items
                </h2>
                <span className="text-xs text-slate-500">
                  {order.items.length} item(s)
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {(order.items ?? []).map((it: any) => {
                  const adj = pricing.adjustedItems.find(
                    (ai) => ai.id === it.id
                  );
                  const effUnit =
                    adj?.effectiveUnitPrice ?? Number(it.unitPrice);
                  const discounted = Number(effUnit) !== Number(it.unitPrice);
                  const originalLine = Number(it.lineTotal);
                  const effLine = Math.max(0, Number(it.qty) * effUnit);
                  return (
                    <div
                      key={it.id}
                      className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/60"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {it.name}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {it.qty} ×{" "}
                          {discounted ? (
                            <>
                              <s className="text-slate-400">
                                {peso(Number(it.unitPrice))}
                              </s>{" "}
                              <strong>{peso(effUnit)}</strong>
                            </>
                          ) : (
                            <>{peso(effUnit)}</>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-sm font-semibold text-slate-900">
                        {discounted ? (
                          <>
                            <s className="mr-1 text-slate-400">
                              {peso(originalLine)}
                            </s>
                            <span>{peso(effLine)}</span>
                          </>
                        ) : (
                          <span>{peso(originalLine)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-medium text-slate-900">
                  {peso(pricing.subtotal)}
                </span>
              </div>
              {pricing.discounts.map((d) => (
                <div
                  key={d.ruleId}
                  className="flex items-center justify-between text-sm text-rose-700"
                >
                  <span className="text-rose-700">Less: {d.name}</span>
                  <span>-{peso(d.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Total (before discounts)</span>
                <span className="font-semibold text-slate-900">
                  {peso(Number(order.totalBeforeDiscount))}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm font-semibold text-indigo-700">
                <span>Total after discounts (preview)</span>
                <span>{peso(pricing.total)}</span>
              </div>
            </div>
          </section>

          {/* Right: payment card */}
          <aside className="lg:col-span-1">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-medium tracking-wide text-slate-700">
                  Payment
                </h3>
                <span className="text-[11px] text-slate-500">
                  (MVP: marks PAID & deducts inventory)
                </span>
              </div>

              <div className="px-4 py-4">
                {actionData &&
                "errors" in actionData &&
                actionData.errors?.length ? (
                  <ul className="mb-3 list-disc pl-5 text-sm text-red-700">
                    {actionData.errors.map((e: any, i: number) => (
                      <li key={i}>
                        Product #{e.id}: {e.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {actionData &&
                "error" in actionData &&
                (actionData as any).error ? (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {(actionData as any).error}
                  </div>
                ) : null}

                {actionData && "paid" in actionData && actionData.paid ? (
                  <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Paid ✔ Inventory deducted.
                  </div>
                ) : null}

                <Form id="settle-form" method="post" className="space-y-3">
                  <input type="hidden" name="_action" value="settlePayment" />
                  <input
                    type="hidden"
                    name="customerId"
                    value={customer?.id ?? ""}
                  />
                  {/* Quick link to full-credit flow (no payment here) */}
                  <div className="flex justify-end -mb-1">
                    <a
                      href={`/orders/${order.id}/credit`}
                      className="text-xs text-indigo-600 hover:underline"
                      title="Record this as full utang / credit without taking payment"
                    >
                      Record as Credit (no payment)
                    </a>
                  </div>
                  {/* Customer (required if utang / partial / zero-cash) */}
                  <div className="mb-3">
                    <label className="block text-sm text-slate-700 mb-1">
                      Customer
                    </label>
                    <CustomerPicker value={customer} onChange={setCustomer} />
                    {willBePartial && !customer && (
                      <div className="mt-1 text-xs text-red-700">
                        Required for utang / partial payments.
                      </div>
                    )}
                  </div>

                  <label className="block text-sm">
                    <span className="text-slate-700">Cash received</span>
                    <input
                      name="cashGiven"
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashGiven}
                      onChange={(e) => setCashGiven(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  </label>

                  <label className="mt-1 inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="printReceipt"
                      value="1"
                      checked={printReceipt}
                      onChange={(e) => setPrintReceipt(e.target.checked)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span>Print receipt after paying</span>
                  </label>

                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Change (preview)</span>
                    <span className="font-semibold text-slate-900">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(changePreview)}
                    </span>
                  </div>

                  {/* Balance after this payment (preview) */}
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      Balance (after this payment)
                    </span>
                    <span className="font-semibold text-slate-900">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(balanceAfterThisPayment)}
                    </span>
                  </div>

                  {/* Release with balance (manager approval) */}
                  <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="releaseWithBalance"
                      value="1"
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span>Release goods now (with balance)</span>
                  </label>
                  <label className="block text-xs text-slate-600">
                    Manager PIN/Name (for release)
                    <input
                      name="releaseApprovedBy"
                      type="text"
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                      placeholder="e.g. 1234 or MGR-ANA"
                    />
                  </label>
                  {/* Manager approval if prices are below allowed */}
                  <label className="block text-xs text-slate-600">
                    Manager PIN/Name (required if price lessthan allowed)
                    <input
                      name="discountApprovedBy"
                      type="text"
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                      placeholder="e.g. MGR-ANA"
                    />
                  </label>

                  <button
                    type="submit"
                    className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
                    disabled={
                      isStale ||
                      nav.state !== "idle" ||
                      (willBePartial && !customer)
                    }
                    title={
                      isStale
                        ? "Lock is stale; re-open from queue"
                        : willBePartial
                        ? "Record partial payment"
                        : "Submit payment"
                    }
                  >
                    {nav.state !== "idle"
                      ? "Completing…"
                      : printReceipt
                      ? willBePartial
                        ? "Complete & Print Ack"
                        : "Complete & Print Receipt"
                      : "Complete Sale"}
                  </button>
                </Form>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Sticky action footer for mobile comfort */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur px-5 py-3">
        <div className="mx-auto max-w-4xl">
          <button
            type="submit"
            form="settle-form"
            className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            disabled={
              isStale || nav.state !== "idle" || (willBePartial && !customer)
            }
            title={
              isStale
                ? "Lock is stale; re-open from queue"
                : willBePartial
                ? "Record partial payment"
                : "Mark as PAID"
            }
          >
            {nav.state !== "idle"
              ? "Completing…"
              : printReceipt
              ? willBePartial
                ? "Complete & Print Ack"
                : "Complete & Print Receipt"
              : "Complete Sale"}
          </button>
        </div>
      </div>
    </main>
  );
}
