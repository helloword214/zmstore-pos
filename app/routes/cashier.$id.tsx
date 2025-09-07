/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useFetcher,
  Form,
  useNavigation,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";
import React, { useMemo } from "react";
import { allocateReceiptNo } from "~/utils/receipt";
import { CustomerPicker } from "~/components/CustomerPicker";

import { UnitKind } from "@prisma/client";
import { applyDiscounts, type Cart, type Rule } from "~/services/pricing";

import { db } from "~/utils/db.server";

// Lock TTL: 5 minutes (same as queue page)
const LOCK_TTL_MS = 5 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Local types (no dependency on ~/services/pricing)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Local discount engine (UI + server can use this)
// Rules are already “item” scoped from your mapping.
// Precedence: first matching rule in the array wins.
// If both exist, PRICE_OVERRIDE outranks PERCENT_OFF if they are adjacent;
// otherwise, rely on array order (you already order by createdAt desc).
// ─────────────────────────────────────────────────────────────
function applyDiscountsLocal(cart: Cart, rules: Rule[]) {
  const subtotal = cart.items.reduce((s, it) => s + it.qty * it.unitPrice, 0);

  const discountsByRule = new Map<string, { name: string; amount: number }>();
  const adjustedItems: Array<{
    id: number;
    productId: number;
    effectiveUnitPrice: number;
  }> = [];

  for (const it of cart.items) {
    const matches = rules.filter((r) => {
      const byPid = r.selector?.productIds?.includes(it.productId) ?? false;
      if (!byPid) return false;
      // ✅ Treat unknown item unitKind as wildcard so unit-gated rules still apply
      if (r.selector?.unitKind) {
        return !it.unitKind || r.selector.unitKind === it.unitKind;
      }
      return true;
    });

    // prefer PRICE_OVERRIDE if it exists among the first matching group
    let chosen: Rule | undefined;
    for (const candidate of matches) {
      if (candidate.kind === "PRICE_OVERRIDE") {
        chosen = candidate;
        break;
      }
      if (!chosen) chosen = candidate; // fallback to PERCENT_OFF if no override found
    }

    let eff = it.unitPrice;
    if (chosen) {
      if (chosen.kind === "PRICE_OVERRIDE") {
        eff = Number(chosen.priceOverride);
      } else if (chosen.kind === "PERCENT_OFF") {
        const pct = Math.max(0, Number(chosen.percentOff || 0));
        eff = +(it.unitPrice * (1 - pct / 100)).toFixed(2);
      }
      const lineDiscount = Math.max(0, (it.unitPrice - eff) * it.qty);
      if (lineDiscount > 0) {
        const prev = discountsByRule.get(chosen.id) ?? {
          name: chosen.name,
          amount: 0,
        };
        prev.amount += lineDiscount;
        discountsByRule.set(chosen.id, prev);
      }
    }

    adjustedItems.push({
      id: it.id,
      productId: it.productId,
      effectiveUnitPrice: eff,
    });
  }

  const total = adjustedItems.reduce((s, ai) => {
    const q = cart.items.find((x) => x.id === ai.id)?.qty ?? 0;
    return s + q * ai.effectiveUnitPrice;
  }, 0);

  return {
    subtotal: +subtotal.toFixed(2),
    total: +total.toFixed(2),
    discountTotal: +(subtotal - total).toFixed(2),
    discounts: Array.from(discountsByRule, ([ruleId, v]) => ({
      ruleId,
      name: v.name,
      amount: +v.amount.toFixed(2),
    })),
    adjustedItems,
  };
}

// ─────────────────────────────────────────────────────────────
// Local computeUnitPriceForCustomer (server-side use)
// Returns the allowed price for a single product/unit
// according to the most recent active rule; defaults to base.
// ─────────────────────────────────────────────────────────────
async function computeUnitPriceForCustomerLocal(
  tx: typeof db,
  opts: {
    customerId: number | null;
    productId: number;
    unitKind: UnitKind; // Prisma enum
    baseUnitPrice: number;
  }
): Promise<number> {
  const { customerId, productId, unitKind, baseUnitPrice } = opts;
  if (!customerId) return baseUnitPrice;

  const now = new Date();
  const row = await tx.customerItemPrice.findFirst({
    where: {
      customerId,
      productId,
      unitKind,
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: [{ createdAt: "desc" }],
    select: { mode: true, value: true },
  });

  if (!row) return baseUnitPrice;
  const v = Number(row.value ?? 0);

  switch (row.mode) {
    case "FIXED_PRICE":
      return +v.toFixed(2);
    case "PERCENT_DISCOUNT":
      return +Math.max(0, baseUnitPrice * (1 - v / 100)).toFixed(2);
    case "FIXED_DISCOUNT":
      return +Math.max(0, baseUnitPrice - v).toFixed(2);
    default:
      return baseUnitPrice;
  }
}

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          // Need base prices to infer which unit this line used
          product: {
            select: {
              price: true,
              srp: true,
              allowPackSale: true,
              categoryId: true,
              brandId: true,
              sku: true,
            },
          },
        },
      },
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

  // ─────────────────────────────────────────────────────────────
  // Build active, customer-specific pricing rules for preview UI
  // ─────────────────────────────────────────────────────────────
  const customerId = order.customerId ?? null;

  let activePricingRules: Rule[] = [];
  if (customerId) {
    const now = new Date();
    const raw = await db.customerItemPrice.findMany({
      where: {
        customerId,
        active: true,
        AND: [
          // startsAt ≤ now OR null
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          // endsAt ≥ now OR null
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      select: {
        id: true,
        productId: true,
        unitKind: true,
        mode: true,
        value: true,
        product: { select: { price: true, srp: true } }, // base prices
      },
      orderBy: [{ createdAt: "desc" }],
    });

    // Map DB rules → pure pricing Rule objects (ITEM scope)
    activePricingRules = raw.map((r) => {
      // attach unitKind so rules only hit the correct unit
      const selector = {
        productIds: [r.productId],
        unitKind: r.unitKind as "RETAIL" | "PACK",
      };

      if (r.mode === "FIXED_PRICE") {
        return {
          id: `CIP:${r.id}`,
          name: "Customer Price",
          scope: "ITEM",
          kind: "PRICE_OVERRIDE",
          priceOverride: Number(r.value ?? 0),
          selector,
          priority: 10,
          enabled: true,
          stackable: false,
          notes: `unit=${r.unitKind}`,
        } satisfies Rule;
      }

      if (r.mode === "PERCENT_DISCOUNT") {
        return {
          id: `CIP:${r.id}`,
          name: "Customer % Off",
          scope: "ITEM",
          kind: "PERCENT_OFF",
          percentOff: Number(r.value ?? 0),
          selector,
          priority: 10,
          enabled: true,
          stackable: true,
          notes: `unit=${r.unitKind}`,
        } satisfies Rule;
      }

      // FIXED_DISCOUNT → convert to price override using the correct base
      const base =
        r.unitKind === "RETAIL"
          ? Number(r.product.price ?? 0)
          : Number(r.product.srp ?? 0);
      const override = Math.max(0, +(base - Number(r.value ?? 0)).toFixed(2));
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
      } satisfies Rule;
    });
  }

  return json({
    order,
    isStale,
    lockExpiresAt,
    activePricingRules,
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
    // ✅ declare once, before any usage (rules, pricing, guards)
    const effectiveCustomerId = customerId ?? order.customerId ?? null;

    const alreadyPaid = (order.payments ?? []).reduce(
      (s, p) => s + Number(p.amount),
      0
    );

    const nowPaid = alreadyPaid + cashGiven;
    // ─────────────────────────────────────────────────────────────
    // Compute EFFECTIVE total using active customer pricing rules
    // ─────────────────────────────────────────────────────────────
    // We need product base prices to infer unitKind → fetch BEFORE building the cart.
    const productIds = Array.from(new Set(order.items.map((i) => i.productId)));
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        allowPackSale: true,
        price: true,
        srp: true,
        stock: true, // packs (used later for deduction)
        packingStock: true, // retail units (used later for deduction)
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Build Cart AFTER rules so we can use rule-aware fallback (mirror client)
    const eq = (a: number, b: number, eps = 0.25) => Math.abs(a - b) <= eps;
    const cart: Cart = {
      items: order.items.map((it) => {
        const p = byId.get(it.productId);
        const baseRetail = p ? Number(p.price ?? 0) : 0;
        const basePack = p ? Number(p.srp ?? 0) : 0;
        const u = Number(it.unitPrice);

        let unitKind: "RETAIL" | "PACK" | undefined;
        const retailClose = baseRetail > 0 && eq(u, baseRetail);
        const packClose = basePack > 0 && eq(u, basePack);

        if (retailClose && !packClose) unitKind = "RETAIL";
        else if (packClose && !retailClose) unitKind = "PACK";
        else if (retailClose && packClose)
          unitKind = baseRetail <= basePack ? "RETAIL" : "PACK";

        // ✨ Rule-aware fallback (same as client preview)
        if (!unitKind) {
          const hasPackRule = rules.some(
            (r) =>
              r.selector?.unitKind === "PACK" &&
              r.selector?.productIds?.includes(it.productId)
          );
          const hasRetailRule = rules.some(
            (r) =>
              r.selector?.unitKind === "RETAIL" &&
              r.selector?.productIds?.includes(it.productId)
          );
          if (hasPackRule && !hasRetailRule) unitKind = "PACK";
          else if (hasRetailRule && !hasPackRule) unitKind = "RETAIL";
          // else leave undefined; matcher treats undefined as wildcard
        }

        return {
          id: it.id,
          productId: it.productId,
          name: it.name,
          qty: Number(it.qty),
          unitPrice: u,
          unitKind,
        };
      }),
    };

    // Pull active customer rules (unit-aware) and map → Rule[]
    let rules: Rule[] = [];
    if (effectiveCustomerId) {
      const now = new Date();
      const rows = await db.customerItemPrice.findMany({
        where: {
          customerId: effectiveCustomerId,
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
      rules = rows.map((r) => {
        const selector = {
          productIds: [r.productId],
          unitKind: r.unitKind as "RETAIL" | "PACK",
        };
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
    }
    const pricing = applyDiscountsLocal(
      cart,
      rules /*, { id: effectiveCustomerId }*/
    );

    const total = pricing.total ?? Number(order.totalBeforeDiscount);
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

    // byId/products already fetched above; reuse here
    // 🔒 Final price guard: ensure no item is cheaper than allowed price for this customer
    // (effectiveCustomerId declared once above)
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
      const allowed = await computeUnitPriceForCustomerLocal(db, {
        customerId: effectiveCustomerId,
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

    // Build deltas (retail vs pack) using robust price inference
    const errors: Array<{ id: number; reason: string }> = [];
    const deltas = new Map<number, { pack: number; retail: number }>();
    const approxEqual = (a: number, b: number, eps = 0.25) =>
      Math.abs(a - b) <= eps; // allow a bit more slack due to rounding

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
      const packStock = Number(p.stock ?? 0);
      const retailStock = Number(p.packingStock ?? 0);

      // 🔎 Old logic compared only to BASE prices → fails when customer discounts change unitPrice.
      // New logic: compare against the *allowed* (customer-adjusted) unit prices for both unit kinds,
      // then pick the closer one.
      const [allowedRetail, allowedPack] = await Promise.all([
        baseRetail > 0
          ? computeUnitPriceForCustomerLocal(db as any, {
              customerId: effectiveCustomerId,
              productId: p.id,
              unitKind: UnitKind.RETAIL,
              baseUnitPrice: baseRetail,
            })
          : Promise.resolve(NaN),
        basePack > 0
          ? computeUnitPriceForCustomerLocal(db as any, {
              customerId: effectiveCustomerId,
              productId: p.id,
              unitKind: UnitKind.PACK,
              baseUnitPrice: basePack,
            })
          : Promise.resolve(NaN),
      ]);

      // If both are NaN/0, fall back to previous heuristic
      let inferred: UnitKind | null = null;
      if (Number.isFinite(allowedRetail) || Number.isFinite(allowedPack)) {
        const dRetail = Number.isFinite(allowedRetail)
          ? Math.abs(unitPrice - Number(allowedRetail))
          : Number.POSITIVE_INFINITY;
        const dPack = Number.isFinite(allowedPack)
          ? Math.abs(unitPrice - Number(allowedPack))
          : Number.POSITIVE_INFINITY;
        if (Math.min(dRetail, dPack) === Number.POSITIVE_INFINITY) {
          inferred = null;
        } else if (dRetail <= dPack && (p.allowPackSale || true)) {
          inferred = UnitKind.RETAIL;
        } else {
          inferred = UnitKind.PACK;
        }
      } else {
        // legacy fallback to base comparison (kept as safety net)
        if (
          p.allowPackSale &&
          baseRetail > 0 &&
          approxEqual(unitPrice, baseRetail)
        ) {
          inferred = UnitKind.RETAIL;
        } else if (basePack > 0 && approxEqual(unitPrice, basePack)) {
          inferred = UnitKind.PACK;
        }
      }

      if (!inferred) {
        errors.push({
          id: it.productId,
          reason:
            "Cannot infer retail/pack from price (check customer rule or base prices).",
        });
        continue;
      }

      if (inferred === UnitKind.RETAIL) {
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

        const allowed = await computeUnitPriceForCustomerLocal(tx as any, {
          customerId: effectiveCustomerId,
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

  const approxEqual = (a: number, b: number, eps = 0.02) =>
    Math.abs(a - b) <= eps;

  // ---------- Live customer-based rules ----------
  const fetcher = useFetcher<{ rules: Rule[] }>();
  const [clientRules, setClientRules] = React.useState<Rule[]>(
    Array.isArray(activePricingRules) ? (activePricingRules as Rule[]) : []
  );
  const lastCidRef = React.useRef<number | null>(null);

  // When cashier picks a different customer, fetch that customer’s rules
  React.useEffect(() => {
    const cid = customer?.id ?? null;
    if (!cid) {
      setClientRules([]);
      lastCidRef.current = null;
      return;
    }
    if (lastCidRef.current === cid) return; // avoid duplicate loads
    lastCidRef.current = cid;
    fetcher.load(`/api/customer-pricing?customerId=${cid}`);
  }, [customer?.id, fetcher]);
  // Apply fetched rules to preview once available
  React.useEffect(() => {
    if (fetcher.data?.rules) {
      setClientRules(fetcher.data.rules);
    }
    // include `fetcher` to avoid missing-deps warning
  }, [fetcher.data]);

  // Keep initial server-provided rules if there’s an order.customer but no clientRules yet
  React.useEffect(() => {
    if (!customer?.id && activePricingRules?.length) {
      setClientRules(activePricingRules);
    }
  }, [customer?.id, activePricingRules]);

  // ---------- Discount engine (read-only preview) ----------
  // 1) Active rules — declare BEFORE cart so cart can consult rules
  const rules = useMemo<Rule[]>(
    () => (Array.isArray(clientRules) ? clientRules.filter(Boolean) : []),
    [clientRules]
  );

  // 2) Build a Cart from current order items
  const cart = useMemo<Cart>(() => {
    const items = (order.items ?? []).map((it: any) => {
      const baseRetail = Number(it.product?.price ?? 0);
      const basePack = Number(it.product?.srp ?? 0);
      const u = Number(it.unitPrice);

      let unitKind: "RETAIL" | "PACK" | undefined;
      const retailClose = baseRetail > 0 && approxEqual(u, baseRetail);
      const packClose = basePack > 0 && approxEqual(u, basePack);

      if (retailClose && !packClose) unitKind = "RETAIL";
      else if (packClose && !retailClose) unitKind = "PACK";
      else if (retailClose && packClose)
        unitKind = baseRetail <= basePack ? "RETAIL" : "PACK";

      // ✨ Fallback: if still undefined, prefer the unitKind that has a matching rule for this product
      if (!unitKind) {
        const hasPackRule = rules.some(
          (r) =>
            r.selector?.unitKind === "PACK" &&
            r.selector?.productIds?.includes(it.productId)
        );
        const hasRetailRule = rules.some(
          (r) =>
            r.selector?.unitKind === "RETAIL" &&
            r.selector?.productIds?.includes(it.productId)
        );
        if (hasPackRule && !hasRetailRule) unitKind = "PACK";
        else if (hasRetailRule && !hasPackRule) unitKind = "RETAIL";
        // if both/neither, keep undefined
      }

      return {
        id: it.id,
        productId: it.productId,
        name: it.name,
        qty: Number(it.qty),
        unitPrice: u,
        unitKind,
        categoryId: it.product?.categoryId ?? null,
        brandId: it.product?.brandId ?? null,
        sku: it.product?.sku ?? null,
      };
    });
    return { items };
  }, [order.items, rules]);

  // 3) Customer context (minimal for now)
  // Use the live-selected customer first; fall back to the order’s saved customer.
  const ctx = useMemo<{ id: number | null }>(
    () => ({
      id: customer?.id ?? order.customer?.id ?? null,
    }),
    [customer?.id, order.customer?.id]
  );

  // 4) Compute
  const pricing = useMemo(
    () => applyDiscounts(cart, rules, ctx),
    [cart, rules, ctx]
  );

  // DEBUG: see why rules fail to match

  // ---------------------------------------------------------

  // 🔢 Use discounted total for payment figures (UI)
  const alreadyPaid =
    order.payments?.reduce((s: number, p: any) => s + Number(p.amount), 0) || 0;
  const entered = Number(cashGiven) || 0;
  const effectiveTotal = pricing.total ?? Number(order.totalBeforeDiscount);
  const dueBefore = Math.max(0, effectiveTotal - alreadyPaid);
  const changePreview = entered > 0 ? Math.max(0, entered - dueBefore) : 0;
  const balanceAfterThisPayment = Math.max(
    0,
    effectiveTotal - alreadyPaid - entered
  );
  const willBePartial = balanceAfterThisPayment > 0;

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
                  const unitOrig = Number(it.unitPrice);
                  const effUnit = adj?.effectiveUnitPrice ?? unitOrig;
                  const discounted = Number(effUnit) !== unitOrig;
                  const qty = Number(it.qty);
                  const originalLine = Number(it.lineTotal);
                  const effLine = Math.max(0, qty * effUnit);
                  const saveLine = Math.max(0, originalLine - effLine);
                  const unitSavePct =
                    discounted && unitOrig > 0
                      ? Math.max(0, Math.round((1 - effUnit / unitOrig) * 100))
                      : 0;
                  return (
                    <div key={it.id} className="px-4 py-3 hover:bg-slate-50/60">
                      <div className="flex items-start justify-between gap-3">
                        {/* Left: name + qty x price */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate text-sm font-medium text-slate-900">
                              {it.name}
                            </span>
                            {discounted && (
                              <span
                                className="flex-none text-[10px] rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200"
                                title={`~${unitSavePct}% off per unit`}
                              >
                                −{unitSavePct}%
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-600">
                            {qty} ×{" "}
                            {discounted ? (
                              <>
                                <s className="text-slate-400">
                                  {peso(unitOrig)}
                                </s>{" "}
                                <strong>{peso(effUnit)}</strong>
                              </>
                            ) : (
                              <>{peso(unitOrig)}</>
                            )}
                          </div>
                        </div>

                        {/* Right: line total + savings */}
                        <div className="text-right">
                          <div className="text-sm font-semibold text-slate-900">
                            {peso(effLine)}
                          </div>
                          {discounted && saveLine > 0 && (
                            <div className="text-[11px] text-rose-600">
                              −{peso(saveLine)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totals panel */}
              <div className="mt-2 border-t border-slate-100 bg-slate-50/50 px-4 py-3 space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Subtotal (items)</span>
                  <span className="font-medium text-slate-900">
                    {peso(pricing.subtotal)}
                  </span>
                </div>
                {pricing.discounts.map((d) => (
                  <div
                    key={d.ruleId}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-rose-700">Less: {d.name}</span>
                    <span className="font-medium text-rose-700">
                      −{peso(d.amount)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    Total (before discounts)
                  </span>
                  <span className="font-medium text-slate-700">
                    {peso(Number(order.totalBeforeDiscount))}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm font-semibold text-indigo-700">
                  <span>Total after discounts (preview)</span>
                  <span>{peso(pricing.total)}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Right: payment card (simplified) */}
          <aside className="lg:col-span-1">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-medium tracking-wide text-slate-800">
                  Payment
                </h3>
                <a
                  href={`/orders/${order.id}/credit`}
                  className="text-xs text-indigo-600 hover:underline"
                  title="Record this as full utang / credit without taking payment"
                >
                  Record as Credit
                </a>
              </div>

              {/* Notices */}
              <div className="px-4 pt-4 space-y-2">
                {actionData &&
                "errors" in actionData &&
                actionData.errors?.length ? (
                  <ul className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {(actionData as any).error}
                  </div>
                ) : null}
                {actionData && "paid" in actionData && actionData.paid ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Paid ✔ Inventory deducted.
                  </div>
                ) : null}
              </div>

              {/* Form */}
              <Form
                id="settle-form"
                method="post"
                className="px-4 pb-4 mt-3 space-y-4"
              >
                <input type="hidden" name="_action" value="settlePayment" />
                <input
                  type="hidden"
                  name="customerId"
                  value={customer?.id ?? ""}
                />

                {/* Totals strip */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-600">Due now</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(dueBefore)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-600">
                      Already paid
                    </div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(alreadyPaid)}
                    </div>
                  </div>
                </div>

                {/* Customer (required if partial) */}
                <div>
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

                {/* Cash input + print toggle */}
                <div className="grid grid-cols-1 gap-3">
                  <label className="block">
                    <span className="block text-sm text-slate-700">
                      Cash received
                    </span>
                    <input
                      name="cashGiven"
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashGiven}
                      onChange={(e) => setCashGiven(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                      placeholder="0.00"
                      inputMode="decimal"
                      autoFocus
                    />
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="printReceipt"
                      value="1"
                      checked={printReceipt}
                      onChange={(e) => setPrintReceipt(e.target.checked)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span>Print receipt</span>
                  </label>
                </div>

                {/* Live previews */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-600">
                      Change (preview)
                    </div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(changePreview)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-600">
                      Balance after
                    </div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(balanceAfterThisPayment)}
                    </div>
                  </div>
                </div>

                {/* Advanced options */}
                <details className="rounded-xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer select-none list-none px-3 py-2 text-sm text-slate-800">
                    Advanced options
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
                      Manager PIN/Name (for release)
                      <input
                        name="releaseApprovedBy"
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                        placeholder="e.g. 1234 or MGR-ANA"
                      />
                    </label>
                    <label className="block text-xs text-slate-600">
                      Manager PIN/Name (required if price lessthan allowed)
                      <input
                        name="discountApprovedBy"
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                        placeholder="e.g. MGR-ANA"
                      />
                    </label>
                  </div>
                </details>

                {/* Primary submit */}
                <button
                  type="submit"
                  className="mt-1 inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
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

// Route-level Error Boundary using useRouteError()
export function ErrorBoundary() {
  const error = useRouteError();
  // Helpful console for dev; no-op in production logs.
  // eslint-disable-next-line no-console
  console.error("Cashier route error:", error);

  let title = "Unknown error";
  let message = "No additional details were provided.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    title = `HTTP ${error.status} ${error.statusText}`;
    message =
      typeof error.data === "string"
        ? error.data
        : JSON.stringify(error.data, null, 2);
  } else if (error instanceof Error) {
    title = `${error.name || "Error"}: ${error.message || "Unknown error"}`;
    message = error.message || "An unexpected error occurred.";
    stack = error.stack;
  } else if (error) {
    try {
      message = JSON.stringify(error, null, 2);
    } catch {
      message = String(error);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="rounded-2xl border border-red-200 bg-white shadow-sm">
          <div className="border-b border-red-100 bg-red-50/60 px-4 py-3">
            <h1 className="text-base font-semibold text-red-800">
              Something went wrong on this page
            </h1>
          </div>
          <div className="px-4 py-4 space-y-3">
            <p className="text-sm text-slate-700">
              If this happened after clicking a name or link, a render error may
              have been thrown. Details:
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-mono text-slate-800 whitespace-pre-wrap break-words">
                {title}
              </div>
            </div>
            {message ? (
              <details
                className="rounded-lg border border-slate-200 bg-slate-50"
                open
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-slate-700">
                  Error details
                </summary>
                <pre className="px-3 py-2 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                  {message}
                </pre>
              </details>
            ) : null}
            {stack ? (
              <details className="rounded-lg border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-slate-700">
                  Stack trace
                </summary>
                <pre className="px-3 py-2 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                  {stack}
                </pre>
              </details>
            ) : null}
            <div className="pt-2">
              <a
                href="/cashier"
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              >
                ← Back to Cashier
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
