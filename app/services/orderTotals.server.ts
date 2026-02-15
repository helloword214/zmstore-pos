/* eslint-disable @typescript-eslint/no-explicit-any */
/*  b/app/services/orderTotals.server.ts 
 eslint-disable @typescript-eslint/no-explicit-any */
import type { db } from "~/utils/db.server";
import type { Rule } from "~/services/pricing";
import {
  applyDiscounts,
  buildCartFromOrderItems,
  fetchCustomerRulesAt,
} from "~/services/pricing";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type DiscountViewRow = {
  id: number;
  name: string;
  qty: number;
  origUnit: number;
  effUnit: number;
  perUnitDisc: number;
  lineDisc: number;
  lineFinal: number;
};

export type DiscountView = {
  rows: DiscountViewRow[];
  subtotal: number;
  totalAfter: number;
  discountTotal: number;
};

type OrderLike = {
  id: number;
  customerId: number | null;
  createdAt: Date;
  subtotal: number | null;
  totalBeforeDiscount: number | null;
  items: Array<{
    id: number;
    productId: number;
    name: string;
    qty: any;
    unitPrice: any;
    lineTotal?: any;
  }>;
};

/**
 * Freeze-first final total resolver.
 * Priority:
 *  1) sum(orderItem.lineTotal) if present for all items
 *  2) order.totalBeforeDiscount if present
 *  3) legacy fallback: recompute using rules at order.createdAt
 */
export async function resolveFinalTotalFreezeFirst(
  dbx: typeof db,
  order: OrderLike,
  byProductId?: Map<
    number,
    { price: number; srp: number; allowPackSale: boolean }
  >
) {
  const itemsAny = order.items as any[];
  const hasLineTotals =
    Array.isArray(itemsAny) &&
    itemsAny.length > 0 &&
    itemsAny.every(
      (it) => it.lineTotal != null && Number.isFinite(Number(it.lineTotal))
    );

  if (hasLineTotals) {
    const total = r2(itemsAny.reduce((s, it) => s + Number(it.lineTotal), 0));
    return {
      finalTotal: total,
      hasLineTotals: true,
      used: "LINE_TOTALS" as const,
    };
  }

  if (
    order.totalBeforeDiscount != null &&
    Number.isFinite(Number(order.totalBeforeDiscount))
  ) {
    return {
      finalTotal: r2(Number(order.totalBeforeDiscount)),
      hasLineTotals: false,
      used: "ORDER_TOTAL" as const,
    };
  }

  // Legacy fallback: recompute using historical rules (createdAt)
  const rulesAt: Rule[] = await fetchCustomerRulesAt(
    dbx as any,
    order.customerId ?? null,
    order.createdAt ?? new Date()
  );

  const cart = buildCartFromOrderItems({
    items: order.items.map((it: any) => ({
      ...it,
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      product: byProductId?.get(it.productId)
        ? {
            price: Number(byProductId.get(it.productId)!.price ?? 0),
            srp: Number(byProductId.get(it.productId)!.srp ?? 0),
            allowPackSale: Boolean(
              byProductId.get(it.productId)!.allowPackSale ?? true
            ),
          }
        : { price: 0, srp: 0, allowPackSale: true },
    })),
    rules: rulesAt,
  });

  const pricing = applyDiscounts(cart, rulesAt, {
    id: order.customerId ?? null,
  });
  const adjustedById = new Map(
    (pricing.adjustedItems ?? []).map((a: any) => [a.id, a])
  );

  let total = 0;
  for (const it of order.items as any[]) {
    const qty = Number(it.qty);
    const origUnit = Number(it.unitPrice);
    const effUnit = Number(
      adjustedById.get(it.id)?.effectiveUnitPrice ?? origUnit
    );
    total += effUnit * qty;
  }

  return {
    finalTotal: r2(total),
    hasLineTotals: false,
    used: "RULES_AT_TIME" as const,
  };
}

/**
 * Builds the discountView for UI, freeze-first.
 * - If lineTotal exists: infer effective unit price = lineTotal/qty
 * - Else: effective unit = orig unit (no per-item discounts visible)
 */
export function buildDiscountViewFreezeFirst(order: OrderLike): DiscountView {
  const itemsAny = order.items as any[];
  const hasLineTotals =
    Array.isArray(itemsAny) &&
    itemsAny.length > 0 &&
    itemsAny.every(
      (it) => it.lineTotal != null && Number.isFinite(Number(it.lineTotal))
    );

  const rows: DiscountViewRow[] = (order.items ?? []).map((it: any) => {
    const qty = Number(it.qty ?? 0);
    const origUnit = Number(it.unitPrice ?? 0);
    const effUnit =
      hasLineTotals && qty > 0 ? r2(Number(it.lineTotal) / qty) : r2(origUnit);

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

  let totalAfter = subtotal;
  if (hasLineTotals) totalAfter = r2(rows.reduce((s, r) => s + r.lineFinal, 0));
  else if (
    order.totalBeforeDiscount != null &&
    Number.isFinite(Number(order.totalBeforeDiscount))
  ) {
    totalAfter = r2(Number(order.totalBeforeDiscount));
  }

  const discountTotal = Math.max(0, r2(subtotal - totalAfter));
  return { rows, subtotal, totalAfter, discountTotal };
}
