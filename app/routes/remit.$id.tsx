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
import { CurrencyInput } from "~/components/ui/CurrencyInput";

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
        .map((r) => {
          const pid =
            r?.productId == null || isNaN(Number(r.productId))
              ? null
              : Number(r.productId);
          return {
            productId: pid, // must be a valid product
            name: typeof r?.name === "string" ? r.name : "",
            // PACK-only → integer qty
            qty: Math.max(0, Math.floor(Number(r?.qty ?? 0))),
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
                : Number(r.customerId), // keep even for cash rows
            onCredit: Boolean(r?.onCredit),
          };
        })
        // disallow name-only rows; require a valid productId
        .filter(
          (r) =>
            r.qty > 0 &&
            Number.isFinite(Number(r.productId)) &&
            Number(r.productId) > 0
        ) as SoldLoadRow[];
    }
  } catch {
    soldRows = [];
  }

  // Guard: compute allowed per sold-from-load row
  const soldProductIds = Array.from(
    new Set(
      soldRows
        .map((r) => Number(r.productId))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  ) as number[];
  const soldProducts = soldProductIds.length
    ? await db.product.findMany({
        where: { id: { in: soldProductIds } },
        select: { id: true, srp: true, price: true },
      })
    : [];
  const soldById = new Map(soldProducts.map((p) => [p.id, p]));

  const soldViolations: string[] = [];
  for (const r of soldRows) {
    const pid = Number(r.productId);
    if (!Number.isFinite(pid)) continue;
    const p = soldById.get(pid);
    if (!p) continue;
    // Treat load sales as PACK units
    const basePack = Number(p.srp ?? p.price ?? 0);
    const allowed = await computeUnitPriceForCustomer(db as any, {
      customerId: r.customerId ?? null,
      productId: pid,
      unitKind: UnitKind.PACK,
      baseUnitPrice: basePack,
    });
    const isCreditRow = !!r.onCredit && !!r.customerId;
    // Allow below-allowed only if on-credit AND linked to a customer
    if (Number(r.unitPrice) + 1e-6 < allowed && !isCreditRow) {
      soldViolations.push(
        `• ${r.name || `#${pid}`}: allowed ₱${allowed.toFixed(
          2
        )}, actual ₱${Number(r.unitPrice).toFixed(2)}`
      );
    }
  }
  if (soldViolations.length) {
    return json(
      {
        ok: false,
        error:
          "Sold-from-load below allowed (cash or no customer). Link a customer and mark On credit to allow.\n" +
          soldViolations.join("\n"),
      },
      { status: 400 }
    );
  }

  // ✅ Early guard (outside transaction): on-credit requires a linked customer
  const creditRowMissingCustomer = soldRows.find(
    (r) => r.onCredit && !r.customerId
  );
  if (creditRowMissingCustomer) {
    return json(
      {
        ok: false,
        error: "On-credit sale requires a customer. Please select one.",
      },
      { status: 400 }
    );
  }

  if (!Number.isFinite(cashGiven) || cashGiven < 0) {
    return json(
      { ok: false, error: "Invalid collected cash." },
      { status: 400 }
    );
  }

  // fetch order with snapshot for load validation
  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      customerId: true,
      riderName: true,
      dispatchedAt: true,
      deliveredAt: true,
      releasedAt: true,
      items: true,
      payments: true,
      loadoutSnapshot: true, // 👈 needed below
    },
  });
  if (!order)
    return json({ ok: false, error: "Order not found" }, { status: 404 });
  if (order.status === "PAID") {
    return json({ ok: false, error: "Order already paid" }, { status: 400 });
  }

  // 🛡️ Guard: sold-from-load cannot exceed loaded snapshot per product
  {
    const snapshot = Array.isArray(order.loadoutSnapshot)
      ? (order.loadoutSnapshot as any[])
      : [];
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
    for (const [pid, sQty] of soldQty.entries()) {
      const loaded = snapshotQty.get(pid) || 0;
      if (sQty > loaded) {
        return json(
          {
            ok: false,
            error: `Sold qty (${sQty}) exceeds loaded qty (${loaded}) for product #${pid}. Adjust the sold rows.`,
          },
          { status: 400 }
        );
      }
    }
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

  // (price-guard for main order moved below after computing `remaining`)
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
  // Final total after discounts (same logic as UI)
  const adjustedById = new Map(
    (pricing.adjustedItems ?? []).map((a: any) => [a.id, a])
  );
  let _final = 0;
  for (const it of order.items) {
    const qty = Number(it.qty);
    const origUnit = Number(it.unitPrice);
    const effUnit = Number(
      adjustedById.get(it.id)?.effectiveUnitPrice ?? origUnit
    );
    _final += effUnit * qty;
  }
  const finalTotal = Math.round(_final * 100) / 100;

  const alreadyPaid = (order.payments ?? []).reduce(
    (s, p) => s + Number(p.amount),
    0
  );
  const dueBefore = Math.max(0, finalTotal - alreadyPaid);

  const appliedPayment = Math.min(Math.max(0, cashGiven), dueBefore);
  const nowPaid = alreadyPaid + appliedPayment;
  const remaining = Math.max(0, finalTotal - nowPaid);

  if (remaining > 0 && !order.customerId) {
    return json(
      { ok: false, error: "Link a customer before accepting partial payment." },
      { status: 400 }
    );
  }

  // 🔒 Final price guard (main order):
  // Allow below-allowed IF there's a customer AND we will leave a balance (on-credit).
  const allowMainOrderUnderAllowed = !!order.customerId && remaining > 0;
  const priceViolations: Array<{
    itemId: number;
    name: string;
    allowed: number;
    actual: number;
  }> = [];
  for (const it of order.items) {
    const p = byId.get(it.productId);
    if (!p) continue;
    const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;
    const baseRetail = Number(p.price ?? 0);
    const basePack = Number(p.srp ?? 0);
    const isRetail =
      p.allowPackSale &&
      baseRetail > 0 &&
      approx(Number(it.unitPrice), baseRetail);
    const unitKind = isRetail ? UnitKind.RETAIL : UnitKind.PACK;
    const baseUnitPrice = unitKind === UnitKind.RETAIL ? baseRetail : basePack;
    const allowed = await computeUnitPriceForCustomer(db as any, {
      customerId: order.customerId ?? null,
      productId: p.id,
      unitKind,
      baseUnitPrice,
    });
    const actual = Number(it.unitPrice);
    if (actual + 1e-6 < allowed) {
      priceViolations.push({ itemId: it.id, name: it.name, allowed, actual });
    }
  }
  if (priceViolations.length && !allowMainOrderUnderAllowed) {
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
        error: "Price below allowed for a fully-paid remit.\n" + details,
      },
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
    // (C.1) Persist allowedUnitPrice / pricePolicy
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
        },
      });
    }

    // 🧮 Persist discounted snapshot for parent order/items (single source of truth for summary)
    {
      const adjustedByIdTx = new Map(
        (pricing.adjustedItems ?? []).map((a: any) => [a.id, a])
      );
      let origSubtotal = 0;
      let finalSubtotal = 0;
      for (const it of order.items) {
        const qty = Number(it.qty);
        const origUnit = Number(it.unitPrice);
        const effUnit = Number(
          adjustedByIdTx.get(it.id)?.effectiveUnitPrice ?? origUnit
        );
        const lineBefore = Math.round(origUnit * qty * 100) / 100;
        const lineAfter = Math.round(effUnit * qty * 100) / 100;
        origSubtotal += lineBefore;
        finalSubtotal += lineAfter;
        await tx.orderItem.update({
          where: { id: it.id },
          data: { lineTotal: lineAfter },
        });
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          // convention:
          // subtotal            = original subtotal (pre-discount)
          // totalBeforeDiscount = final total (post-discount)
          subtotal: Math.round(origSubtotal * 100) / 100,
          totalBeforeDiscount: Math.round(finalSubtotal * 100) / 100,
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

    for (const row of soldRows) {
      const productId = Number(row.productId);
      // rows are validated earlier; keep a no-op safeguard
      if (!Number.isFinite(productId)) continue;

      // derive final unit price using customer's allowed price when appropriate
      const approx = (a: number, b: number, eps = 0.009) =>
        Math.abs(a - b) <= eps;
      const pForRow = soldById.get(productId);
      const basePack = Number(pForRow?.srp ?? pForRow?.price ?? 0);
      const allowedForRow = await computeUnitPriceForCustomer(tx as any, {
        customerId: row.customerId ?? null,
        productId,
        unitKind: UnitKind.PACK, // roadside load = PACK pricing
        baseUnitPrice: basePack,
      });

      // Auto-apply discount only when:
      //  - may linked customer, and
      //  - hindi mano-manong binago (unitPrice 0 or ~base price)
      const autoUseAllowed =
        !!row.customerId &&
        (row.unitPrice <= 0 || approx(row.unitPrice, basePack));
      const finalUnitPrice = autoUseAllowed
        ? allowedForRow
        : Number(row.unitPrice);
      const lineTotal = Number((Number(row.qty) * finalUnitPrice).toFixed(2));

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
          // link this load-out receipt back to the Main Delivery
          remitParentId: order.id,
          items: {
            create: [
              {
                productId,
                name: row.name,
                qty: row.qty,
                unitPrice: finalUnitPrice,
                lineTotal,
                // audit fields
                allowedUnitPrice: allowedForRow,
                pricePolicy:
                  Math.abs(allowedForRow - basePack) <= 0.009
                    ? "BASE"
                    : "PER_ITEM",
              },
            ],
          },
        },
        select: { id: true },
      });

      const receiptNoLoadOut = await allocateReceiptNo(tx);
      await tx.order.update({
        where: { id: newOrder.id },
        data: { receiptNo: receiptNoLoadOut },
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

    // 💵 Record Main Delivery cash payment (so Summary shows "Main Delivery Cash")
    // Uses appliedPayment (capped to amount due). We also persist tendered/change.
    if (appliedPayment > 0) {
      await tx.payment.create({
        data: {
          orderId: order.id,
          method: "CASH",
          amount: appliedPayment,
          tendered: cashGiven,
          change: Math.max(0, cashGiven - appliedPayment),
          refNo: "MAIN-DELIVERY",
        },
      });
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

  // Helpers for currency <-> number
  const parseMoney = (s: string | number | null | undefined) => {
    if (s == null) return 0;
    const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  // 💸 Discount breakdown (orig → discount → final), plus per-line totals
  const discountView = React.useMemo(() => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const adjusted = new Map(
      (pricing.adjustedItems ?? []).map((a: any) => [a.id, a])
    );
    const rows = order.items.map((it: any) => {
      const qty = Number(it.qty);
      const origUnit = Number(it.unitPrice);
      const effUnit =
        adjusted.get(it.id)?.effectiveUnitPrice ?? Number(it.unitPrice);
      const perUnitDisc = Math.max(0, r2(origUnit - effUnit));
      const lineDisc = r2(perUnitDisc * qty);
      const lineFinal = r2(effUnit * qty);
      return {
        id: it.id,
        name: it.name,
        qty,
        origUnit: r2(origUnit),
        effUnit: r2(effUnit),
        perUnitDisc,
        lineDisc,
        lineFinal,
      };
    });
    const subtotal = r2(rows.reduce((s, r) => s + r.origUnit * r.qty, 0));
    const totalAfter = r2(rows.reduce((s, r) => s + r.effUnit * r.qty, 0));
    const discountTotal = r2(subtotal - totalAfter);
    return { rows, discountTotal, subtotal, totalAfter };
  }, [order.items, pricing]);

  // Use the row-derived totals everywhere in the UI
  const total = discountView.totalAfter;
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
    allowedUnitPrice?: number | null; // 👈 preview of computed allowed (PACK)
    touched?: boolean; // 👈 if user manually changed unit price
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
  const [cashGivenStr, setCashGivenStr] = React.useState<string>(
    due.toFixed(2)
  );

  const defaultPriceFor = React.useCallback(
    (pid: number | null): number => {
      return pid != null && priceIndex[pid] != null
        ? Number(priceIndex[pid])
        : 0;
    },
    [priceIndex]
  );

  // 🔎 fetch allowed unit price for PACK (roadside load uses PACK logic)
  const fetchAllowed = React.useCallback(
    async (
      customerId: number | null | undefined,
      productId: number | null | undefined
    ) => {
      if (!productId) return null;
      try {
        const u = new URL("/resources/pricing/allowed", window.location.origin);
        if (customerId) u.searchParams.set("cid", String(customerId));
        u.searchParams.set("pid", String(productId));
        u.searchParams.set("unit", "PACK");
        const res = await fetch(u.toString());
        if (!res.ok) return null;
        const j = await res.json();
        if (j?.ok && Number.isFinite(j.allowed)) return Number(j.allowed);
      } catch {}
      return null;
    },
    []
  );

  // 👇 helper to update a row's allowed and maybe prefill unit price
  const refreshRowAllowed = React.useCallback(
    async (rowKey: string, cid: number | null, pid: number | null) => {
      const allowed = await fetchAllowed(cid, pid);
      setSoldRows((prev) =>
        prev.map((r) => {
          if (r.key !== rowKey) return r;
          const base = defaultPriceFor(pid);
          // prefill rule:
          // - if user hasn't touched price OR it still equals base/default, adopt allowed
          const shouldPrefill =
            !r.touched ||
            !Number.isFinite(r.unitPrice) ||
            Math.abs((r.unitPrice || 0) - base) <= 0.0001;
          const hasAllowed =
            typeof allowed === "number" && Number.isFinite(allowed);
          return {
            ...r,
            allowedUnitPrice: allowed,
            unitPrice:
              shouldPrefill && hasAllowed ? (allowed as number) : r.unitPrice,
          };
        })
      );
    },
    [fetchAllowed, defaultPriceFor]
  );

  // (auto-print moved to /remit/:id/summary)

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl px-5 py-6">
        {/* Header */}
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-800">
              Main Delivery Remit
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
                  <span className="text-slate-600">Original subtotal</span>
                  <span className="font-semibold">
                    {peso(discountView.subtotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Discounts</span>
                  <span className="font-semibold text-rose-600">
                    −{peso(discountView.discountTotal)}
                  </span>
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-slate-500">
                    View discount breakdown
                  </summary>
                  <div className="mt-2 space-y-1 text-xs">
                    {discountView.rows
                      .filter((r) => r.lineDisc > 0)
                      .map((r) => (
                        <div key={r.id} className="flex justify-between">
                          <span className="text-slate-600 truncate pr-2">
                            {r.name}
                          </span>
                          <span className="tabular-nums">
                            {r.qty} × ({peso(r.origUnit)} → {peso(r.effUnit)}) =
                            −{peso(r.lineDisc)}
                          </span>
                        </div>
                      ))}
                  </div>
                </details>

                <div className="flex items-center justify-between">
                  <span className="text-slate-700">Total after discounts</span>
                  <span className="font-semibold text-slate-900">
                    {peso(discountView.totalAfter)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-700">Due now</span>
                  <span className="font-semibold text-indigo-700">
                    {peso(due)}
                  </span>
                </div>

                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-slate-500">
                    View per-item breakdown
                  </summary>
                  <div className="mt-2 space-y-1 text-xs">
                    {discountView.rows.map((r) => (
                      <div key={r.id} className="flex flex-col">
                        <div className="flex justify-between">
                          <span className="text-slate-600 truncate pr-2">
                            {r.name}
                          </span>
                          <span className="tabular-nums">
                            Orig {peso(r.origUnit)} • Disc {peso(r.perUnitDisc)}{" "}
                            • Final {peso(r.effUnit)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Line</span>
                          <span className="tabular-nums">
                            {r.qty} × {peso(r.effUnit)} = {peso(r.lineFinal)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
                <div className="pt-2">
                  <CurrencyInput
                    name="cashGiven_display"
                    label="Cash collected"
                    value={cashGivenStr}
                    onChange={(e) => setCashGivenStr(e.target.value)}
                    placeholder="0.00"
                  />
                  {/* clean numeric value actually posted to the server */}
                  <input
                    type="hidden"
                    name="cashGiven"
                    value={parseMoney(cashGivenStr).toFixed(2)}
                  />
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
                        <div className="mb-1 block text-xs font-medium text-slate-600">
                          Customer (optional; required if On credit)
                        </div>
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

                            // ⛓ fetch PACK-allowed when both cid+pid available
                            const cid = norm?.id ?? null;
                            const pid = r.productId ?? null;
                            if (pid) void refreshRowAllowed(r.key, cid, pid);
                          }}
                        />

                        {/* PACK discount note */}
                        <p className="mt-1 text-[11px] text-slate-500">
                          Note: Roadside load uses{" "}
                          <span className="font-medium">PACK</span> pricing.
                          Discounts apply only if the customers rules are set
                          for PACK.
                        </p>

                        <p className="mt-1 text-[11px] text-slate-500">
                          Select an existing customer or add a new one.
                        </p>
                      </div>

                      {/* On-credit */}
                      <div className="col-span-12 lg:col-span-5 flex items-end">
                        <div className="flex flex-col gap-1">
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
                          {r.onCredit && !r.customerId && (
                            <span className="text-[11px] text-rose-600">
                              Select a customer to post as credit.
                            </span>
                          )}
                        </div>
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
                                              pid != null && !x.touched
                                                ? defaultPriceFor(pid)
                                                : x.unitPrice,
                                            allowedUnitPrice: undefined,
                                          }
                                        : x
                                    )
                                  );
                                  // refresh allowed after selecting product
                                  const cid = r.customerId ?? null;
                                  if (pid)
                                    void refreshRowAllowed(r.key, cid, pid);
                                }}
                                placeholder="Search load: 123 | Product name"
                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                              />
                            </>
                          );
                        })()}
                      </div>
                      <div className="col-span-6 md:col-span-2">
                        <label
                          htmlFor={`sold-${r.key}-qty`}
                          className="mb-1 block text-xs font-medium text-slate-600"
                        >
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
                        {/* Header text only; avoid <label> for custom CurrencyInput */}
                        <div className="mb-1 block text-xs font-medium text-slate-600">
                          Unit price
                        </div>
                        {(() => {
                          const base = defaultPriceFor(r.productId);
                          const unit = Number(r.unitPrice || 0);
                          const line = Number(r.qty || 0) * unit || 0;
                          const allowed = Number.isFinite(
                            r.allowedUnitPrice as number
                          )
                            ? (r.allowedUnitPrice as number)
                            : null;
                          const disc = Math.max(0, base - unit);
                          const custDisc =
                            allowed != null
                              ? Math.max(0, base - allowed)
                              : null;
                          const belowAllowed =
                            allowed != null && unit + 1e-6 < allowed;
                          return (
                            <div className="mb-1 text-[11px] text-slate-500 grid gap-0.5">
                              <div className="flex justify-between">
                                <span>Original</span>
                                <span className="tabular-nums">
                                  {peso(base)}
                                </span>
                              </div>
                              {allowed != null && (
                                <div className="flex justify-between">
                                  <span>Customer price (PACK)</span>
                                  <span className="tabular-nums">
                                    {peso(allowed)}
                                  </span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span>Discount</span>
                                <span className="tabular-nums text-rose-600">
                                  −{peso(disc)}
                                </span>
                              </div>
                              {custDisc != null && (
                                <div className="flex justify-between text-slate-400">
                                  <span>of which rule-based</span>
                                  <span className="tabular-nums">
                                    −{peso(custDisc)}
                                  </span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span>Final (per unit)</span>
                                <span className="tabular-nums">
                                  {peso(unit)}
                                </span>
                              </div>
                              {belowAllowed && (
                                <div className="flex justify-between text-rose-600">
                                  <span>Below allowed</span>
                                  <span className="tabular-nums">
                                    min {peso(allowed!)}
                                  </span>
                                </div>
                              )}
                              <div className="flex justify-between">
                                <span>Line total</span>
                                <span className="tabular-nums">
                                  {peso(line)}
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                        <CurrencyInput
                          name={`unitPrice-${r.key}`}
                          label=""
                          value={String(r.unitPrice ?? "")}
                          onChange={(e) => {
                            const v = Math.max(0, parseMoney(e.target.value));
                            setSoldRows((prev) =>
                              prev.map((x) =>
                                x.key === r.key
                                  ? { ...x, unitPrice: v, touched: true }
                                  : x
                              )
                            );
                          }}
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    {/* Walk-in imprint only if no customer */}
                    {!r.customerId && (
                      <div className="mt-3 grid grid-cols-12 gap-3">
                        <div className="col-span-12 md:col-span-6">
                          <label
                            htmlFor={`sold-${r.key}-buyerName`}
                            className="mb-1 block text-xs font-medium text-slate-600"
                          >
                            Buyer name (optional)
                          </label>
                          <input
                            id={`sold-${r.key}-buyerName`}
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
                          <label
                            htmlFor={`sold-${r.key}-buyerPhone`}
                            className="mb-1 block text-xs font-medium text-slate-600"
                          >
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
                    unitPrice: Number(parseMoney(r.unitPrice).toFixed(2)),
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
