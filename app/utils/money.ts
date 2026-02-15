// app/utils/money.ts
// Shared (client-safe) money helpers.
// ------------------------------------------------------------
// Commercial money threshold (business rule)
// - Used for: "remaining > EPS" gates (CCS, settlement gates)
// - Keep in money layer (not in settlement helpers)
// ------------------------------------------------------------
export const MONEY_EPS = 0.01;

//

// Standardize rounding rules in one place (2 decimals).
export const r2 = (n: number) =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const toNum = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number(n || 0),
  );
