/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useNavigate,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { CustomerPicker } from "~/components/CustomerPicker";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    include: { items: true, payments: true, customer: true },
  });
  if (!order) throw new Response("Not found", { status: 404 });

  if (!(order.status === "UNPAID" || order.status === "PARTIALLY_PAID")) {
    throw new Response("Order cannot be credited", { status: 400 });
  }

  const total = Number(order.totalBeforeDiscount);
  const paid = (order.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, total - paid);

  return json({ order, total, paid, remaining });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id))
    return json({ ok: false, error: "Invalid ID" }, { status: 400 });

  const fd = await request.formData();
  const customerId = Number(fd.get("customerId") || 0) || null;
  const dueDateRaw = String(fd.get("dueDate") || "").trim();
  const releaseNow = fd.get("releaseWithBalance") === "1";
  const approver = String(fd.get("releaseApprovedBy") || "").trim() || null;

  if (!customerId) {
    return json(
      { ok: false, error: "Customer is required for full credit." },
      { status: 400 }
    );
  }
  if (releaseNow && !approver) {
    return json(
      { ok: false, error: "Manager PIN/Name is required to release goods." },
      { status: 400 }
    );
  }

  const order = await db.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order)
    return json({ ok: false, error: "Order not found" }, { status: 404 });

  // compute inventory deltas for potential release
  const productIds = Array.from(new Set(order.items.map((i) => i.productId)));
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      price: true,
      srp: true,
      allowPackSale: true,
      stock: true,
      packingStock: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const approxEqual = (a: number, b: number, eps = 0.01) =>
    Math.abs(a - b) <= eps;

  const deltas = new Map<number, { pack: number; retail: number }>();
  const errors: Array<{ id: number; reason: string }> = [];

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

  if (releaseNow && errors.length) {
    return json({ ok: false, errors }, { status: 400 });
  }

  const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;

  await db.$transaction(async (tx) => {
    // attach customer + mark as credit
    await tx.order.update({
      where: { id: order.id },
      data: {
        customerId,
        isOnCredit: true,
        dueDate,
        // keep status UNPAID (no payment). If it already had partial payments, keep PARTIALLY_PAID.
      },
    });

    if (releaseNow && !order.releasedAt) {
      // deduct inventory and mark released
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
      await tx.order.update({
        where: { id: order.id },
        data: {
          releaseWithBalance: true,
          releasedApprovedBy: approver,
          releasedAt: new Date(),
        },
      });
    }
  });

  // print a credit acknowledgment slip
  return redirect(`/orders/${id}/ack?autoprint=1&autoback=1`);
}

export default function CreditOrderPage() {
  const { order, remaining } = useLoaderData<typeof loader>();
  const nav = useNavigate();

  // Pre-fill picker with existing order.customer if present
  const [customer, setCustomer] = React.useState<{
    id: number;
    firstName: string;
    middleName?: string | null;
    lastName: string;
    alias?: string | null;
    phone?: string | null;
  } | null>(
    order.customer
      ? {
          id: order.customer.id,
          firstName: (order.customer as any).firstName ?? "",
          middleName: (order.customer as any).middleName ?? null,
          lastName: (order.customer as any).lastName ?? "",
          alias: (order.customer as any).alias ?? null,
          phone: (order.customer as any).phone ?? null,
        }
      : null
  );

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">
                Credit (Full Utang)
              </h1>
              <div className="mt-1 text-xs text-slate-600">
                Order{" "}
                <span className="font-mono text-indigo-700">
                  {order.orderCode}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-600">Remaining balance</div>
              <div className="text-lg font-semibold text-slate-900">
                {peso(remaining)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Card */}
      <div className="mx-auto max-w-3xl px-5 py-6">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-medium tracking-wide text-slate-700">
              Credit Details
            </h2>
          </div>

          <div className="px-4 py-4">
            <Form method="post" className="space-y-4">
              <input type="hidden" name="_action" value="credit" />

              {/* Submit actual customerId as hidden field */}
              <input
                type="hidden"
                name="customerId"
                value={customer?.id ?? ""}
              />

              {/* Customer Picker */}
              <div>
                <div className="mb-1 block text-sm text-slate-700">Customer</div>
                <CustomerPicker value={customer} onChange={setCustomer} />
                {!customer && (
                  <div className="mt-1 text-xs text-red-700">
                    Customer is required for full credit.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-slate-700">Due date (optional)</span>
                  <input
                    name="dueDate"
                    type="date"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                  />
                </label>

                <div className="pt-5 md:pt-7">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="releaseWithBalance"
                      value="1"
                      className="h-4 w-4 accent-indigo-600 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                    />
                    <span>Release goods now</span>
                  </label>
                </div>
              </div>

              <label className="block text-xs text-slate-600">
                Manager PIN/Name (required if releasing)
                <input
                  name="releaseApprovedBy"
                  type="text"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                  placeholder="e.g. 1234 or MGR-ANA"
                />
              </label>

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  disabled={!customer}
                  title={!customer ? "Select a customer first" : "Save & print"}
                >
                  Save & Print Credit Ack
                </button>
                <button
                  type="button"
                  onClick={() => nav(`/cashier`)}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </Form>
          </div>
        </div>
      </div>
    </main>
  );
}
