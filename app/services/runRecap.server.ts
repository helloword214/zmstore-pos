/* app/services/runRecap.server.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { db } from "~/utils/db.server";

export type RecapRow = {
  productId: number;
  name: string;
  loaded: number;
  sold: number;
  returned: number;
  diff: number; // loaded - sold - returned
};

type LoadoutRow = { productId: number; name: string; qty: number };

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Source-of-truth recap for a run:
 * - loaded: from deliveryRun.loadoutSnapshot (fallback: implicitly loaded = parent sold if missing)
 * - parent sold: from deliveryRunOrder -> order.items, excluding RS-* (posted roadside orders)
 * - road sold: from runReceipt(kind="ROAD") lines
 * - returned: from stockMovement RETURN_IN if present else riderCheckinSnapshot.stockRows
 *
 * Returns:
 * - recapRows: per product Loaded/Sold/Returned/Diff
 * - hasDiffIssues: any diff != 0
 * - diffIssues: human-readable lines (for server-side guard)
 * - maps: loadedByPid, soldByPid, returnedByPid (if you need reuse)
 */
export async function loadRunRecap(dbx: typeof db, runId: number) {
  const run = await dbx.deliveryRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      loadoutSnapshot: true,
      riderCheckinSnapshot: true,
    },
  });
  if (!run) throw new Response("Run not found", { status: 404 });

  // 1) Loaded (from loadoutSnapshot)
  const loadout: LoadoutRow[] = Array.isArray(run.loadoutSnapshot)
    ? (run.loadoutSnapshot as any[])
        .map((l) => ({
          productId: Number(l?.productId ?? 0),
          name: String(l?.name ?? ""),
          qty: Math.max(0, Math.floor(n(l?.qty))),
        }))
        .filter(
          (l) => Number.isFinite(l.productId) && l.productId > 0 && l.qty > 0
        )
    : [];

  const loadedByPid = new Map<number, { name: string; qty: number }>();
  for (const l of loadout) {
    loadedByPid.set(l.productId, {
      name: l.name,
      qty: (loadedByPid.get(l.productId)?.qty || 0) + l.qty,
    });
  }

  // 2) Parent sold (from deliveryRunOrder orders, excluding RS-*)
  const parentLinks = await dbx.deliveryRunOrder.findMany({
    where: { runId },
    select: {
      order: {
        select: {
          orderCode: true,
          items: { select: { productId: true, name: true, qty: true } },
        },
      },
    },
  });

  const parentSoldByPid = new Map<number, number>();
  const parentNameByPid = new Map<number, string>();
  for (const L of parentLinks) {
    const o = L.order;
    if (!o) continue;
    if ((o.orderCode || "").startsWith("RS-")) continue; // ignore posted roadside orders
    for (const it of o.items || []) {
      const pid = Number(it.productId ?? 0);
      const qty = Math.max(0, n(it.qty));
      if (!pid || qty <= 0) continue;
      parentSoldByPid.set(pid, (parentSoldByPid.get(pid) || 0) + qty);
      if (!parentNameByPid.has(pid) && it.name)
        parentNameByPid.set(pid, String(it.name));
    }
  }

  // ✅ Align with UI/guard logic: if parent sold exists but missing in loadoutSnapshot,
  // treat as implicitly loaded at least the sold qty (legacy runs).
  for (const [pid, soldQty] of parentSoldByPid.entries()) {
    if (!loadedByPid.has(pid) && soldQty > 0) {
      loadedByPid.set(pid, {
        name: parentNameByPid.get(pid) ?? `#${pid}`,
        qty: soldQty,
      });
    }
  }

  // 3) Road sold (from ROAD receipts lines)
  const roadReceipts = await dbx.runReceipt.findMany({
    where: { runId, kind: "ROAD" },
    select: { lines: { select: { productId: true, name: true, qty: true } } },
  });
  const roadSoldByPid = new Map<number, number>();
  const roadNameByPid = new Map<number, string>();
  for (const rr of roadReceipts) {
    for (const ln of rr.lines || []) {
      const pid = Number(ln.productId ?? 0);
      const qty = Math.max(0, n(ln.qty));
      if (!pid || qty <= 0) continue;
      roadSoldByPid.set(pid, (roadSoldByPid.get(pid) || 0) + qty);
      if (!roadNameByPid.has(pid) && ln.name)
        roadNameByPid.set(pid, String(ln.name));
    }
  }

  // 4) Returned:
  // Prefer manager-grade truth from RETURN_IN movements.
  // If none exist, fallback to riderCheckinSnapshot.stockRows
  const returnedByPid = new Map<number, number>();
  const existingReturnMoves = await dbx.stockMovement.findMany({
    where: { refKind: "RUN", refId: runId, type: "RETURN_IN" },
    select: { productId: true, qty: true },
  });
  if (existingReturnMoves.length) {
    for (const m of existingReturnMoves) {
      const pid = Number(m.productId ?? 0);
      const qty = Math.max(0, n(m.qty));
      if (!pid || qty <= 0) continue;
      returnedByPid.set(pid, (returnedByPid.get(pid) || 0) + qty);
    }
  } else {
    const snap = run.riderCheckinSnapshot as any;
    if (snap && typeof snap === "object" && Array.isArray(snap.stockRows)) {
      for (const r of snap.stockRows) {
        const pid = Number(r?.productId ?? 0);
        const qty = Math.max(0, n(r?.returned));
        if (!pid || qty <= 0) continue;
        returnedByPid.set(pid, (returnedByPid.get(pid) || 0) + qty);
      }
    }
  }

  // 5) Compose recap rows
  const allPids = new Set<number>([
    ...loadedByPid.keys(),
    ...parentSoldByPid.keys(),
    ...roadSoldByPid.keys(),
    ...returnedByPid.keys(),
  ]);

  const recapRows: RecapRow[] = Array.from(allPids).map((pid) => {
    const loadedEntry = loadedByPid.get(pid);
    const loaded = loadedEntry?.qty ?? 0;
    const sold =
      (parentSoldByPid.get(pid) || 0) + (roadSoldByPid.get(pid) || 0);
    const returned = returnedByPid.get(pid) || 0;
    const diff = loaded - sold - returned;

    const name =
      loadedEntry?.name ||
      parentNameByPid.get(pid) ||
      roadNameByPid.get(pid) ||
      `#${pid}`;

    return { productId: pid, name, loaded, sold, returned, diff };
  });

  const diffIssues: string[] = [];
  for (const r of recapRows) {
    if (Math.abs(r.diff) > 0.0001) {
      diffIssues.push(
        `• Product #${r.productId}: loaded ${r.loaded}, sold ${r.sold}, returned ${r.returned} (diff ${r.diff})`
      );
    }
  }

  return {
    recapRows,
    hasDiffIssues: diffIssues.length > 0,
    diffIssues,
    loadedByPid,
    parentSoldByPid,
    roadSoldByPid,
    returnedByPid,
  };
}
