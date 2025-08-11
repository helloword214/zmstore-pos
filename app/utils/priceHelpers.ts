// utils/priceHelpers.ts
export type Adjustment =
  | { type: "absolute"; value: number } // +₱ per unit
  | { type: "percent"; value: number }; // +% per unit

export function toNumber(n: unknown): number {
  const x = typeof n === "string" ? n.replace(/,/g, "") : n;
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

export function computeUnitPrice(
  wholePrice: number,
  packingSize: number
): number {
  const size = toNumber(packingSize);
  const whole = toNumber(wholePrice);
  if (size <= 0) return 0;
  return whole / size;
}

export function computeWholePrice(
  unitPrice: number,
  packingSize: number
): number {
  const size = toNumber(packingSize);
  const unit = toNumber(unitPrice);
  if (size <= 0) return 0;
  return unit * size;
}

export function applyAdjustment(
  baseUnitPrice: number,
  adj?: Adjustment | null
): number {
  const base = toNumber(baseUnitPrice);
  if (!adj) return base;
  if (adj.type === "absolute") return base + adj.value;
  return base * (1 + adj.value / 100);
}

export function round2(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/** Loop‑safe sync between unit<->whole with optional markup */
export function syncPrices(opts: {
  source: "unit" | "whole";
  value: number;
  packingSize: number;
  adjustment?: Adjustment | null;
  roundDecimals?: number;
}) {
  const { source, value, packingSize, adjustment, roundDecimals = 2 } = opts;

  let baseUnit = 0;
  let baseWhole = 0;

  if (source === "whole") {
    baseUnit = computeUnitPrice(value, packingSize);
    baseWhole = value;
  } else {
    baseUnit = value;
    baseWhole = computeWholePrice(value, packingSize);
  }

  const adjustedUnit = applyAdjustment(baseUnit, adjustment);
  const adjustedWhole = computeWholePrice(adjustedUnit, packingSize);

  return {
    baseUnit: round2(baseUnit, roundDecimals),
    baseWhole: round2(baseWhole, roundDecimals),
    unit: round2(adjustedUnit, roundDecimals), // ← save to product.price
    whole: round2(adjustedWhole, roundDecimals), // ← save to product.srp (whole pack)
  };
}
