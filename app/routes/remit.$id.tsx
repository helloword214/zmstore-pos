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
import { CustomerPicker } from "~/components/CustomerPicker";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderCode: true,
      channel: true,
      status: true,
      riderName: true,
      dispatchedAt: true,
      deliveredAt: true,
      customerId: true,
      loadoutSnapshot: true,
      subtotal: true,
      totalBeforeDiscount: true,
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

  const loadOptions: Array<{ productId: number; name: string }> = Array.isArray(
    order.loadoutSnapshot
  )
    ? (order.loadoutSnapshot as any[])
        .map((l) => ({
          productId: Number(l?.productId),
          name: String(l?.name ?? ""),
        }))
        .filter(
          (x) => Number.isFinite(x.productId) && x.productId > 0 && x.name
        )
        .reduce((acc, cur) => {
          if (!acc.find((a) => a.productId === cur.productId)) acc.push(cur);
          return acc;
        }, [] as Array<{ productId: number; name: string }>)
    : [];

  const loadIds = loadOptions.map((o) => o.productId);
  const loadProducts = loadIds.length
    ? await db.product.findMany({
        where: { id: { in: loadIds } },
        select: { id: true, price: true, srp: true },
      })
    : [];
  const priceIndex = Object.fromEntries(
    loadProducts.map((p) => [p.id, Number(p.srp ?? p.price ?? 0)])
  ) as Record<number, number>;

  return json({ order, pricing, loadOptions, priceIndex });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  const fd = await request.formData();

  const cashGiven = Number(fd.get("cashGiven") || 0);
  const releaseWithBalance = fd.get("releaseWithBalance") === "1";
  const releasedApprovedBy =
    String(fd.get("releasedApprovedBy") || "").trim() || null;

  const soldLoadJson = String(fd.get("soldLoadJson") || "[]");
  type SoldLoadRow = {
    productId: number | null;
    name: string;
    qty: number;
    unitPrice: number;
    buyerName?: string | null;
    buyerPhone?: string | null;
    customerId?: number | null;
    onCredit?: boolean;
  };
  let soldRows: SoldLoadRow[] = [];
  try {
    const parsed = JSON.parse(soldLoadJson);
    if (Array.isArray(parsed)) {
      soldRows = parsed
        .map((r) => ({
          productId:
            r?.productId == null || isNaN(Number(r.productId))
              ? null
              : Number(r.productId),
          name: typeof r?.name === "string" ? r.name : "",
          qty: Math.max(0, Number(r?.qty ?? 0)),
          unitPrice: Math.max(0, Number(r?.unitPrice ?? 0)),
          buyerName:
            (typeof r?.buyerName === "string" ? r.buyerName.trim() : "") ||
            null,
          buyerPhone:
            (typeof r?.buyerPhone === "string" ? r.buyerPhone.trim() : "") ||
            null,
          customerId:
            r?.customerId == null || isNaN(Number(r.customerId))
              ? null
              : Number(r.customerId), // ← keep even for cash rows
          onCredit: Boolean(r?.onCredit),
        }))
        .filter((r) => r.qty > 0 && (r.productId != null || r.name));
    }
  } catch {
    soldRows = [];
  }

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
  const nowPaid = alreadyPaid + appliedPayment;
  const remaining = Math.max(0, total - nowPaid);

  if (remaining > 0 && !order.customerId) {
    return json(
      { ok: false, error: "Link a customer before accepting partial payment." },
      { status: 400 }
    );
  }

  const errors: Array<{ id: number; reason: string }> = [];
  const deltas = new Map<number, { pack: number; retail: number }>();

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

  const willDeductNow = false;
  if (errors.length && willDeductNow) {
    return json({ ok: false, errors }, { status: 400 });
  }

  await db.$transaction(async (tx) => {
    if (appliedPayment > 0) {
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: "CASH",
          amount: appliedPayment,
          refNo: "RIDER-REMIT",
        },
      });
    }

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

    const snapshot = Array.isArray(order.loadoutSnapshot)
      ? (order.loadoutSnapshot as any[])
      : [];
    if (snapshot.length > 0) {
      const snapshotQty = new Map<number, number>();
      for (const row of snapshot) {
        const pid = Number(row?.productId ?? NaN);
        const qty = Math.max(0, Math.floor(Number(row?.qty ?? 0)));
        if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue;
        snapshotQty.set(pid, (snapshotQty.get(pid) || 0) + qty);
      }

      const soldQty = new Map<number, number>();
      for (const row of soldRows) {
        const pid = Number(row?.productId ?? NaN);
        const qty = Math.max(0, Math.floor(Number(row?.qty ?? 0)));
        if (!Number.isFinite(pid) || pid <= 0 || qty <= 0) continue;
        soldQty.set(pid, (soldQty.get(pid) || 0) + qty);
      }

      for (const [pid, snapQ] of snapshotQty.entries()) {
        const soldQ = soldQty.get(pid) || 0;
        const leftover = Math.max(0, snapQ - soldQ);
        if (leftover > 0) {
          await tx.product.update({
            where: { id: pid },
            data: { stock: { increment: leftover } },
          });
        }
      }
      await tx.order.update({
        where: { id: order.id },
        data: { loadoutSnapshot: [] as unknown as any },
      });
    }

    // Keep credit guard: on-credit requires a customer
    const creditError = soldRows.find((r) => r.onCredit && !r.customerId);
    if (creditError) {
      return json(
        {
          ok: false,
          error: "On-credit sale requires a customer. Please select one.",
        },
        { status: 400 }
      );
    }

    for (const row of soldRows) {
      const lineTotal = Number((row.qty * row.unitPrice).toFixed(2));
      const productId = Number(row.productId);
      if (!Number.isFinite(productId)) {
        throw new Error("Invalid productId for roadside sale item.");
      }

      const roadsideCode =
        `RS-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-` +
        crypto.randomUUID().slice(0, 6).toUpperCase();

      const isCredit = !!row.onCredit;

      const newOrder = await tx.order.create({
        data: {
          channel: "DELIVERY",
          status: isCredit ? "PARTIALLY_PAID" : "PAID",
          paidAt: isCredit ? null : new Date(),
          orderCode: roadsideCode,
          printedAt: new Date(),
          expiryAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
          riderName: order.riderName ?? null,
          // ✅ Always persist customerId if provided (cash or credit)
          ...(row.customerId ? { customerId: Number(row.customerId) } : {}),
          isOnCredit: isCredit ? true : false,
          // If a customer is linked, we don't need a deliverTo fallback name;
          // keep buyerName only for explicit walk-in manually entered names.
          deliverTo: row.customerId ? null : row.buyerName || null,
          deliverPhone: row.customerId ? null : row.buyerPhone || null,
          subtotal: lineTotal,
          totalBeforeDiscount: lineTotal,
          dispatchedAt: order.dispatchedAt ?? new Date(),
          deliveredAt: new Date(),
          remitParentId: order.id,
          items: {
            create: [
              {
                productId,
                name: row.name,
                qty: row.qty,
                unitPrice: row.unitPrice,
                lineTotal,
              },
            ],
          },
        },
        select: { id: true },
      });

      const receiptNoChild = await allocateReceiptNo(tx);
      await tx.order.update({
        where: { id: newOrder.id },
        data: { receiptNo: receiptNoChild },
      });

      if (!isCredit) {
        await tx.payment.create({
          data: {
            orderId: newOrder.id,
            method: "CASH",
            amount: lineTotal,
            refNo: "RIDER-LOAD-SALE",
          },
        });
      }
    }

    if (remaining <= 1e-6) {
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
          deliveredAt: order.deliveredAt ?? new Date(),
        },
      });
    } else {
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

  // After posting, always go to the summary (print hub)
  return redirect(`/remit-summary/${id}`);
}

export default function RemitOrderPage() {
  const { order, pricing, priceIndex } = useLoaderData<typeof loader>();
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

  type SoldRowUI = {
    key: string;
    productId: number | null;
    name: string;
    qty: number;
    unitPrice: number;
    buyerName?: string;
    buyerPhone?: string;
    customerId?: number | null;
    onCredit?: boolean;
    customerObj?: {
      id: number;
      firstName: string; // required
      lastName: string; // required
      alias?: string | null;
      phone?: string | null;
    } | null;
  };

  const loadout: Array<{
    productId: number | null;
    name: string;
    qty: number;
  }> = Array.isArray(order.loadoutSnapshot)
    ? (order.loadoutSnapshot as any).map((l: any) => ({
        productId: l?.productId == null ? null : Number(l.productId),
        name: String(l?.name || ""),
        qty: Number(l?.qty || 0),
      }))
    : [];

  const [soldRows, setSoldRows] = React.useState<SoldRowUI[]>([]);

  const defaultPriceFor = (pid: number | null): number =>
    pid != null && priceIndex[pid] != null ? Number(priceIndex[pid]) : 0;

  // (auto-print moved to /remit/:id/summary)

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl px-5 py-6">
        {/* Header */}
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-800">
              Rider Remit
            </h1>
            <div className="mt-1 text-sm text-slate-500">
              Order{" "}
              <span className="font-mono font-medium text-indigo-700">
                {order.orderCode}
              </span>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
              Channel:{" "}
              <span className="font-medium text-slate-700">
                {order.channel}
              </span>
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
              Rider:{" "}
              <span className="font-medium text-slate-700">
                {order.riderName || "—"}
              </span>
            </span>
          </div>
        </div>

        <Form method="post" className="grid gap-4 md:grid-cols-12">
          {/* Left column: remit summary */}
          <section className="md:col-span-4">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-medium text-slate-800">
                  Remittance Summary
                </h2>
              </div>
              <div className="px-4 py-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">
                    Total (after discounts)
                  </span>
                  <span className="font-semibold">{peso(total)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Already paid</span>
                  <span className="font-semibold">{peso(alreadyPaid)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-700">Due now</span>
                  <span className="font-semibold text-indigo-700">
                    {peso(due)}
                  </span>
                </div>

                <div className="pt-2">
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
                </div>

                <div className="pt-2">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="printReceipt"
                      value="1"
                      className="h-4 w-4 accent-indigo-600"
                      defaultChecked
                    />
                    <span>Go to summary & print after posting</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Release with balance */}
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-medium text-slate-800">
                  If releasing goods with balance
                </h3>
              </div>
              <div className="px-4 py-4 space-y-3 text-sm">
                <label className="inline-flex items-center gap-2 text-slate-700">
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
            </div>

            {/* Submit */}
            <div className="sticky bottom-4 mt-4">
              <button
                className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                disabled={nav.state !== "idle"}
              >
                {nav.state !== "idle" ? "Posting…" : "Post Remit"}
              </button>
            </div>
          </section>

          {/* Right column: sold-from-load */}
          <section className="md:col-span-8">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <h2 className="text-sm font-medium text-slate-800">
                    Sold from Rider Load
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Optional — one receipt per row. Pick a load line, set
                    qty/price, and (optional) buyer.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSoldRows((prev) => [
                      ...prev,
                      {
                        key: crypto.randomUUID(),
                        productId: null,
                        name: "",
                        qty: 1,
                        unitPrice: 0,
                        customerId: null,
                        customerObj: null,
                        onCredit: false,
                      },
                    ])
                  }
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  + Add sold row
                </button>
              </div>

              <div className="px-4 py-4 space-y-3">
                {soldRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center text-sm text-slate-500">
                    No sold-from-load rows yet.
                  </div>
                ) : null}

                {soldRows.map((r, idx) => (
                  <div
                    key={r.key}
                    className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs"
                  >
                    {/* Row header */}
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs font-medium text-slate-700">
                        Item #{idx + 1}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSoldRows((prev) =>
                            prev.filter((x) => x.key !== r.key)
                          )
                        }
                        className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                        aria-label="Remove row"
                        title="Remove row"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Customer + credit */}
                    <div className="grid grid-cols-12 gap-3">
                      {/* Customer picker (search + quick add, same as Cashier) */}
                      <div className="col-span-12 lg:col-span-7">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Customer (optional; required if On credit)
                        </label>
                        <CustomerPicker
                          key={`sold-cust-${r.key}`}
                          value={r.customerObj ?? null}
                          onChange={(val) => {
                            const norm = val
                              ? {
                                  id: val.id,
                                  firstName: val.firstName ?? "",
                                  lastName: val.lastName ?? "",
                                  alias: val.alias ?? null,
                                  phone: val.phone ?? null,
                                }
                              : null;
                            setSoldRows((prev) =>
                              prev.map((x) =>
                                x.key === r.key
                                  ? {
                                      ...x,
                                      customerObj: norm,
                                      customerId: norm?.id ?? null,
                                    }
                                  : x
                              )
                            );
                          }}
                        />

                        <p className="mt-1 text-[11px] text-slate-500">
                          Select an existing customer or add a new one.
                        </p>
                      </div>

                      {/* On-credit */}
                      <div className="col-span-12 lg:col-span-5 flex items-end">
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={!!r.onCredit}
                            onChange={(e) => {
                              const onCredit = e.target.checked;
                              setSoldRows((prev) =>
                                prev.map((x) =>
                                  x.key === r.key ? { ...x, onCredit } : x
                                )
                              );
                            }}
                            className="h-4 w-4 accent-indigo-600"
                          />
                          <span>Mark as credit (A/R)</span>
                        </label>
                      </div>
                    </div>

                    {/* Product + qty + price */}
                    <div className="mt-3 grid grid-cols-12 gap-3">
                      <div className="col-span-12 md:col-span-7">
                        {(() => {
                          const inputId = `sold-${r.key}-product`;
                          return (
                            <>
                              <label
                                htmlFor={inputId}
                                className="mb-1 block text-xs font-medium text-slate-600"
                              >
                                Product
                              </label>
                              <input
                                id={inputId}
                                list="soldFromLoad"
                                value={
                                  r.productId != null
                                    ? `${r.productId} | ${r.name}`
                                    : r.name
                                }
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  let pid: number | null = null;
                                  let name = raw;
                                  const m = raw.match(/^(\d+)\s*\|\s*(.+)$/);
                                  if (m) {
                                    pid = Number(m[1]);
                                    name = m[2];
                                  } else if (/^\d+$/.test(raw)) {
                                    const found = loadout.find(
                                      (x) => x.productId === Number(raw)
                                    );
                                    if (found) {
                                      pid = found.productId!;
                                      name = found.name;
                                    }
                                  } else {
                                    const found = loadout.find(
                                      (x) => x.name === raw
                                    );
                                    if (found) {
                                      pid = found.productId!;
                                      name = found.name;
                                    }
                                  }
                                  setSoldRows((prev) =>
                                    prev.map((x) =>
                                      x.key === r.key
                                        ? {
                                            ...x,
                                            productId: pid,
                                            name,
                                            unitPrice:
                                              pid != null
                                                ? defaultPriceFor(pid)
                                                : x.unitPrice,
                                          }
                                        : x
                                    )
                                  );
                                }}
                                placeholder="Search load: 123 | Product name"
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                              />
                            </>
                          );
                        })()}
                      </div>
                      <div className="col-span-6 md:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Qty
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={r.qty}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value));
                            setSoldRows((prev) =>
                              prev.map((x) =>
                                x.key === r.key ? { ...x, qty: v } : x
                              )
                            );
                          }}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-right outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                        />
                      </div>
                      <div className="col-span-6 md:col-span-3">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Unit price
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={r.unitPrice}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value));
                            setSoldRows((prev) =>
                              prev.map((x) =>
                                x.key === r.key ? { ...x, unitPrice: v } : x
                              )
                            );
                          }}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-right outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                          placeholder="Unit price"
                        />
                      </div>
                    </div>

                    {/* Walk-in imprint only if no customer */}
                    {!r.customerId && (
                      <div className="mt-3 grid grid-cols-12 gap-3">
                        <div className="col-span-12 md:col-span-6">
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Buyer name (optional)
                          </label>
                          <input
                            type="text"
                            value={r.buyerName || ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSoldRows((prev) =>
                                prev.map((x) =>
                                  x.key === r.key ? { ...x, buyerName: v } : x
                                )
                              );
                            }}
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                            placeholder="Juan D."
                          />
                        </div>
                        <div className="col-span-12 md:col-span-6">
                          <label className="mb-1 block text-xs font-medium text-slate-600">
                            Buyer phone (optional)
                          </label>
                          <input
                            type="text"
                            value={r.buyerPhone || ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSoldRows((prev) =>
                                prev.map((x) =>
                                  x.key === r.key ? { ...x, buyerPhone: v } : x
                                )
                              );
                            }}
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                            placeholder="09xx xxx xxxx"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* datalist for product search */}
                <datalist id="soldFromLoad">
                  {loadout.map((l, i) => (
                    <option
                      key={`${l.productId ?? "x"}-${i}`}
                      value={
                        l.productId != null
                          ? `${l.productId} | ${l.name}`
                          : l.name
                      }
                    />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Hidden payload for sold rows — **change: always include customerId** */}
            <input
              type="hidden"
              name="soldLoadJson"
              value={JSON.stringify(
                soldRows
                  .filter((r) => r.qty > 0 && (r.productId != null || r.name))
                  .map((r) => ({
                    productId: r.productId,
                    name: r.name,
                    qty: r.qty,
                    unitPrice: r.unitPrice,
                    buyerName: r.customerId ? null : r.buyerName || null,
                    buyerPhone: r.customerId ? null : r.buyerPhone || null,
                    customerId: r.customerId ?? null, // ← keep for cash & credit
                    onCredit: !!r.onCredit,
                  }))
              )}
            />
          </section>
        </Form>
      </div>
    </main>
  );
}
