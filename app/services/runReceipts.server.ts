// app/services/runReceipts.server.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";

export type RoadsideCashRow = { cash: number; total: number };

/**
+ * @deprecated (for Run Remit page)
+ *
+ * The remit loader now computes ROAD totals directly from frozen RunReceipt(kind="ROAD")
+ * lines + cashCollected while building quickReceipts, and computes PARENT cash from
+ * RunReceipt(kind="PARENT") directly.
+ *
+ * Keep this only if other pages still rely on it; otherwise delete after repo-wide grep.
+ */

/**
 * Source of truth for run-scope cash expectations:
 *  - ROAD: runReceipt(kind="ROAD") + lines (mapped to RS orderCode)
 *  - PARENT: runReceipt(kind="PARENT") by parentOrderId
 *
 * Returns:
 *  - roadsideCashByOrderCode: key = `RS-RUN{runId}-RR{runReceiptId}`
 *  - parentCashByOrderId: key = parentOrderId (accumulated)
 *  - expectedCashRoad / expectedARRoad: contributions from ROAD receipts only
 */
export async function loadRunReceiptCashMaps(dbx: PrismaClient, runId: number) {
  // ────────────────────────────────────────────────
  // ROAD receipts → deterministic mapping via RS orderCode
  // ────────────────────────────────────────────────
  const roadReceipts = await dbx.runReceipt.findMany({
    where: { runId, kind: "ROAD" },
    select: {
      id: true,
      receiptKey: true,
      cashCollected: true,
      lines: { select: { qty: true, unitPrice: true }, orderBy: { id: "asc" } },
    },
    orderBy: { id: "asc" },
  });

  const roadsideCashByOrderCode = new Map<string, RoadsideCashRow>();
  let expectedCashRoad = 0;
  let expectedARRoad = 0;

  for (const rr of roadReceipts) {
    const total = (rr.lines ?? []).reduce((s, ln) => {
      const q = Math.max(0, Number(ln.qty ?? 0));
      const up = Math.max(0, Number(ln.unitPrice ?? 0));
      return s + q * up;
    }, 0);
    const cashCollected = Math.max(0, Number(rr.cashCollected ?? 0));
    const cash = Math.max(0, Math.min(total, cashCollected));
    const ar = Math.max(0, total - cash);

    expectedCashRoad += cash;
    expectedARRoad += ar;

    // Prefer stable receiptKey (matches upserts + UI hydration); fallback for legacy rows
    const key =
      (rr.receiptKey && String(rr.receiptKey).slice(0, 64)) ||
      `RS-RUN${runId}-RR${rr.id}`;
    roadsideCashByOrderCode.set(key, { cash, total });
  }

  // ────────────────────────────────────────────────
  // PARENT receipts → by parentOrderId (accumulate)
  // ────────────────────────────────────────────────
  const parentReceipts = await dbx.runReceipt.findMany({
    where: { runId, kind: "PARENT" },
    select: { parentOrderId: true, cashCollected: true },
  });

  const parentCashByOrderId = new Map<number, number>();
  for (const pr of parentReceipts) {
    const oid = pr.parentOrderId;
    if (!oid) continue;
    const cash = Math.max(0, Number(pr.cashCollected ?? 0));
    parentCashByOrderId.set(oid, (parentCashByOrderId.get(oid) || 0) + cash);
  }

  return {
    roadsideCashByOrderCode,
    parentCashByOrderId,
    expectedCashRoad,
    expectedARRoad,
  };
}
