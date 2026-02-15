/* eslint-disable @typescript-eslint/no-explicit-any */
// app/services/settlementSoT.ts
// Client-safe settlement helpers (NO prisma types, NO server-only imports)

import { r2, toNum } from "~/utils/money";

// ------------------------------------------------------------
// Float tolerance (math stability only)
// - NOT a commercial threshold
// ------------------------------------------------------------
export const EPS_FLOAT = 1e-6;
// Back-compat: older imports may still use EPS
export const EPS = EPS_FLOAT;

export type PaymentLite = {
  amount: unknown;
  method: string;
  refNo?: unknown;
};

export type LineWithTotalLite = {
  lineTotal: unknown;
};

export const isRiderShortageRef = (refNo: unknown) => {
  const ref = String(refNo ?? "").toUpperCase();
  return ref === "RIDER_SHORTAGE" || ref.startsWith("RIDER-SHORTAGE");
};

// Settlement truth for AR/ledger display:
// - CASH always counts
// - INTERNAL_CREDIT counts only if rider-shortage bridge ref
export const isSettlementPayment = (p: PaymentLite | null | undefined) => {
  const method = String(p?.method ?? "").toUpperCase();
  if (method === "CASH") return true;
  if (method === "INTERNAL_CREDIT" && isRiderShortageRef(p?.refNo)) return true;
  return false;
};

// Customer settlement truth = CASH + rider-shortage bridge
export const sumSettlementCredits = (
  payments: PaymentLite[] | null | undefined,
) =>
  r2(
    (payments ?? []).reduce((sum, p) => {
      const method = String(p?.method ?? "");
      const ok =
        method === "CASH" ||
        (method === "INTERNAL_CREDIT" && isRiderShortageRef(p?.refNo));
      if (!ok) return sum;

      const amt = toNum((p as any)?.amount);
      if (!Number.isFinite(amt) || amt <= 0) return sum;
      return sum + amt;
    }, 0),
  );

// Cash drawer truth = CASH only
export const sumCashPayments = (payments: PaymentLite[] | null | undefined) =>
  r2(
    (payments ?? []).reduce((sum, p) => {
      if (String(p?.method ?? "") !== "CASH") return sum;
      const amt = toNum((p as any)?.amount);
      if (!Number.isFinite(amt) || amt <= 0) return sum;
      return sum + amt;
    }, 0),
  );

// Bridge truth = INTERNAL_CREDIT w/ rider-shortage refs
export const sumShortageBridgePayments = (
  payments: PaymentLite[] | null | undefined,
) =>
  r2(
    (payments ?? []).reduce((sum, p) => {
      if (String(p?.method ?? "") !== "INTERNAL_CREDIT") return sum;
      if (!isRiderShortageRef(p?.refNo)) return sum;

      const amt = toNum((p as any)?.amount);
      if (!Number.isFinite(amt) || amt <= 0) return sum;
      return sum + amt;
    }, 0),
  );

// Generic customer settlement truth = ALL payments (walk-in / pickup / mixed payment)
export const sumAllPayments = (payments: PaymentLite[] | null | undefined) =>
  r2(
    (payments ?? []).reduce((sum, p) => {
      const amt = toNum((p as any)?.amount);
      if (!Number.isFinite(amt) || amt <= 0) return sum;
      return sum + amt;
    }, 0),
  );

// Frozen totals helpers (client-safe)
export const sumFrozenLineTotals = (
  lines: LineWithTotalLite[] | null | undefined,
) => r2((lines ?? []).reduce((s, it) => s + toNum((it as any)?.lineTotal), 0));

export const hasAllFrozenLineTotals = (
  lines: LineWithTotalLite[] | null | undefined,
) =>
  (lines ?? []).length > 0 &&
  (lines ?? []).every((x) => (x as any)?.lineTotal != null);
