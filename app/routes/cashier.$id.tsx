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
    <main className="max-w-3xl mx-auto p-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Order {order.orderCode}</h1>
          <div className="text-xs text-gray-600">
            {order.lockedBy ? `Locked by ${order.lockedBy}` : "Unlocked"}
            {isStale && " • stale"}
          </div>
          {!isStale && typeof remaining === "number" && remaining > 0 && (
            <div className="text-xs text-amber-700 mt-1">
              Lock expires in{" "}
              <span className="font-mono">
                {String(Math.max(0, Math.floor(remaining / 60000))).padStart(
                  2,
                  "0"
                )}
                :
                {String(
                  Math.max(0, Math.floor((remaining % 60000) / 1000))
                ).padStart(2, "0")}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Form method="post">
            <input type="hidden" name="_action" value="reprint" />
            <button className="px-3 py-1.5 rounded border text-gray-600">
              Reprint
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="_action" value="release" />
            <button className="px-3 py-1.5 rounded border text-gray-600">
              Release
            </button>
          </Form>
        </div>
      </div>
      <div className="mt-3 border rounded divide-y">
        {order.items.map((it) => (
          <div
            key={it.id}
            className="flex items-center justify-between px-3 py-2 text-sm text-gray-600"
          >
            <div>
              <div className="font-medium">{it.name}</div>
              <div className="text-xs text-gray-600">
                {it.qty} × {peso(Number(it.unitPrice))}
              </div>
            </div>
            <div className="font-semibold">{peso(Number(it.lineTotal))}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="font-medium">{peso(Number(order.subtotal))}</span>
        </div>
        <div className="flex justify-between">
          <span>Total (before discounts)</span>
          <span className="font-semibold">
            {peso(Number(order.totalBeforeDiscount))}
          </span>
        </div>
      </div>
      {/* Payment (MVP) */}
      <div className="mt-4 p-3 border rounded">
        <div className="flex items-center justify-between">
          <div className="font-medium">Payment</div>
          <div className="text-xs text-gray-600">
            (MVP: marks order PAID and deducts inventory)
          </div>
        </div>
        {actionData && "errors" in actionData && actionData.errors?.length ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-red-700">
            {actionData.errors.map((e: any, i: number) => (
              <li key={i}>
                Product #{e.id}: {e.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {actionData && "error" in actionData && (actionData as any).error ? (
          <div className="mt-2 text-sm text-red-600">
            {(actionData as any).error}
          </div>
        ) : null}
        {actionData && "paid" in actionData && actionData.paid ? (
          <div className="mt-2 text-sm text-green-700">
            Paid ✔ Inventory deducted.
          </div>
        ) : null}
        <Form method="post" className="mt-3">
          <input type="hidden" name="_action" value="settlePayment" />
          <label className="block text-sm text-gray-600">
            Cash received
            <input
              name="cashGiven"
              type="number"
              step="0.01"
              min="0"
              value={cashGiven}
              onChange={(e) => setCashGiven(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2"
              placeholder="0.00"
              inputMode="decimal"
            />
          </label>
          <label className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="printReceipt"
              value="1"
              checked={printReceipt}
              onChange={(e) => setPrintReceipt(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Print receipt after paying</span>
          </label>
          <div className="mt-2 text-sm flex justify-between">
            <span>Change (preview)</span>
            <span className="font-medium">
              {new Intl.NumberFormat("en-PH", {
                style: "currency",
                currency: "PHP",
              }).format(changePreview)}
            </span>
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={isStale || nav.state !== "idle"}
            title={
              isStale ? "Lock is stale; re-open from queue" : "Mark as PAID"
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
    </main>
  );
}
