// app/routes/runs.$id.remit.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import * as React from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { db } from "~/utils/db.server";
import { RiderChargeStatus, UnitKind, Prisma } from "@prisma/client";
import { allocateReceiptNo } from "~/utils/receipt";
import { loadRunRecap } from "~/services/runRecap.server";
import { r2 as r2Money } from "~/utils/money";
import { requireRole } from "~/utils/auth.server";

// Local helper: money rounding (single source in this file, but we prefer r2Money)
const r2 = (n: number) => r2Money(Number(n) || 0);
const MONEY_EPS = 0.009;

const parseIsCreditFromNote = (note: unknown): boolean | null => {
  if (typeof note !== "string" || !note.trim()) return null;
  try {
    const meta = JSON.parse(note);
    return typeof meta?.isCredit === "boolean" ? meta.isCredit : null;
  } catch {
    return null;
  }
};

type DecisionKindUI =
  | "APPROVE_OPEN_BALANCE"
  | "APPROVE_DISCOUNT_OVERRIDE"
  | "APPROVE_HYBRID"
  | "REJECT";

type CaseInfo = {
  status: "NEEDS_CLEARANCE" | "DECIDED";
  decisionKind: DecisionKindUI | null;
  arBalance: number;
  overrideDiscount: number;
};

const parseDecisionKind = (raw: unknown): DecisionKindUI | null =>
  raw === "REJECT"
    ? "REJECT"
    : raw === "APPROVE_OPEN_BALANCE"
      ? "APPROVE_OPEN_BALANCE"
      : raw === "APPROVE_DISCOUNT_OVERRIDE"
        ? "APPROVE_DISCOUNT_OVERRIDE"
        : raw === "APPROVE_HYBRID"
          ? "APPROVE_HYBRID"
          : null;

const applyDecisionFinancial = (remainingRaw: number, c?: CaseInfo) => {
  const remaining = r2(Math.max(0, Number(remainingRaw || 0)));
  if (remaining <= MONEY_EPS) {
    return { ar: 0, approvedDiscount: 0, pending: 0, rejected: 0 };
  }

  if (!c) {
    return { ar: remaining, approvedDiscount: 0, pending: 0, rejected: 0 };
  }

  if (c.status === "NEEDS_CLEARANCE") {
    return { ar: 0, approvedDiscount: 0, pending: remaining, rejected: 0 };
  }

  if (c.decisionKind === "REJECT") {
    return { ar: 0, approvedDiscount: 0, pending: 0, rejected: remaining };
  }

  if (c.decisionKind === "APPROVE_DISCOUNT_OVERRIDE") {
    const approvedDiscount =
      c.overrideDiscount > MONEY_EPS
        ? r2(Math.min(remaining, c.overrideDiscount))
        : remaining;
    return { ar: 0, approvedDiscount, pending: 0, rejected: 0 };
  }

  if (c.decisionKind === "APPROVE_HYBRID") {
    const ar = c.arBalance > MONEY_EPS ? r2(Math.min(remaining, c.arBalance)) : 0;
    const approvedDiscount =
      c.overrideDiscount > MONEY_EPS
        ? r2(Math.min(remaining, c.overrideDiscount))
        : r2(Math.max(0, remaining - ar));
    return { ar, approvedDiscount, pending: 0, rejected: 0 };
  }

  const ar = c.arBalance > MONEY_EPS ? r2(Math.min(remaining, c.arBalance)) : remaining;
  return { ar, approvedDiscount: 0, pending: 0, rejected: 0 };
};

const sumLineDiscountTotal = (
  lines: Array<{ qty: unknown; discountAmount?: unknown | null }>,
) =>
  r2(
    (lines || []).reduce((sum, ln) => {
      const qty = Math.max(0, Number(ln.qty ?? 0));
      const disc = Math.max(0, Number(ln.discountAmount ?? 0));
      return sum + qty * disc;
    }, 0),
  );

type RecapRow = {
  productId: number;
  name: string;
  loaded: number;
  sold: number;
  returned: number;
  diff: number; // loaded - sold - returned
};

type QuickSaleRow = {
  idx: number;
  productId: number | null;
  productName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  customerId: number | null;
  customerLabel: string;
  isCredit: boolean;
  cashAmount: number;
  creditAmount: number;
  baseUnitPrice?: number;
  discountAmount?: number;
};

type QuickSaleReceipt = {
  key: string;
  customerId: number | null;
  customerLabel: string;
  isCredit: boolean;
  total: number;
  cash: number;
  ar: number;
  approvedDiscount: number;
  systemDiscount: number;
  pendingClearance: number;
  rejectedUnresolved: number;
  caseStatus: "NEEDS_CLEARANCE" | "DECIDED" | null;
  decisionKind: DecisionKindUI | null;
  rows: QuickSaleRow[];
};

type ParentOrderLine = {
  productId: number | null;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  baseUnitPrice?: number;
  discountAmount?: number;
};

type ParentOrderRow = {
  orderId: number;
  isCredit: boolean;
  customerLabel: string;
  lines: ParentOrderLine[];
  orderTotal: number;
  collectedCash?: number;
  pricingMismatch?: boolean;
  ar: number;
  approvedDiscount: number;
  systemDiscount: number;
  pendingClearance: number;
  rejectedUnresolved: number;
  caseStatus: "NEEDS_CLEARANCE" | "DECIDED" | null;
  decisionKind: DecisionKindUI | null;
};

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: "PLANNED" | "DISPATCHED" | "CHECKED_IN" | "CLOSED" | "CANCELLED";
    riderLabel: string | null;
  };
  recapRows: RecapRow[];
  stockVerificationRows: StockVerificationRow[];
  quickReceipts: QuickSaleReceipt[];
  parentOrders: ParentOrderRow[];
  totals: {
    roadsideCash: number;
    roadsideAR: number;
    roadsideApprovedDiscount: number;
    roadsideSystemDiscount: number;
    parentCash: number;
    parentAR: number;
    parentApprovedDiscount: number;
    parentSystemDiscount: number;
    pendingClearance: number;
    rejectedUnresolved: number;
  };
};

type ActionData =
  | { ok: true }
  | {
      ok: false;
      error: string;
    };

type StockValueSource =
  | "ROAD_FROZEN"
  | "PARENT_FROZEN"
  | "PRODUCT_SRP"
  | "PRODUCT_PRICE";

type StockVerificationRow = {
  productId: number;
  name: string;
  loaded: number;
  sold: number;
  unsold: number;
  unitValue: number | null;
  valueSource: StockValueSource | null;
};

async function loadStockUnitValues(
  runId: number,
  productIds: number[],
): Promise<Map<number, { unitValue: number | null; source: StockValueSource | null }>> {
  const out = new Map<
    number,
    { unitValue: number | null; source: StockValueSource | null }
  >();
  const ids = Array.from(
    new Set(productIds.filter((x) => Number.isFinite(x) && x > 0)),
  );
  if (!ids.length) return out;

  // Priority 1: ROAD frozen lines (RunReceiptLine)
  const roadLines = await db.runReceiptLine.findMany({
    where: {
      productId: { in: ids },
      receipt: { runId, kind: "ROAD" },
    },
    select: { productId: true, qty: true, unitPrice: true },
  });
  const roadAgg = new Map<number, { qty: number; amt: number }>();
  for (const ln of roadLines) {
    const pid = Number(ln.productId);
    const qty = Math.max(0, Number(ln.qty ?? 0));
    const up = Math.max(0, Number(ln.unitPrice ?? 0));
    if (pid <= 0 || qty <= 0 || up <= 0) continue;
    const cur = roadAgg.get(pid) || { qty: 0, amt: 0 };
    cur.qty += qty;
    cur.amt += qty * up;
    roadAgg.set(pid, cur);
  }

  // Priority 2: Parent frozen lines (OrderItem)
  const parentLinks = await db.deliveryRunOrder.findMany({
    where: { runId },
    select: {
      order: {
        select: {
          orderCode: true,
          items: {
            where: { productId: { in: ids } },
            select: { productId: true, qty: true, unitPrice: true },
          },
        },
      },
    },
  });
  const parentAgg = new Map<number, { qty: number; amt: number }>();
  for (const link of parentLinks) {
    const o = link.order;
    if (!o) continue;
    if ((o.orderCode || "").startsWith("RS-")) continue;
    for (const it of o.items || []) {
      const pid = Number(it.productId);
      const qty = Math.max(0, Number(it.qty ?? 0));
      const up = Math.max(0, Number(it.unitPrice ?? 0));
      if (pid <= 0 || qty <= 0 || up <= 0) continue;
      const cur = parentAgg.get(pid) || { qty: 0, amt: 0 };
      cur.qty += qty;
      cur.amt += qty * up;
      parentAgg.set(pid, cur);
    }
  }

  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, srp: true, price: true },
  });
  const byProduct = new Map(
    products.map((p) => [
      p.id,
      { srp: Number(p.srp ?? 0), price: Number(p.price ?? 0) },
    ]),
  );

  for (const pid of ids) {
    const road = roadAgg.get(pid);
    if (road && road.qty > 0) {
      out.set(pid, {
        unitValue: r2(road.amt / road.qty),
        source: "ROAD_FROZEN",
      });
      continue;
    }
    const parent = parentAgg.get(pid);
    if (parent && parent.qty > 0) {
      out.set(pid, {
        unitValue: r2(parent.amt / parent.qty),
        source: "PARENT_FROZEN",
      });
      continue;
    }
    const p = byProduct.get(pid);
    if (p && p.srp > 0) {
      out.set(pid, { unitValue: r2(p.srp), source: "PRODUCT_SRP" });
      continue;
    }
    if (p && p.price > 0) {
      out.set(pid, { unitValue: r2(p.price), source: "PRODUCT_PRICE" });
      continue;
    }
    out.set(pid, { unitValue: null, source: null });
  }

  return out;
}

// ─────────────────────────────────────────
// Loader: overview only (no editing)
// ─────────────────────────────────────────
export async function loader({ request, params }: LoaderFunctionArgs) {
  // 🔒 Remit page: MANAGER / ADMIN only
  await requireRole(request, ["STORE_MANAGER", "ADMIN"]);
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: {
      id: true,
      runCode: true,
      status: true,
      riderId: true,
      loadoutSnapshot: true,
      riderCheckinSnapshot: true,
      receipts: {
        select: {
          id: true,
          kind: true,
          receiptKey: true,
          cashCollected: true,
          note: true,
          customerId: true,
          customerName: true,
          customerPhone: true,
          parentOrderId: true,
          lines: {
            select: {
              id: true,
              productId: true,
              name: true,
              qty: true,
              unitPrice: true,
              lineTotal: true,
              baseUnitPrice: true,
              discountAmount: true,
            },
            orderBy: { id: "asc" },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!run) throw new Response("Not found", { status: 404 });

  if (
    run.status !== "DISPATCHED" &&
    run.status !== "CHECKED_IN" &&
    run.status !== "CLOSED"
  ) {
    throw new Response("Run is not dispatched yet.", { status: 400 });
  }

  // 🔒 Remit is for manager review AFTER rider check-in.
  // If still DISPATCHED, send them to check-in page (or summary).
  if (run.status === "DISPATCHED") {
    return redirect(`/runs/${id}/rider-checkin?needCheckin=1`);
  }

  // Rider label
  let riderLabel: string | null = null;
  if (run.riderId) {
    const r = await db.employee.findUnique({
      where: { id: run.riderId },
      select: { firstName: true, lastName: true, alias: true },
    });
    riderLabel =
      r?.alias?.trim() ||
      [r?.firstName, r?.lastName].filter(Boolean).join(" ") ||
      null;
  }

  // ✅ Stock recap (source of truth)
  const recap = await loadRunRecap(db, id);

  // NOTE:
  // stockRows parsing was moved into loadRunRecap()
  // to keep a single source of truth for:
  //   Loaded / Sold / Returned / Diff

  // returnedByPid already handled inside loadRunRecap (RETURN_IN > snapshot)

  const cases = await db.clearanceCase.findMany({
    where: {
      runId: id,
      status: { in: ["NEEDS_CLEARANCE", "DECIDED"] },
    } as any,
    select: {
      receiptKey: true,
      status: true,
      decisions: {
        select: {
          kind: true,
          arBalance: true,
          overrideDiscountApproved: true,
        },
        orderBy: { id: "desc" },
        take: 1,
      },
    },
  });
  const caseByReceiptKey = new Map<string, CaseInfo>();
  for (const c of cases || []) {
    const rk = String((c as any).receiptKey || "").slice(0, 64);
    if (!rk) continue;

    const status = String((c as any).status || "");
    if (status !== "NEEDS_CLEARANCE" && status !== "DECIDED") continue;

    const d = (c as any)?.decisions?.[0];
    caseByReceiptKey.set(rk, {
      status,
      decisionKind: parseDecisionKind(d?.kind),
      arBalance: r2(Math.max(0, Number(d?.arBalance ?? 0))),
      overrideDiscount: r2(Math.max(0, Number(d?.overrideDiscountApproved ?? 0))),
    });
  }

  // 3) Roadside sales list (SOURCE: RunReceipt kind=ROAD)

  // ✅ Receipt-level view: 1 QuickSaleReceipt per RunReceipt(kind=ROAD)
  // ROAD receipts -> QuickSaleReceipt (source: RunReceipt kind=ROAD)
  const quickReceipts: QuickSaleReceipt[] = (run.receipts || [])
    .filter((r) => r.kind === "ROAD")
    .map((rec) => {
      const cashCollected = Number(rec.cashCollected ?? 0);
      let receiptIsCredit = cashCollected <= 0;
      const parsedIsCredit = parseIsCreditFromNote(rec.note);
      if (parsedIsCredit != null) receiptIsCredit = parsedIsCredit;
      const rk = String(rec.receiptKey || `ROAD:${rec.id}`).slice(0, 64);
      const caseInfo = caseByReceiptKey.get(rk);

      const custLabelBase =
        (rec.customerName && rec.customerName.trim()) ||
        (rec.customerId ? `Customer #${rec.customerId}` : "Walk-in / Unknown");
      const customerLabel = rec.customerPhone
        ? `${custLabelBase} • ${rec.customerPhone}`
        : custLabelBase;

      const rows: QuickSaleRow[] = (rec.lines || []).map((ln, i) => {
        const qty = Math.max(0, Number(ln.qty ?? 0));
        const unitPrice = Math.max(0, Number(ln.unitPrice ?? 0));
        const lineTotal = r2(Number(ln.lineTotal ?? qty * unitPrice));
        const pid = ln.productId != null ? Number(ln.productId) : null;

        return {
          idx: i,
          productId: pid,
          productName:
            ln.name && ln.name.trim()
              ? ln.name
              : ln.productId != null
              ? `#${ln.productId}`
              : "Unknown",
          qty,
          unitPrice,
          lineTotal,
          customerId: rec.customerId ?? null,
          customerLabel,
          isCredit: receiptIsCredit,
          cashAmount: 0, // we'll compute below
          creditAmount: 0, // we'll compute below
          baseUnitPrice:
            ln.baseUnitPrice != null ? Number(ln.baseUnitPrice) : undefined,
          discountAmount:
            ln.discountAmount != null ? Number(ln.discountAmount) : undefined,
        };
      });

      const total = r2(rows.reduce((s, r) => s + r.lineTotal, 0));
      const systemDiscount = sumLineDiscountTotal(rows);
      const cash = r2(Math.max(0, Math.min(total, cashCollected || 0)));
      const remaining = r2(Math.max(0, total - cash));
      const d = applyDecisionFinancial(remaining, caseInfo);
      const ar = r2(Math.max(0, d.ar));
      const approvedDiscount = r2(Math.max(0, d.approvedDiscount));
      const pendingClearance = r2(Math.max(0, d.pending));
      const rejectedUnresolved = r2(Math.max(0, d.rejected));
      // ✅ Effective credit must reflect remaining balance regardless of meta
      const isCreditEffective = receiptIsCredit || ar > MONEY_EPS;

      // distribute cash for display (optional)
      const sum = rows.reduce((s, r) => s + r.lineTotal, 0) || 0;
      for (const r of rows) {
        const share = sum > 0 ? r.lineTotal / sum : 0;
        const ca = r2(cash * share);
        r.cashAmount = ca;
        r.creditAmount = r2(Math.max(0, r.lineTotal - ca));
        r.isCredit = isCreditEffective || r.creditAmount > MONEY_EPS;
      }

      return {
        key: rk,
        customerId: rec.customerId ?? null,
        customerLabel,
        isCredit: isCreditEffective,
        total,
        cash,
        ar,
        approvedDiscount,
        systemDiscount,
        pendingClearance,
        rejectedUnresolved,
        caseStatus: caseInfo?.status ?? null,
        decisionKind: caseInfo?.decisionKind ?? null,
        rows,
      };
    });

  // 4) Parent Orders (DISPLAY): SOURCE OF TRUTH = Order + OrderItem (frozen)
  // NOTE: collection truth for parent is still RunReceipt(kind=PARENT).cashCollected (handled later)
  const parentOrderIds = Array.from(
    new Set(
      (run.receipts || [])
        .filter((r) => r.kind === "PARENT" && r.parentOrderId != null)
        .map((r) => Number(r.parentOrderId))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  );

  const parentOrderRecords = parentOrderIds.length
    ? await db.order.findMany({
        where: { id: { in: parentOrderIds } },
        select: {
          id: true,
          subtotal: true,
          totalBeforeDiscount: true,
          customerId: true,
          isOnCredit: true,
          deliverTo: true,
          deliverPhone: true,
          customer: {
            select: {
              firstName: true,
              lastName: true,
              alias: true,
              phone: true,
            },
          },
          items: {
            select: {
              id: true,
              productId: true,
              name: true,
              unitKind: true,
              qty: true,
              unitPrice: true,
              lineTotal: true,
              baseUnitPrice: true,
              discountAmount: true,
            },
            orderBy: { id: "asc" },
          },
        },
      })
    : [];

  // IMPORTANT (Remix): keep *.server imports out of route module scope
  // so client bundle won't pull them in.
  const { getFrozenPricingFromOrder } = await import(
    "~/services/frozenPricing.server"
  );

  const parentOrders: ParentOrderRow[] = parentOrderRecords.map((o) => {
    // IMPORTANT (Remix): keep *.server imports out of route module scope
    // so client bundle won't pull them in.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    const custName =
      o.customer?.alias?.trim() ||
      [o.customer?.firstName, o.customer?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      "";

    const custLabelBase =
      (custName && custName.trim()) ||
      (o.deliverTo && String(o.deliverTo).trim()) ||
      (o.customerId ? `Customer #${o.customerId}` : "Walk-in / Unknown");

    const phone =
      (o.customer?.phone && String(o.customer.phone).trim()) ||
      (o.deliverPhone && String(o.deliverPhone).trim()) ||
      "";

    const customerLabel = phone ? `${custLabelBase} • ${phone}` : custLabelBase;
    const caseInfo = caseByReceiptKey.get(`PARENT:${Number(o.id)}`);

    const lines: ParentOrderLine[] = (o.items || []).map((it) => {
      const qty = Math.max(0, Number(it.qty ?? 0));
      const unitPrice = Math.max(0, Number(it.unitPrice ?? 0));
      // ✅ STRICT: lineTotal must come from DB (frozen), no computed fallback
      const lineTotal = r2(Number(it.lineTotal ?? 0));

      return {
        productId: it.productId != null ? Number(it.productId) : null,
        name: String(it.name ?? ""),
        qty,
        unitPrice,
        lineTotal,
        baseUnitPrice:
          it.baseUnitPrice != null ? Number(it.baseUnitPrice) : undefined,
        discountAmount:
          it.discountAmount != null ? Number(it.discountAmount) : undefined,
      };
    });

    // ✅ SINGLE SOURCE OF TRUTH:
    // Use the same frozen pricing helper used by Rider Check-in mismatch guard.
    // This avoids remit/check-in divergence (especially per-unit discount semantics).

    const frozen = getFrozenPricingFromOrder({
      id: Number(o.id),
      subtotal: o.subtotal ?? null,
      totalBeforeDiscount: o.totalBeforeDiscount ?? null,
      items: (o.items || []).map((it) => ({
        qty: Number(it.qty ?? 0),
        unitKind: ((it.unitKind ?? UnitKind.PACK) === UnitKind.RETAIL
          ? "RETAIL"
          : "PACK") as "PACK" | "RETAIL",
        baseUnitPrice: Number(it.baseUnitPrice ?? 0),
        unitPrice: Number(it.unitPrice ?? 0),
        discountAmount: Number(it.discountAmount ?? 0),
        lineTotal: Number(it.lineTotal ?? 0),
      })),
    });

    const pricingMismatch = frozen.mismatch;

    // ✅ Totals shown in UI should also align with frozen helper outputs.

    // Source: frozen helper = SUM(lineTotal) with same rounding rules.
    const orderTotal = r2(frozen.computedSubtotal);
    const systemDiscount = sumLineDiscountTotal(lines);

    return {
      orderId: Number(o.id),
      isCredit: Boolean(o.isOnCredit),
      customerLabel,
      lines,
      orderTotal,
      pricingMismatch,
      collectedCash: undefined,
      ar: 0,
      approvedDiscount: 0,
      systemDiscount,
      pendingClearance: 0,
      rejectedUnresolved: 0,
      caseStatus: caseInfo?.status ?? null,
      decisionKind: caseInfo?.decisionKind ?? null,
    };
  });

  // ✅ STRICT: no base/discount fallback. Badge shows ONLY when snapshot fields exist.
  // NOTE: Parent orders here are frozen from OrderItem (POS/PAD source of truth). No pricing recompute.

  // ✅ Use recap from service (stable, same as action guard)
  const recapRows: RecapRow[] = recap.recapRows;
  const stockVerificationRowsBase = recapRows.map((r) => ({
    productId: r.productId,
    name: r.name,
    loaded: Number(r.loaded || 0),
    sold: Number(r.sold || 0),
    unsold: Math.max(0, Number(r.loaded || 0) - Number(r.sold || 0)),
  }));
  const unsoldProductIds = stockVerificationRowsBase
    .filter((r) => r.unsold > 0)
    .map((r) => r.productId);
  const unitValues = await loadStockUnitValues(id, unsoldProductIds);
  const stockVerificationRows: StockVerificationRow[] = stockVerificationRowsBase.map(
    (r) => {
      const v = unitValues.get(r.productId);
      return {
        ...r,
        unitValue: v?.unitValue ?? null,
        valueSource: v?.source ?? null,
      };
    },
  );

  // ✅ SOURCE OF TRUTH for parent CASH: sum of RunReceipt(kind=PARENT).cashCollected per parentOrderId
  // This avoids mismatch when loadRunReceiptCashMaps() is incomplete/out-of-sync.
  const parentCashByOrderIdLocal = new Map<number, number>();
  for (const r of run.receipts || []) {
    if (r.kind !== "PARENT") continue;
    if (r.parentOrderId == null) continue;
    const oid = Number(r.parentOrderId);
    const cash = Math.max(0, Number(r.cashCollected ?? 0));
    parentCashByOrderIdLocal.set(
      oid,
      (parentCashByOrderIdLocal.get(oid) || 0) + cash,
    );
  }

  for (const o of parentOrders) {
    const raw = Number(parentCashByOrderIdLocal.get(o.orderId) || 0);
    const capped = Math.max(0, Math.min(o.orderTotal, raw));
    o.collectedCash = capped > 0 ? capped : undefined;

    const caseInfo = caseByReceiptKey.get(`PARENT:${o.orderId}`);
    const remaining = r2(Math.max(0, Number(o.orderTotal || 0) - capped));
    const d = applyDecisionFinancial(remaining, caseInfo);
    o.ar = r2(Math.max(0, d.ar));
    o.approvedDiscount = r2(Math.max(0, d.approvedDiscount));
    o.pendingClearance = r2(Math.max(0, d.pending));
    o.rejectedUnresolved = r2(Math.max(0, d.rejected));
    o.caseStatus = caseInfo?.status ?? null;
    o.decisionKind = caseInfo?.decisionKind ?? null;
    o.isCredit = o.ar > MONEY_EPS;
  }

  // Totals for display (single source of truth = computed from frozen ROAD receipts)
  const roadsideCash = r2(
    quickReceipts.reduce((s, r) => s + Number(r.cash || 0), 0),
  );
  const roadsideAR = r2(
    quickReceipts.reduce((s, r) => s + Number(r.ar || 0), 0),
  );
  const roadsideApprovedDiscount = r2(
    quickReceipts.reduce((s, r) => s + Number(r.approvedDiscount || 0), 0),
  );
  const roadsideSystemDiscount = r2(
    quickReceipts.reduce((s, r) => s + Number(r.systemDiscount || 0), 0),
  );

  // Parent cash total (cap per order total)
  const parentCash = r2(
    parentOrders.reduce((s, o) => s + Number(o.collectedCash ?? 0), 0),
  );
  const parentAR = r2(parentOrders.reduce((s, o) => s + Number(o.ar || 0), 0));
  const parentApprovedDiscount = r2(
    parentOrders.reduce((s, o) => s + Number(o.approvedDiscount || 0), 0),
  );
  const parentSystemDiscount = r2(
    parentOrders.reduce((s, o) => s + Number(o.systemDiscount || 0), 0),
  );
  const pendingClearance = r2(
    quickReceipts.reduce((s, r) => s + Number(r.pendingClearance || 0), 0) +
      parentOrders.reduce((s, o) => s + Number(o.pendingClearance || 0), 0),
  );
  const rejectedUnresolved = r2(
    quickReceipts.reduce((s, r) => s + Number(r.rejectedUnresolved || 0), 0) +
      parentOrders.reduce((s, o) => s + Number(o.rejectedUnresolved || 0), 0),
  );

  return json<LoaderData>({
    run: {
      id: run.id,
      runCode: run.runCode,
      status: run.status as any,
      riderLabel,
    },
    recapRows,
    stockVerificationRows,
    quickReceipts,
    parentOrders,
    totals: {
      roadsideCash,
      roadsideAR,
      roadsideApprovedDiscount,
      roadsideSystemDiscount,
      parentCash,
      parentAR,
      parentApprovedDiscount,
      parentSystemDiscount,
      pendingClearance,
      rejectedUnresolved,
    },
  });
}

// ─────────────────────────────────────────
// Action: use snapshot only; manager just approves
// ─────────────────────────────────────────
export async function action({ request, params }: ActionFunctionArgs) {
  // 🔒 Extra guard: only MANAGER / ADMIN can post remit / revert
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);
  const id = Number(params.id);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "post-remit");

  // Pang-audit sa A/R approver (manager/admin)
  const approverLabel =
    (me as any).alias?.trim?.() ||
    (me as any).name?.trim?.() ||
    (typeof (me as any).userId !== "undefined"
      ? `USER#${(me as any).userId}`
      : "MANAGER");
  const managerApprovedById = Number((me as any).userId) || null;
  if (!Number.isFinite(id)) {
    return json<ActionData>(
      { ok: false, error: "Invalid ID" },
      { status: 400 },
    );
  }

  const run = await db.deliveryRun.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      runCode: true,
      riderId: true,
      loadoutSnapshot: true,
      riderCheckinSnapshot: true,
    },
  });
  if (!run)
    return json<ActionData>({ ok: false, error: "Not found" }, { status: 404 });

  const isApproveIntent = intent === "post-remit";
  const isChargeIntent = intent === "charge-remit";
  if (!isApproveIntent && !isChargeIntent) {
    return json<ActionData>(
      { ok: false, error: "Unsupported intent." },
      { status: 400 },
    );
  }

  // ✅ If already CLOSED, treat as idempotent "posted" (avoid double-post from stale tabs/manual POST)
  if ((isApproveIntent || isChargeIntent) && run.status === "CLOSED") {
    return redirect(`/runs/${id}/summary?posted=1`);
  }

  // ─────────────────────────────────────
  // INTENT: Post remit & close runƒ
  // ─────────────────────────────────────

  // Dito lang pwede mag-remit kapag CHECKED_IN na si rider.
  if (run.status !== "CHECKED_IN") {
    return json<ActionData>(
      { ok: false, error: "Run must be CHECKED_IN before remit." },
      { status: 400 },
    );
  }

  // CCS v2.7 remit gate:
  // No remit while any receipt in this run is still pending clearance.
  const pendingClearanceCount = await db.clearanceCase.count({
    where: { runId: id, status: "NEEDS_CLEARANCE" } as any,
  });
  if (pendingClearanceCount > 0) {
    return json<ActionData>(
      {
        ok: false,
        error:
          "Cannot post remit: there are pending clearance cases (NEEDS_CLEARANCE).",
      },
      { status: 400 },
    );
  }

  const recap = await loadRunRecap(db, id);
  const stockRowsForDecision = recap.recapRows.map((row) => {
    const loaded = Number(row.loaded || 0);
    const sold = Number(row.sold || 0);
    const unsold = Math.max(0, loaded - sold);
    const decisionRaw = String(formData.get(`verify_${row.productId}`) || "");
    const decision = decisionRaw === "missing" ? "missing" : "present";
    return {
      productId: row.productId,
      name: row.name,
      loaded,
      sold,
      unsold,
      decision,
    };
  });

  // Pull soldRows from rider check-in snapshot
  // SOURCE OF TRUTH: RunReceipt kind=ROAD (receipt-level quick sales)
  const roadReceipts = await db.runReceipt.findMany({
    where: { runId: id, kind: "ROAD" },
    select: {
      id: true,
      receiptKey: true,
      customerId: true,
      customerName: true,
      customerPhone: true,
      cashCollected: true,
      note: true,
      lines: {
        select: {
          productId: true,
          name: true,
          qty: true,
          unitPrice: true,
          lineTotal: true,
          baseUnitPrice: true,
          discountAmount: true,
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });

  type ReceiptLine = {
    productId: number;
    name: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    baseUnitPrice: number | null;
    discountAmount: number | null;
  };

  type ReceiptRow = {
    roadReceiptId: number;
    customerId: number | null;
    customerName: string | null;
    customerPhone: string | null;
    isCredit: boolean;
    cashCollected: number;
    lines: ReceiptLine[];
  };

  const soldReceipts: ReceiptRow[] = roadReceipts
    .map((rr) => {
      const cashCollected = Number(rr.cashCollected ?? 0);
      let isCredit = cashCollected <= 0;
      const parsedIsCredit = parseIsCreditFromNote(rr.note);
      if (parsedIsCredit != null) isCredit = parsedIsCredit;
      const lines = (rr.lines || [])
        .map((ln) => {
          const qty = Math.max(0, Number(ln.qty ?? 0));
          const unitPrice = Math.max(0, Number(ln.unitPrice ?? 0));
          const rawLineTotal =
            ln.lineTotal != null ? Number(ln.lineTotal) : qty * unitPrice;
          const lineTotal = Math.max(0, r2(rawLineTotal)); // ✅ number, not string

          return {
            productId: Number(ln.productId),
            name: String(ln.name ?? ""),
            qty,
            unitPrice,
            lineTotal,
            baseUnitPrice:
              ln.baseUnitPrice != null ? Number(ln.baseUnitPrice) : null,
            discountAmount:
              ln.discountAmount != null ? Number(ln.discountAmount) : null,
          };
        })
        .filter((ln) => ln.productId > 0 && ln.qty > 0);
      return {
        roadReceiptId: rr.id,
        customerId: rr.customerId ?? null,
        customerName: rr.customerName ?? null,
        customerPhone: rr.customerPhone ?? null,
        isCredit,
        cashCollected: Math.max(0, cashCollected),
        lines,
      };
    })
    .filter((r) => r.lines.length > 0);

  // Guard: sold ≤ loaded
  const over: string[] = [];
  // Guard: TOTAL sold ≤ loaded (parent + road), based on recap source of truth
  for (const row of recap.recapRows) {
    if (row.sold > row.loaded) {
      over.push(
        `• ${row.name} (#${row.productId}): sold ${row.sold} > loaded ${row.loaded}`,
      );
    }
  }
  if (over.length) {
    return json<ActionData>(
      {
        ok: false,
        error:
          "Cannot post remit: Sold quantity exceeds loaded for some products:\n" +
          over.join("\n"),
      },
      { status: 400 },
    );
  }

  const unsoldRows = stockRowsForDecision.filter((r) => r.unsold > 0);
  const missingRowsRaw = unsoldRows.filter((r) => r.decision === "missing");

  if (isApproveIntent && missingRowsRaw.length > 0) {
    return json<ActionData>(
      {
        ok: false,
        error:
          "Cannot approve normal remit: some unsold items are marked missing. Use 'Charge Rider (Missing Stocks) & Close Run'.",
      },
      { status: 400 },
    );
  }

  if (isChargeIntent && missingRowsRaw.length === 0) {
    return json<ActionData>(
      {
        ok: false,
        error:
          "No missing unsold items selected. Mark at least one unsold item as missing before charging rider.",
      },
      { status: 400 },
    );
  }

  const missingProductIds = missingRowsRaw.map((r) => r.productId);
  const missingUnitValues = await loadStockUnitValues(id, missingProductIds);
  const missingRows = missingRowsRaw.map((r) => {
    const v = missingUnitValues.get(r.productId);
    const unitValue = v?.unitValue ?? null;
    const amount =
      unitValue != null ? r2(Math.max(0, Number(r.unsold || 0)) * unitValue) : 0;
    return {
      ...r,
      unitValue,
      valueSource: v?.source ?? null,
      amount,
    };
  });

  const unpricedMissing = missingRows.filter((r) => r.unitValue == null);
  if (unpricedMissing.length) {
    return json<ActionData>(
      {
        ok: false,
        error:
          "Cannot charge rider: some missing products have no valuation source.\n" +
          unpricedMissing
            .map((r) => `• ${r.name} (#${r.productId})`)
            .join("\n"),
      },
      { status: 400 },
    );
  }

  const missingTotal = r2(missingRows.reduce((s, r) => s + r.amount, 0));
  if (isChargeIntent && missingTotal <= 0.009) {
    return json<ActionData>(
      {
        ok: false,
        error: "Cannot charge rider: computed shortage value is zero.",
      },
      { status: 400 },
    );
  }

  if (isChargeIntent && !run.riderId) {
    return json<ActionData>(
      {
        ok: false,
        error: "Cannot charge rider: run has no assigned rider.",
      },
      { status: 400 },
    );
  }

  // Price guard for remit:
  // ✅ NO PRICING ENGINE HERE.
  // Manager remit must NEVER recompute unit prices.
  // Simple rule: if credit, must have customer.
  const pids = Array.from(
    new Set(soldReceipts.flatMap((r) => r.lines.map((ln) => ln.productId))),
  );
  const products = pids.length
    ? await db.product.findMany({
        where: { id: { in: pids } },
        select: { id: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  for (const rec of soldReceipts) {
    // IMPORTANT: Credit OR partial payment (balance remains) requires customer
    const recSubtotal = rec.lines.reduce(
      (s, ln) => s + Number(ln.lineTotal || 0),
      0,
    );
    const paid = Math.max(
      0,
      Math.min(recSubtotal, Number(rec.cashCollected || 0)),
    );
    const hasBalance = paid + 0.009 < recSubtotal;
    const isCreditEffective = rec.isCredit || hasBalance;

    if (isCreditEffective && !rec.customerId) {
      return json<ActionData>(
        {
          ok: false,
          error: "On-credit / partial payment requires a customer.",
        },
        { status: 400 },
      );
    }
  }

  // Precompute rider name once (for receipts)
  let riderName: string | null = null;
  if (run.riderId) {
    const e = await db.employee.findUnique({
      where: { id: run.riderId },
      select: { alias: true, firstName: true, lastName: true },
    });
    riderName =
      e?.alias?.trim() ||
      [e?.firstName, e?.lastName].filter(Boolean).join(" ") ||
      null;
  }

  const returnRows = stockRowsForDecision
    .filter((r) => r.unsold > 0 && r.decision !== "missing")
    .map((r) => ({
      productId: r.productId,
      qty: r.unsold,
      name: r.name,
    }));

  await db.$transaction(async (tx) => {
    // ✅ Re-check status inside transaction (race safety)
    const fresh = await tx.deliveryRun.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!fresh || fresh.status !== "CHECKED_IN") {
      throw new Error("Run status changed. Refresh the page.");
    }

    const existingRoadOrders = await tx.deliveryRunOrder.findMany({
      where: { runId: id },
      select: { orderId: true },
    });
    const existingOrderIds = existingRoadOrders.map((x) => x.orderId);
    const existingCodes = existingOrderIds.length
      ? await tx.order.findMany({
          where: {
            id: { in: existingOrderIds },
            orderCode: { startsWith: "RS-" },
          },
          select: { orderCode: true },
        })
      : [];

    // ✅ Extra safety: catch partial-failure duplicates (order created but not linked)
    const existingCodesByPrefix = await tx.order.findMany({
      where: { orderCode: { startsWith: `RS-RUN${id}-RR` } },
      select: { orderCode: true },
    });

    const existingSet = new Set([
      ...existingCodes.map((x) => x.orderCode),
      ...existingCodesByPrefix.map((x) => x.orderCode),
    ]);
    // Create ONE roadside order per receipt (multi-line)
    for (const rec of soldReceipts) {
      // ✅ Deterministic + idempotent: 1 posted RS order per ROAD receipt
      const orderCode = `RS-RUN${id}-RR${rec.roadReceiptId}`;
      if (existingSet.has(orderCode)) continue;

      const itemsCreate = [];
      let subtotal = 0;
      for (const ln of rec.lines) {
        const exists = byId.get(ln.productId);
        if (!exists)
          throw new Error(`Missing product ${ln.productId} for remit`);

        // ✅ FROZEN pricing from RunReceiptLine (source of truth)
        const qtyN = Math.max(0, Number(ln.qty ?? 0));
        const unitPriceN = Math.max(0, Number(ln.unitPrice ?? 0));
        const rawLineTotalN = Number(ln.lineTotal ?? unitPriceN * qtyN) || 0;
        const lineTotalN = r2(rawLineTotalN);

        subtotal += lineTotalN;
        itemsCreate.push({
          productId: ln.productId,
          name: ln.name,
          // IMPORTANT: OrderItem fields are Decimal in schema
          qty: new Prisma.Decimal(qtyN),
          unitPrice: new Prisma.Decimal(r2(unitPriceN).toFixed(2)),
          lineTotal: new Prisma.Decimal(r2(lineTotalN).toFixed(2)),
          baseUnitPrice:
            ln.baseUnitPrice != null
              ? new Prisma.Decimal(r2(Number(ln.baseUnitPrice)).toFixed(2))
              : null,
          discountAmount:
            ln.discountAmount != null
              ? new Prisma.Decimal(r2(Number(ln.discountAmount)).toFixed(2))
              : null,
          unitKind: UnitKind.PACK,
          // Keep audit fields but do not recompute:
          allowedUnitPrice: new Prisma.Decimal(r2(unitPriceN).toFixed(2)),
          pricePolicy: "FROZEN:RUN_RECEIPT_LINE",
        });
      }
      subtotal = r2(subtotal);

      const isCredit = rec.isCredit || rec.cashCollected + 0.009 < subtotal;

      const newOrder = await tx.order.create({
        data: {
          channel: "DELIVERY",
          status: "UNPAID",
          paidAt: null,
          orderCode,
          // ✅ Link back to source receipt (trace/debug + deterministic mapping)
          originRunReceiptId: rec.roadReceiptId,
          printedAt: new Date(),
          expiryAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
          riderName,
          ...(rec.customerId ? { customerId: rec.customerId } : {}),
          isOnCredit: isCredit,
          ...(isCredit
            ? {
                releaseWithBalance: true,
                releasedApprovedBy: approverLabel,
                releasedAt: new Date(),
              }
            : {}),
          deliverTo: rec.customerId ? null : rec.customerName || null,
          deliverPhone: rec.customerId ? null : rec.customerPhone || null,
          subtotal,
          totalBeforeDiscount: subtotal,
          dispatchedAt: new Date(),
          deliveredAt: new Date(),
          items: { create: itemsCreate },
        },
        select: { id: true },
      });

      const receiptNo = await allocateReceiptNo(tx);
      await tx.order.update({
        where: { id: newOrder.id },
        data: { receiptNo },
      });

      await tx.deliveryRunOrder.create({
        data: { runId: id, orderId: newOrder.id },
      });
    }

    // Return products to stock based on rider CHECK-IN returns (not computed leftovers)
    const existingMoves = await tx.stockMovement.findMany({
      where: { refKind: "RUN", refId: id, type: "RETURN_IN" },
      select: { id: true },
      take: 1,
    });

    if (existingMoves.length === 0) {
      // Return only rows manager verified as physically present (unsold, not marked missing).
      for (const row of returnRows) {
        const pid = row.productId;
        const qty = Math.max(0, Number(row.qty || 0));
        if (qty <= 0) continue;
        await tx.product.update({
          where: { id: pid },
          data: { stock: { increment: qty } },
        });
        await tx.stockMovement.create({
          data: {
            type: "RETURN_IN",
            productId: pid,
            qty: new Prisma.Decimal(qty),
            refKind: "RUN",
            refId: id,
            notes: "Run remit return (manager verified unsold present)",
          },
        });
      }
    }

    if (isChargeIntent && missingRows.length > 0 && run.riderId) {
      const shortageNoteLines = missingRows.map((r) => {
        const sourceLabel =
          r.valueSource === "ROAD_FROZEN"
            ? "ROAD_FROZEN"
            : r.valueSource === "PARENT_FROZEN"
              ? "PARENT_FROZEN"
              : r.valueSource === "PRODUCT_SRP"
                ? "PRODUCT_SRP"
                : "PRODUCT_PRICE";
        return `${r.name} (#${r.productId}) qty ${r.unsold} x ${r2(r.unitValue || 0)} = ${r.amount} [${sourceLabel}]`;
      });
      const shortageNote = [
        "AUTO: remit stock shortage charge (manager verified missing unsold stocks).",
        ...shortageNoteLines,
      ].join(" | ");

      const variance = await tx.riderRunVariance.create({
        data: {
          runId: id,
          riderId: run.riderId,
          expected: new Prisma.Decimal(missingTotal.toFixed(2)),
          actual: new Prisma.Decimal("0.00"),
          variance: new Prisma.Decimal((-missingTotal).toFixed(2)),
          status: "MANAGER_APPROVED",
          resolution: "CHARGE_RIDER",
          managerApprovedAt: new Date(),
          managerApprovedById:
            managerApprovedById && managerApprovedById > 0
              ? managerApprovedById
              : null,
          note: shortageNote,
        },
        select: { id: true },
      });

      await tx.riderCharge.upsert({
        where: { varianceId: variance.id },
        create: {
          varianceId: variance.id,
          runId: id,
          riderId: run.riderId,
          amount: new Prisma.Decimal(missingTotal.toFixed(2)),
          status: RiderChargeStatus.OPEN,
          note: shortageNote,
          createdById:
            managerApprovedById && managerApprovedById > 0
              ? managerApprovedById
              : null,
        },
        update: {
          amount: new Prisma.Decimal(missingTotal.toFixed(2)),
          status: RiderChargeStatus.OPEN,
          note: shortageNote,
        },
      });
    }

    // Finally, CLOSE the run – dito nagiging CLOSED ang status
    // after ma-post lahat ng roadside orders + stock returns.
    await tx.deliveryRun.update({
      where: { id },
      data: {
        status: "CLOSED",
      },
    });
  });

  return redirect(`/runs/${id}/summary?posted=1`);
}

// ─────────────────────────────────────────
// React Page: overview + approve
// ─────────────────────────────────────────
export default function RunRemitPage() {
  const { run, stockVerificationRows, quickReceipts, parentOrders, totals } =
    useLoaderData<LoaderData>();
  const nav = useNavigation();
  const actionData = useActionData<ActionData>();
  const posted =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("posted") === "1"
      : false;

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const getFinancialBadge = (x: {
    pendingClearance?: number;
    rejectedUnresolved?: number;
    approvedDiscount?: number;
    ar?: number;
  }) => {
    const pendingClearance = r2(Math.max(0, Number(x.pendingClearance || 0)));
    const rejectedUnresolved = r2(Math.max(0, Number(x.rejectedUnresolved || 0)));
    const approvedDiscount = r2(Math.max(0, Number(x.approvedDiscount || 0)));
    const ar = r2(Math.max(0, Number(x.ar || 0)));

    if (pendingClearance > MONEY_EPS) {
      return {
        label: "Pending Clearance",
        className:
          "border-amber-200 bg-amber-50 text-amber-800",
      };
    }
    if (rejectedUnresolved > MONEY_EPS) {
      return {
        label: "Rejected (Unresolved)",
        className: "border-rose-200 bg-rose-50 text-rose-700",
      };
    }
    if (approvedDiscount > MONEY_EPS && ar > MONEY_EPS) {
      return {
        label: "Approved Hybrid",
        className: "border-indigo-200 bg-indigo-50 text-indigo-800",
      };
    }
    if (approvedDiscount > MONEY_EPS) {
      return {
        label: "Approved Discount",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }
    if (ar > MONEY_EPS) {
      return {
        label: "Approved Open Balance",
        className: "border-amber-200 bg-amber-50 text-amber-800",
      };
    }
    return {
      label: "Settled Cash",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  };

  const decisionLabel = (d: DecisionKindUI | null) =>
    d === "APPROVE_DISCOUNT_OVERRIDE"
      ? "APPROVE_DISCOUNT_OVERRIDE"
      : d === "APPROVE_HYBRID"
        ? "APPROVE_HYBRID"
        : d === "APPROVE_OPEN_BALANCE"
          ? "APPROVE_OPEN_BALANCE"
          : d === "REJECT"
            ? "REJECT"
            : null;

  const roadsideCashTotal = totals.roadsideCash;
  const parentCashTotal = totals.parentCash;
  const roadsideArTotal = totals.roadsideAR;
  const parentArTotal = totals.parentAR;
  const roadsideApprovedDiscountTotal = totals.roadsideApprovedDiscount;
  const parentApprovedDiscountTotal = totals.parentApprovedDiscount;
  const roadsideSystemDiscountTotal = totals.roadsideSystemDiscount;
  const parentSystemDiscountTotal = totals.parentSystemDiscount;
  const pendingClearanceTotal = totals.pendingClearance;
  const rejectedUnresolvedTotal = totals.rejectedUnresolved;

  const overallCashTotal = r2(roadsideCashTotal + parentCashTotal);
  const overallArTotal = r2(parentArTotal + roadsideArTotal);
  const overallApprovedDiscountTotal = r2(
    roadsideApprovedDiscountTotal + parentApprovedDiscountTotal,
  );
  const overallSystemDiscountTotal = r2(
    roadsideSystemDiscountTotal + parentSystemDiscountTotal,
  );

  const [stockDecision, setStockDecision] = React.useState<
    Record<number, "present" | "missing">
  >(() =>
    Object.fromEntries(
      stockVerificationRows
        .filter((r) => r.unsold > 0)
        .map((r) => [r.productId, "present" as const]),
    ),
  );

  const missingRowsPreview = stockVerificationRows
    .filter((r) => r.unsold > 0 && stockDecision[r.productId] === "missing")
    .map((r) => ({
      ...r,
      lineTotal:
        r.unitValue != null ? r2(Math.max(0, r.unsold) * r.unitValue) : null,
    }));

  const missingPreviewTotal = r2(
    missingRowsPreview.reduce((s, r) => s + Number(r.lineTotal || 0), 0),
  );
  const hasUnpricedMissing = missingRowsPreview.some((r) => r.unitValue == null);
  const canApproveNormal =
    run.status === "CHECKED_IN" &&
    nav.state === "idle" &&
    missingRowsPreview.length === 0;
  const canChargeMissing =
    run.status === "CHECKED_IN" &&
    nav.state === "idle" &&
    missingRowsPreview.length > 0 &&
    !hasUnpricedMissing;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl px-5 py-6">
        {/* Back links */}
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Link
              to="/store"
              className="text-sm text-indigo-600 hover:underline"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold tracking-wide text-slate-800">
                Run Remit — Manager Review
              </h1>
              <div className="mt-1 text-sm text-slate-600">
                Run{" "}
                <span className="font-mono font-medium text-indigo-700">
                  {run.runCode}
                </span>
                {run.riderLabel ? (
                  <span className="ml-2">• Rider: {run.riderLabel}</span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Quick-read remit report: stock verification, settled cash, A/R,
                approved discount, at system discount.
              </p>
            </div>
            {(() => {
              const badgeText =
                run.status === "CLOSED" ? "Closed" : posted ? "Posted" : null;
              return badgeText ? (
                <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                  {badgeText}
                </div>
              ) : null;
            })()}
          </div>

          {(pendingClearanceTotal > MONEY_EPS ||
            rejectedUnresolvedTotal > MONEY_EPS) && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {pendingClearanceTotal > MONEY_EPS ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Pending clearance unresolved:{" "}
                  <span className="font-mono font-semibold">
                    {peso(pendingClearanceTotal)}
                  </span>
                </div>
              ) : null}
              {rejectedUnresolvedTotal > MONEY_EPS ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Rejected unresolved amount:{" "}
                  <span className="font-mono font-semibold">
                    {peso(rejectedUnresolvedTotal)}
                  </span>
                </div>
              ) : null}
            </div>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] text-slate-500">Total Cash</div>
              <div className="mt-1 font-mono text-base font-semibold text-slate-900">
                {peso(overallCashTotal)}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-[11px] text-amber-800">Outstanding A/R</div>
              <div className="mt-1 font-mono text-base font-semibold text-amber-800">
                {peso(overallArTotal)}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div className="text-[11px] text-emerald-700">
                Approved Discount
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-emerald-700">
                {peso(overallApprovedDiscountTotal)}
              </div>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
              <div className="text-[11px] text-indigo-700">System Discount</div>
              <div className="mt-1 font-mono text-base font-semibold text-indigo-700">
                {peso(overallSystemDiscountTotal)}
              </div>
            </div>
          </div>
        </section>

        <Form method="post" className="grid gap-4">
          {/* Errors from action */}
          {actionData && !actionData.ok ? (
            <div
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 whitespace-pre-line"
              aria-live="polite"
            >
              {actionData.error}
            </div>
          ) : null}

          {/* Stock recap card */}
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-slate-800">
                  1. Stock Recap
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Manager verification ito ng unsold stocks: piliin kung{" "}
                  <span className="font-medium">Stocks Present</span> o{" "}
                  <span className="font-medium">Mark Missing</span> per item.
                </p>
              </div>
              <div className="text-[11px] text-slate-500">
                Missing items become rider charge candidate
              </div>
            </div>

            <div className="overflow-x-auto px-4 py-3">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Loaded</th>
                    <th className="px-3 py-2 text-right">Sold</th>
                    <th className="px-3 py-2 text-right">Unsold</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-left">Manager Check</th>
                  </tr>
                </thead>
                <tbody>
                  {stockVerificationRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-4 text-center text-slate-500"
                      >
                        No loadout snapshot or rider check-in data for this run.
                      </td>
                    </tr>
                  ) : (
                    stockVerificationRows.map((r) => {
                      const soldOnly = r.unsold <= 0.0001;
                      const decision = stockDecision[r.productId] ?? "present";
                      return (
                        <tr
                          key={r.productId}
                          className="border-t border-slate-100"
                        >
                          <td className="px-3 py-2">
                            {r.name}{" "}
                            <span className="text-[10px] text-slate-400">
                              #{r.productId}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{r.loaded}</td>
                          <td className="px-3 py-2 text-right">{r.sold}</td>
                          <td className="px-3 py-2 text-right">{r.unsold}</td>
                          <td className="px-3 py-2 text-center">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] ${
                                soldOnly
                                  ? "border border-slate-300 bg-slate-50 text-slate-700"
                                  : "border border-slate-300 bg-white text-slate-700"
                              }`}
                            >
                              {soldOnly ? "Sold" : "Unsold"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {soldOnly ? (
                              <span className="text-xs text-slate-500">
                                Sold / OK
                              </span>
                            ) : (
                              <div className="flex flex-wrap items-center gap-3">
                                <input
                                  type="hidden"
                                  name={`verify_${r.productId}`}
                                  value={decision}
                                />
                                <label className="inline-flex items-center gap-1 text-xs text-slate-700 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`verify_ui_${r.productId}`}
                                    checked={decision === "present"}
                                    onChange={() =>
                                      setStockDecision((prev) => ({
                                        ...prev,
                                        [r.productId]: "present",
                                      }))
                                    }
                                  />
                                  <span>Stocks Present</span>
                                </label>
                                <label className="inline-flex items-center gap-1 text-xs text-slate-700 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`verify_ui_${r.productId}`}
                                    checked={decision === "missing"}
                                    onChange={() =>
                                      setStockDecision((prev) => ({
                                        ...prev,
                                        [r.productId]: "missing",
                                      }))
                                    }
                                  />
                                  <span>Mark Missing</span>
                                </label>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
              <div className="font-semibold">
                Missing stock reminder ({missingRowsPreview.length} item
                {missingRowsPreview.length > 1 ? "s" : ""})
              </div>
              {missingRowsPreview.length > 0 ? (
                <>
                  <div className="mt-1 space-y-0.5">
                    {missingRowsPreview.map((r) => (
                      <div key={`missing-${r.productId}`}>
                        • {r.name} #{r.productId} · qty {r.unsold} ·{" "}
                        {r.lineTotal != null ? peso(r.lineTotal) : "No value source"}
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 font-semibold text-rose-700">
                    Total rider charge preview: {peso(missingPreviewTotal)}{" "}
                    {hasUnpricedMissing ? "(check value source)" : ""}
                  </div>
                </>
              ) : (
                <div className="mt-1 text-slate-500">
                  No missing items selected.
                </div>
              )}
            </div>
          </section>

          {/* Parent POS orders (from Order Pad / Cashier) */}
          {parentOrders.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium text-slate-800">
                    2. Parent Orders (from POS)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Mga order na na-post sa cashier / order pad at naka-link sa
                    run na ito. Read-only view ng qty at presyo per line.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1 text-right text-[11px] text-slate-600">
                  <div>
                    Cash:{" "}
                    <span className="font-mono font-semibold text-slate-900">
                      {peso(parentCashTotal)}
                    </span>
                  </div>
                  <div>
                    A/R:{" "}
                    <span className="font-mono font-semibold text-amber-800">
                      {peso(parentArTotal)}
                    </span>
                  </div>
                  <div>
                    Approved:{" "}
                    <span className="font-mono font-semibold text-emerald-700">
                      {peso(parentApprovedDiscountTotal)}
                    </span>
                  </div>
                  <div>
                    System:{" "}
                    <span className="font-mono font-semibold text-indigo-700">
                      {peso(parentSystemDiscountTotal)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="px-4 py-4 space-y-3">
                {parentOrders.map((o, idx) => {
                  const badge = getFinancialBadge({
                    pendingClearance: o.pendingClearance,
                    rejectedUnresolved: o.rejectedUnresolved,
                    approvedDiscount: o.approvedDiscount,
                    ar: o.ar,
                  });
                  const rawCash = Number(o.collectedCash ?? 0);
                  const cash = r2(Math.max(0, Math.min(o.orderTotal, rawCash)));

                  return (
                    <div
                      key={`${o.orderId}-${idx}`}
                      className="rounded-2xl border border-slate-200 bg-white p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium text-slate-700">
                          Order #{o.orderId}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {o.pricingMismatch ? (
                            <div className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">
                              Totals mismatch
                            </div>
                          ) : null}
                          <div
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${badge.className}`}
                          >
                            {badge.label}
                          </div>
                        </div>
                      </div>

                      <div className="mb-2 text-xs text-slate-600">
                        <span className="font-semibold">Customer:</span>{" "}
                        {o.customerLabel}
                        {o.decisionKind ? (
                          <span className="ml-2">
                            • Decision:{" "}
                            <span className="font-mono text-slate-700">
                              {decisionLabel(o.decisionKind)}
                            </span>
                          </span>
                        ) : null}
                      </div>

                      <div className="space-y-2 text-[11px] text-slate-600">
                        {o.lines.map((ln, li) => (
                          <div
                            key={`${o.orderId}-${li}`}
                            className="rounded-xl border border-slate-100 bg-slate-50/40 p-2"
                          >
                            <div className="mb-0.5">
                              <span className="font-semibold">Product:</span>{" "}
                              <span className="font-medium">{ln.name}</span>
                              {ln.productId != null && (
                                <span className="ml-1 text-[10px] text-slate-400">
                                  #{ln.productId}
                                </span>
                              )}
                            </div>
                            <div className="flex justify-between text-[11px] text-slate-600">
                              <span>
                                Qty:{" "}
                                <span className="font-mono font-semibold">
                                  {ln.qty}
                                </span>
                              </span>
                              <span>
                                Unit:{" "}
                                <span className="font-mono font-semibold text-slate-800">
                                  {peso(ln.unitPrice)}
                                </span>
                                {ln.discountAmount != null &&
                                  ln.baseUnitPrice != null &&
                                  ln.discountAmount > MONEY_EPS && (
                                    <span className="ml-1 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                      −{peso(ln.discountAmount)}
                                      <span className="ml-1 text-emerald-600/80">
                                        (Base {peso(ln.baseUnitPrice)})
                                      </span>
                                    </span>
                                  )}
                              </span>
                              <span>
                                Line total:{" "}
                                <span className="font-mono font-semibold">
                                  {peso(ln.lineTotal)}
                                </span>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-600">
                          Order total:{" "}
                          <span className="font-mono font-semibold text-slate-900">
                            {peso(o.orderTotal)}
                          </span>
                        </span>
                        <span className="text-slate-600">
                          Cash:{" "}
                          <span className="font-mono font-semibold text-slate-900">
                            {peso(cash)}
                          </span>
                        </span>
                        <span className="text-indigo-700">
                          System discount:{" "}
                          <span className="font-mono font-semibold">
                            {peso(o.systemDiscount)}
                          </span>
                        </span>
                        <div className="flex items-center gap-2">
                          {o.pendingClearance > MONEY_EPS ? (
                            <span className="text-amber-800">
                              Pending:{" "}
                              <span className="font-mono font-semibold">
                                {peso(o.pendingClearance)}
                              </span>
                            </span>
                          ) : null}
                          {o.rejectedUnresolved > MONEY_EPS ? (
                            <span className="text-rose-700">
                              Rejected unresolved:{" "}
                              <span className="font-mono font-semibold">
                                {peso(o.rejectedUnresolved)}
                              </span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Quick sales overview */}
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-slate-800">
                  {parentOrders.length > 0
                    ? "3. Roadside Sales (from Rider Check-in)"
                    : "2. Roadside Sales (from Rider Check-in)"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Read-only list mula sa rider check-in. Ito ang gagawing mga
                  barcode/receipt sa pag-post ng remit.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-1 text-right text-[11px] text-slate-600">
                <div>
                  Cash:{" "}
                  <span className="font-mono font-semibold text-slate-900">
                    {peso(roadsideCashTotal)}
                  </span>
                </div>
                <div>
                  A/R:{" "}
                  <span className="font-mono font-semibold text-amber-800">
                    {peso(roadsideArTotal)}
                  </span>
                </div>
                <div>
                  Approved:{" "}
                  <span className="font-mono font-semibold text-emerald-700">
                    {peso(roadsideApprovedDiscountTotal)}
                  </span>
                </div>
                <div>
                  System:{" "}
                  <span className="font-mono font-semibold text-indigo-700">
                    {peso(roadsideSystemDiscountTotal)}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-4 py-4 space-y-3">
              {(quickReceipts?.length ?? 0) === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center text-sm text-slate-500">
                  No roadside sales encoded in Rider Check-in.
                </div>
              ) : (
                quickReceipts.map((rec) => {
                  const badge = getFinancialBadge({
                    pendingClearance: rec.pendingClearance,
                    rejectedUnresolved: rec.rejectedUnresolved,
                    approvedDiscount: rec.approvedDiscount,
                    ar: rec.ar,
                  });
                  return (
                    <div
                      key={rec.key}
                      className="rounded-2xl border border-slate-200 bg-white p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium text-slate-700">
                          Receipt • {rec.customerLabel}
                        </div>
                        <div
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${badge.className}`}
                        >
                          {badge.label}
                        </div>
                      </div>

                      <div className="mb-2 text-xs text-slate-600">
                        {rec.decisionKind ? (
                          <>
                            Decision:{" "}
                            <span className="font-mono text-slate-700">
                              {decisionLabel(rec.decisionKind)}
                            </span>
                          </>
                        ) : (
                          <span className="text-slate-500">
                            Decision pending / auto A/R projection
                          </span>
                        )}
                      </div>

                      <div className="grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
                          <div>Receipt total</div>
                          <div className="font-mono font-semibold text-slate-900">
                            {peso(rec.total)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
                          <div>Cash</div>
                          <div className="font-mono font-semibold text-slate-900">
                            {peso(rec.cash)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                          <div className="text-emerald-700">Approved discount</div>
                          <div className="font-mono font-semibold text-emerald-700">
                            {peso(rec.approvedDiscount)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-1.5">
                          <div className="text-amber-800">A/R</div>
                          <div className="font-mono font-semibold text-amber-800">
                            {peso(rec.ar)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="text-indigo-700">
                          System discount:{" "}
                          <span className="font-mono font-semibold">
                            {peso(rec.systemDiscount)}
                          </span>
                        </span>
                        <div className="flex items-center gap-2">
                          {rec.pendingClearance > MONEY_EPS ? (
                            <span className="text-amber-800">
                              Pending:{" "}
                              <span className="font-mono font-semibold">
                                {peso(rec.pendingClearance)}
                              </span>
                            </span>
                          ) : null}
                          {rec.rejectedUnresolved > MONEY_EPS ? (
                            <span className="text-rose-700">
                              Rejected unresolved:{" "}
                              <span className="font-mono font-semibold">
                                {peso(rec.rejectedUnresolved)}
                              </span>
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-2 space-y-2 text-xs text-slate-600">
                        {rec.rows.map((q) => (
                          <div
                            key={`${rec.key}-${q.idx}`}
                            className="rounded-xl border border-slate-100 bg-slate-50/40 p-2"
                          >
                            <div className="mb-0.5">
                              <span className="font-semibold">Product:</span>{" "}
                              {q.productName}{" "}
                              {q.productId != null && (
                                <span className="text-[10px] text-slate-400">
                                  #{q.productId}
                                </span>
                              )}
                            </div>
                            <div className="flex justify-between text-[11px] text-slate-600">
                              <span>
                                Qty:{" "}
                                <span className="font-mono font-semibold">
                                  {q.qty}
                                </span>
                              </span>
                              <span>
                                Unit:{" "}
                                <span className="font-mono font-semibold text-slate-800">
                                  {peso(q.unitPrice)}
                                </span>
                                {q.discountAmount != null &&
                                  q.baseUnitPrice != null &&
                                  q.discountAmount > MONEY_EPS && (
                                    <span className="ml-1 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                      −{peso(q.discountAmount)}
                                      <span className="ml-1 text-emerald-600/80">
                                        (Base {peso(q.baseUnitPrice)})
                                      </span>
                                    </span>
                                  )}
                              </span>
                              <span>
                                Line:{" "}
                                <span className="font-mono font-semibold">
                                  {peso(q.lineTotal)}
                                </span>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Submit / Approve */}
          <div className="sticky bottom-4 flex flex-col gap-2">
            <button
              type="submit"
              name="_intent"
              value="charge-remit"
              className="inline-flex w-full items-center justify-center rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
              disabled={!canChargeMissing}
              onClick={(e) => {
                if (
                  !window.confirm(
                    "Proceed to charge rider for all items marked as missing and close this run?",
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              {hasUnpricedMissing
                ? "Cannot charge: missing value source for some items"
                : nav.state !== "idle"
                  ? "Posting…"
                  : "Charge Rider (Missing Stocks) & Close Run"}
            </button>
            <button
              type="submit"
              name="_intent"
              value="post-remit"
              className="inline-flex w-full items-center justify-center rounded-xl bg-slate-800 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-900 disabled:opacity-50"
              disabled={!canApproveNormal}
            >
              {run.status === "CLOSED"
                ? "Run already closed"
                : nav.state !== "idle"
                  ? "Posting…"
                  : missingRowsPreview.length > 0
                    ? "Use charge action for missing stocks"
                    : "Approve Remit & Close Run"}
            </button>
          </div>
        </Form>
      </div>
    </main>
  );
}
