/**
 *  /app/services/frozenPricing.server.ts
 * Frozen Pricing Reader + Validatorb/app/services/frozenPricing.server.ts
 *
 * Purpose:
 * - Read totals ONLY from frozen OrderItem snapshot fields
 * - Provide consistent totals across routes
 * - Detect mismatch between header totals and line snapshot sums
 *
 * NOT a pricing engine:
 * - Does not compute discounts from rules
 * - Does not use Product.price/srp
 */

export type FrozenUnitKind = "PACK" | "RETAIL";

export type FrozenOrderItem = {
  qty: number;
  unitKind: FrozenUnitKind;
  baseUnitPrice: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
};

export type FrozenOrderInput = {
  id: number;
  // header totals (may be null/undefined for legacy)
  subtotal?: number | null;
  totalBeforeDiscount?: number | null;
  items: FrozenOrderItem[];
};

import { r2, toNum } from "~/utils/money";

export function getFrozenPricingFromOrder(order: FrozenOrderInput) {
  const items = Array.isArray(order.items) ? order.items : [];

  // Payable subtotal = SUM(lineTotal)
  const computedSubtotal = r2(
    items.reduce((sum, it) => sum + toNum(it.lineTotal), 0)
  );

  // Total before discount = SUM(qty * baseUnitPrice)
  const computedTotalBeforeDiscount = r2(
    items.reduce((sum, it) => sum + toNum(it.qty) * toNum(it.baseUnitPrice), 0)
  );

  // Discount total = SUM(qty * discountAmount)
  const computedDiscountTotal = r2(
    items.reduce((sum, it) => sum + toNum(it.qty) * toNum(it.discountAmount), 0)
  );

  // Optional tolerance for rounding drift
  const tolerance = 0.01;

  const dbSubtotal = order.subtotal == null ? null : r2(toNum(order.subtotal));
  const dbTotalBefore =
    order.totalBeforeDiscount == null
      ? null
      : r2(toNum(order.totalBeforeDiscount));

  const subtotalMismatch =
    dbSubtotal != null && Math.abs(dbSubtotal - computedSubtotal) > tolerance;
  const totalBeforeMismatch =
    dbTotalBefore != null &&
    Math.abs(dbTotalBefore - computedTotalBeforeDiscount) > tolerance;

  const mismatch = subtotalMismatch || totalBeforeMismatch;

  return {
    computedSubtotal,
    computedTotalBeforeDiscount,
    computedDiscountTotal,
    dbSubtotal,
    dbTotalBefore,
    mismatch,
    // for debugging/logging if needed
    detail: {
      subtotalMismatch,
      totalBeforeMismatch,
      tolerance,
      orderId: order.id,
      itemCount: items.length,
    },
  };
}
