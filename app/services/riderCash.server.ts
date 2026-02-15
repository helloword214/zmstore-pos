/* eslint-disable @typescript-eslint/no-explicit-any */
/*  b/app/services/riderCash.server.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";

/**
 * Resolve rider "cash on hand" for a DELIVERY order.
 *
 * SOURCE OF TRUTH (priority):
 *  1) ROAD child order: orderCode = RS-RUN{runId}-RR{runReceiptId}  → runReceipt(kind="ROAD")
 *  2) Parent order: runReceipt(kind="PARENT", parentOrderId=orderId)
 *  3) Legacy fallback: deliveryRun.riderCheckinSnapshot (old fields)
 */

export async function getRiderCashForDeliveryOrder(
  dbx: PrismaClient,
  orderId: number
): Promise<{ riderCash: number; runId: number | null }> {
  // Find runId + snapshot (fallback only) + orderCode
  const link = await dbx.deliveryRunOrder.findFirst({
    where: { orderId },
    select: {
      runId: true,
      run: { select: { riderCheckinSnapshot: true } },
      order: { select: { orderCode: true } },
    },
  });
  const runId = link?.runId ?? null;
  const orderCode = link?.order?.orderCode ?? null;

  // ✅ ROAD child order: deterministic mapping via orderCode = RS-RUN{runId}-RR{runReceiptId}
  if (runId && orderCode && orderCode.startsWith(`RS-RUN${runId}-RR`)) {
    const m = String(orderCode).match(/-RR(\d+)$/);
    const rrId = m ? Number(m[1]) : NaN;
    if (Number.isFinite(rrId) && rrId > 0) {
      const rr = await dbx.runReceipt.findFirst({
        where: { id: rrId, runId, kind: "ROAD" },
        select: {
          cashCollected: true,
          lines: {
            select: { qty: true, unitPrice: true },
            orderBy: { id: "asc" },
          },
        },
      });
      if (rr) {
        const total = (rr.lines || []).reduce((s, ln) => {
          const q = Math.max(0, Number(ln.qty ?? 0));
          const up = Math.max(0, Number(ln.unitPrice ?? 0));
          return s + q * up;
        }, 0);
        const cash = Math.max(
          0,
          Math.min(total, Number(rr.cashCollected ?? 0))
        );
        return { riderCash: cash, runId };
      }
    }
  }

  // ✅ Parent order: use runReceipt(kind=PARENT, parentOrderId=orderId) if present
  if (runId) {
    const pr = await dbx.runReceipt.findFirst({
      where: { runId, kind: "PARENT", parentOrderId: orderId },
      select: { cashCollected: true },
    });
    if (pr) {
      return { riderCash: Math.max(0, Number(pr.cashCollected ?? 0)), runId };
    }
  }

  // Fallback: snapshot (legacy)
  const rawSnap = link?.run?.riderCheckinSnapshot as any;
  if (rawSnap && typeof rawSnap === "object") {
    const parentCashMap = new Map<number, number>();
    if (Array.isArray((rawSnap as any).parentOverrides)) {
      for (const row of (rawSnap as any).parentOverrides as any[]) {
        const oid = Number(row?.orderId ?? 0);
        if (!oid) continue;
        const legacyCash =
          row?.cashCollected ?? row?.cashAmount ?? row?.cash ?? null;
        const legacyNum = Number(legacyCash);
        if (!Number.isNaN(legacyNum) && legacyNum > 0) {
          parentCashMap.set(oid, (parentCashMap.get(oid) || 0) + legacyNum);
        }
      }
    }
    if (Array.isArray((rawSnap as any).parentPayments)) {
      for (const row of (rawSnap as any).parentPayments as any[]) {
        const oid = Number(row?.orderId ?? 0);
        if (!oid) continue;
        const rawCash =
          row?.cashCollected ?? row?.cashAmount ?? row?.cash ?? null;
        const cashNum = Number(rawCash);
        if (!Number.isNaN(cashNum) && cashNum > 0) {
          parentCashMap.set(oid, (parentCashMap.get(oid) || 0) + cashNum);
        }
      }
    }
    const raw = parentCashMap.get(orderId);
    if (raw != null && Number.isFinite(raw)) {
      return { riderCash: Math.max(0, raw), runId };
    }
  }

  return { riderCash: 0, runId };
}
