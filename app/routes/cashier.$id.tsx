import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  Form,
  useNavigation,
} from "@remix-run/react";
import * as React from "react";
import { allocateReceiptNo } from "~/utils/receipt";
import type { PaymentMethod as PaymentMethodEnum } from "@prisma/client";
import { db } from "~/utils/db.server";

// Lock TTL: 5 minutes (same as queue page)
const LOCK_TTL_MS = 5 * 60 * 1000;

function approxEqual(a: number, b: number, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  const order = await db.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) throw new Response("Not found", { status: 404 });
  const now = Date.now();
  const isStale = order.lockedAt
    ? now - order.lockedAt.getTime() > LOCK_TTL_MS
    : true;
  const lockExpiresAt = order.lockedAt
    ? order.lockedAt.getTime() + LOCK_TTL_MS
    : null;
  return json({ order, isStale, lockExpiresAt });
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
    // Load order with items (must be UNPAID and (ideally) locked)

    // Read cash received from the form and validate against total
    const cashGiven = Number(fd.get("cashGiven") || 0);
    const printReceipt = fd.get("printReceipt") === "1"; // new toggle

    const orderForAmount = await db.order.findUnique({
      where: { id },
      select: { totalBeforeDiscount: true, status: true },
    });
    if (!orderForAmount) {
      return json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    const total = Number(orderForAmount.totalBeforeDiscount);
    if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
      return json(
        { ok: false, error: "Enter cash received (₱)" },
        { status: 400 }
      );
    }
    if (cashGiven + 1e-6 < total) {
      return json(
        {
          ok: false,
          error: `Insufficient cash: received ₱${cashGiven.toFixed(
            2
          )}, need ₱${total.toFixed(2)}`,
        },
        { status: 400 }
      );
    }

    const order = await db.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) {
      return json({ ok: false, error: "Order not found" }, { status: 404 });
    }
    if (order.status !== "UNPAID") {
      return json({ ok: false, error: "Order is not UNPAID" }, { status: 400 });
    }

    // Fetch current product data for all items
    const productIds = Array.from(new Set(order.items.map((i) => i.productId)));
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        allowPackSale: true,
        price: true, // retail price (Decimal)
        srp: true, // pack price (Decimal)
        stock: true, // pack count (Decimal/Float)
        packingStock: true, // retail units (Decimal/Float)
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Validate deductions first
    const errors: Array<{ id: number; reason: string }> = [];
    type Deduction = { id: number; packDelta: number; retailDelta: number };
    const deltas: Deduction[] = [];

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
        // RETAIL line → deduct retail units
        if (qty > retailStock) {
          errors.push({
            id: it.productId,
            reason: `Not enough retail stock (${retailStock} available)`,
          });
          continue;
        }
        deltas.push({ id: it.productId, packDelta: 0, retailDelta: qty });
      } else if (srp > 0 && approxEqual(unitPrice, srp)) {
        // PACK line → deduct pack count
        // qty should be integer for packs, but we’ll still guard the stock math
        if (qty > packStock) {
          errors.push({
            id: it.productId,
            reason: `Not enough pack stock (${packStock} available)`,
          });
          continue;
        }
        deltas.push({ id: it.productId, packDelta: qty, retailDelta: 0 });
      } else {
        errors.push({
          id: it.productId,
          reason: "Cannot infer mode from unitPrice (price changed?)",
        });
      }
    }

    if (errors.length) {
      return json({ ok: false, errors }, { status: 400 });
    }

    // 2) ✅ Consolidate `deltas` per product (now that `deltas` is filled)
    const combined = new Map<number, { pack: number; retail: number }>();
    for (const d of deltas) {
      const c = combined.get(d.id) ?? { pack: 0, retail: 0 };
      c.pack += d.packDelta;
      c.retail += d.retailDelta;
      combined.set(d.id, c);
    }

    // Apply deductions + mark PAID in a transaction
    await db.$transaction(async (tx) => {
      // 1) Deduct consolidated deltas (your existing loop)
      for (const [pid, c] of combined.entries()) {
        const p = byId.get(pid)!;
        const newPack = Number(p.stock ?? 0) - c.pack;
        const newRetail = Number(p.packingStock ?? 0) - c.retail;
        await tx.product.update({
          where: { id: pid },
          data: { stock: newPack, packingStock: newRetail },
        });
      }

      // 2) Allocate receiptNo
      const receiptNo = await allocateReceiptNo(tx);

      // 3) Mark order PAID + set paidAt + receiptNo
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          receiptNo,
          lockedAt: null,
          lockedBy: null,
        },
      });

      // 4) Record payment (Cash full amount for now)
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: "CASH" as PaymentMethodEnum, // type-only enum
          amount: cashGiven, // what the customer handed
        },
      });
    });
    // Branch navigation: print or go back to queue
    if (printReceipt) {
      return redirect(`/orders/${id}/receipt?autoprint=1&autoback=1`);
    }
    return redirect("/cashier");
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CashierOrder() {
  const { order, isStale, lockExpiresAt } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [printReceipt, setPrintReceipt] = React.useState(true); // default: checked like kiosk toggle
  // Cash input + change preview
  const [cashGiven, setCashGiven] = React.useState("");
  const total = Number(order.totalBeforeDiscount);
  const entered = Number(cashGiven) || 0;
  const changePreview = entered > 0 ? Math.max(0, entered - total) : 0;
  const [remaining, setRemaining] = React.useState(
    lockExpiresAt ? lockExpiresAt - Date.now() : 0
  );
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
                  className={`
                inline-flex items-center gap-1 rounded-full px-2.5 py-1
                ${
                  order.lockedBy
                    ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                    : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                }
              `}
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
                {order.items.map((it) => (
                  <div
                    key={it.id}
                    className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/60"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {it.name}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {it.qty} × {peso(Number(it.unitPrice))}
                      </div>
                    </div>
                    <div className="text-right text-sm font-semibold text-slate-900">
                      {peso(Number(it.lineTotal))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="space-y-2 border-t border-slate-100 px-4 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="font-medium text-slate-900">
                    {peso(Number(order.subtotal))}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">
                    Total (before discounts)
                  </span>
                  <span className="font-semibold text-slate-900">
                    {peso(Number(order.totalBeforeDiscount))}
                  </span>
                </div>
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

                <Form method="post" className="space-y-3">
                  <input type="hidden" name="_action" value="settlePayment" />

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

                  <button
                    type="submit"
                    className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
                    disabled={isStale || nav.state !== "idle"}
                    title={
                      isStale
                        ? "Lock is stale; re-open from queue"
                        : "Mark as PAID"
                    }
                  >
                    {nav.state !== "idle"
                      ? "Completing…"
                      : printReceipt
                      ? "Complete & Print Receipt"
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
            formAction="post"
            className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            disabled={isStale || nav.state !== "idle"}
          >
            {nav.state !== "idle"
              ? "Completing…"
              : printReceipt
              ? "Complete & Print Receipt"
              : "Complete Sale"}
          </button>
        </div>
      </div>
    </main>
  );
}
