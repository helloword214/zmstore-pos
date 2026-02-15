/* app/services/settlementSoT.server.ts
   Single Source of Truth helpers (server-side extras, Prisma-aligned)
*/

import { Prisma } from "@prisma/client";
import { r2, toNum } from "~/utils/money";

// Re-export client-safe helpers (so server routes can still import from .server if they want)
export {
  EPS,
  isRiderShortageRef,
  sumSettlementCredits,
  sumCashPayments,
  sumShortageBridgePayments,
  sumAllPayments,
  type PaymentLite,
} from "./settlementSoT";

// OrderItem.lineTotal + RunReceiptLine.lineTotal are Decimal in schema
export type LineWithTotal = { lineTotal: Prisma.Decimal | null };

export const sumFrozenLineTotals = (
  lines: LineWithTotal[] | null | undefined,
) => r2((lines ?? []).reduce((s, it) => s + toNum(it.lineTotal), 0));

export const hasAllFrozenLineTotals = (
  lines: LineWithTotal[] | null | undefined,
) =>
  (lines ?? []).length > 0 && (lines ?? []).every((x) => x.lineTotal != null);

// Safety: cap credits so running balance never negative
export const applyCreditCapped = (running: number, credit: number) => {
  const dueNow = Math.max(0, toNum(running));
  const applied = Math.min(Math.max(0, toNum(credit)), dueNow);
  return { applied: r2(applied), nextRunning: r2(dueNow - applied) };
};
