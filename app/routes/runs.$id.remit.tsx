// app/routes/runs.$id.remit.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { db } from "~/utils/db.server";
import { UnitKind } from "@prisma/client";
import { computeUnitPriceForCustomer } from "~/services/pricing";
import { allocateReceiptNo } from "~/utils/receipt";

import { requireRole } from "~/utils/auth.server";
import {
  applyDiscounts,
  fetchActiveCustomerRules,
  buildCartFromOrderItems,
  type Cart,
  type Rule,
} from "~/services/pricing";

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
};

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: "PLANNED" | "DISPATCHED" | "CHECKED_IN" | "CLOSED" | "CANCELLED";
    riderLabel: string | null;
  };
  recapRows: RecapRow[];
  quickSales: QuickSaleRow[];
  hasDiffIssues: boolean;
  parentOrders: ParentOrderRow[];
};

type ActionData =
  | { ok: true }
  | {
      ok: false;
      error: string;
    };

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

  // 1) Loaded from snapshot
  const loadout: Array<{ productId: number; name: string; qty: number }> =
    Array.isArray(run.loadoutSnapshot)
      ? (run.loadoutSnapshot as any[])
          .map((l) => ({
            productId: Number(l?.productId),
            name: String(l?.name ?? ""),
            qty: Math.max(0, Math.floor(Number(l?.qty ?? 0))),
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

  // 2) Rider check-in snapshot: stockRows + soldRows + parentOverrides
  const rawSnap = run.riderCheckinSnapshot as any;

  // Parent AR/Cash overrides saved during Rider Check-in
  const parentOverrideMap = new Map<number, boolean>();
  if (
    rawSnap &&
    typeof rawSnap === "object" &&
    Array.isArray((rawSnap as any).parentOverrides)
  ) {
    for (const row of (rawSnap as any).parentOverrides as any[]) {
      const oid = Number(row?.orderId ?? 0);
      if (!oid) continue;
      parentOverrideMap.set(oid, !!row?.isCredit);
    }
  }

  let stockRows: Array<{ productId: number; returned: number }> = [];
  let soldRowsRaw: any[] = [];

  if (rawSnap && typeof rawSnap === "object") {
    if (Array.isArray(rawSnap.stockRows)) {
      stockRows = (rawSnap.stockRows as any[]).map((r) => ({
        productId: Number(r?.productId ?? 0),
        returned: Math.max(0, Number(r?.returned ?? 0)),
      }));
    } else if (Array.isArray(rawSnap)) {
      // legacy: array of { productId, sold, returned }
      stockRows = (rawSnap as any[]).map((r) => ({
        productId: Number(r?.productId ?? 0),
        returned: Math.max(0, Number(r?.returned ?? 0)),
      }));
    }

    if (Array.isArray(rawSnap.soldRows)) {
      soldRowsRaw = rawSnap.soldRows as any[];
    }
  }

  // Normalize snapshot returns only (ignore invalid pid)
  const returnedByPid = new Map<number, number>();
  for (const r of stockRows) {
    const pid = Number(r.productId);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const returned = Math.max(0, Number(r.returned ?? 0));
    returnedByPid.set(pid, (returnedByPid.get(pid) || 0) + returned);
  }

  // 3) Quick roadside sales list for manager overview
  //    Also build roadsideSoldByPid for recap.
  const roadsideSoldByPid = new Map<number, number>();
  const quickSales: QuickSaleRow[] = soldRowsRaw
    .map((r, idx) => {
      const pid =
        r?.productId == null || Number.isNaN(Number(r.productId))
          ? null
          : Number(r.productId);
      const qty = Math.max(0, Number(r?.qty ?? 0));
      const unitPrice = Math.max(0, Number(r?.unitPrice ?? 0));
      const customerId =
        r?.customerId == null || Number.isNaN(Number(r.customerId))
          ? null
          : Number(r.customerId);
      const flagIsCredit = !!(r?.onCredit ?? r?.isCredit);

      const lineTotal = Number((qty * unitPrice).toFixed(2));

      // cashAmount from snapshot (optional)
      const rawCash =
        r?.cashAmount != null && !Number.isNaN(Number(r.cashAmount))
          ? Number(r.cashAmount)
          : NaN;

      const defaultCash = flagIsCredit ? 0 : lineTotal;
      let cashAmount = Number.isFinite(rawCash) ? rawCash : defaultCash;
      cashAmount = Math.max(0, Math.min(lineTotal, cashAmount));

      const creditAmount = Number(
        Math.max(0, lineTotal - cashAmount).toFixed(2)
      );
      const isCredit = creditAmount > 0.009;

      if (pid != null) {
        roadsideSoldByPid.set(pid, (roadsideSoldByPid.get(pid) || 0) + qty);
      }
      const productName =
        typeof r?.name === "string" && r.name.trim()
          ? r.name
          : pid != null
          ? `#${pid}`
          : "Unknown";

      const snapName =
        typeof r?.customerName === "string" && r.customerName.trim()
          ? r.customerName.trim()
          : null;
      const snapPhone =
        typeof r?.customerPhone === "string" && r.customerPhone.trim()
          ? r.customerPhone.trim()
          : null;

      let customerLabel = snapName || "";
      if (!customerLabel && customerId) {
        customerLabel = `Customer #${customerId}`;
      }
      if (!customerLabel) customerLabel = "Walk-in / Unknown";

      if (snapPhone) {
        customerLabel += ` • ${snapPhone}`;
      }

      return {
        idx,
        productId: pid,
        productName,
        qty,
        unitPrice,
        lineTotal,
        customerId,
        customerLabel,
        isCredit,
        cashAmount,
        creditAmount,
      } as QuickSaleRow;
    })
    .filter((r) => r.qty > 0 && (r.productId != null || r.productName !== ""));

  // Kailangan din natin ang productIds ng roadside para sa base price lookup
  const roadsideProductIds = Array.from(
    new Set(
      quickSales
        .map((q) => q.productId)
        .filter((pid): pid is number => pid != null)
    )
  );

  // 4) Main SOLD from already-linked delivery orders (non-roadside)
  const links = await db.deliveryRunOrder.findMany({
    where: { runId: id },
    include: {
      order: {
        select: {
          id: true,
          isOnCredit: true,
          customerId: true,
          customer: {
            select: {
              alias: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
          items: {
            select: {
              id: true, // 🔴 kailangan natin ito para ma-map sa pricing engine
              productId: true,
              qty: true,
              name: true,
              unitPrice: true,
            },
          },
        },
      },
    },
  });

  // ────────────────────────────────────────────────
  // Base prices (SRP/price) per product para sa discount badge
  // ────────────────────────────────────────────────
  const parentProductIds = Array.from(
    new Set(
      links.flatMap((L) =>
        (L.order?.items || [])
          .map((it) => Number(it.productId ?? 0))
          .filter((pid) => Number.isFinite(pid) && pid > 0)
      )
    )
  );

  const allBasePids = Array.from(
    new Set([...parentProductIds, ...roadsideProductIds])
  );
  const baseProducts = allBasePids.length
    ? await db.product.findMany({
        where: { id: { in: allBasePids } },
        select: { id: true, price: true, srp: true },
      })
    : [];
  const basePriceIndex = new Map<number, number>();
  for (const p of baseProducts) {
    const rawBase = Number(p.srp ?? p.price ?? 0);
    const base =
      Number.isFinite(rawBase) && rawBase > 0
        ? rawBase
        : Number(p.price ?? 0) || 0;
    basePriceIndex.set(p.id, base);
  }

  // Apply baseUnitPrice/discountAmount sa quickSales
  const quickSalesWithDiscount: QuickSaleRow[] = quickSales.map((q) => {
    const base =
      q.productId != null
        ? basePriceIndex.get(q.productId) ?? q.unitPrice
        : q.unitPrice;
    const discount = Math.max(0, Number((base - q.unitPrice).toFixed(2)));
    return {
      ...q,
      baseUnitPrice: base,
      discountAmount: discount > 0.01 ? discount : undefined,
    };
  });

  // ────────────────────────────────────────────────
  // Pricing engine for parent POS orders (display)
  // ────────────────────────────────────────────────
  const parentPricingByOrderId = new Map<
    number,
    { unitPriceByItemId: Map<number, number>; orderTotal: number }
  >();

  for (const L of links) {
    const o = L.order;
    if (!o || !o.items || o.items.length === 0) continue;

    const customerId = o.customerId ?? null;
    const rules: Rule[] = await fetchActiveCustomerRules(db, customerId);

    const unitPriceByItemId = new Map<number, number>();

    // fallback total: raw POS price (qty * unitPrice)
    const fallbackTotal = o.items.reduce((sum, it: any) => {
      const qty = Number(it.qty ?? 0);
      const up = Number(it.unitPrice ?? 0);
      if (!Number.isFinite(qty) || !Number.isFinite(up)) return sum;
      return sum + qty * up;
    }, 0);

    if (!rules.length) {
      parentPricingByOrderId.set(o.id, {
        unitPriceByItemId,
        orderTotal: fallbackTotal,
      });
      continue;
    }

    const cart: Cart = buildCartFromOrderItems({
      items: o.items as any,
      rules,
    });

    const pricing = applyDiscounts(cart, rules, { id: customerId });

    for (const adj of pricing.adjustedItems || []) {
      if (adj.id == null || !Number.isFinite(adj.effectiveUnitPrice)) continue;
      unitPriceByItemId.set(adj.id as number, adj.effectiveUnitPrice);
    }

    const orderTotal =
      (Number.isFinite(pricing.total ?? NaN)
        ? (pricing.total as number)
        : fallbackTotal) || 0;

    parentPricingByOrderId.set(o.id, {
      unitPriceByItemId,
      orderTotal,
    });
  }

  const mainSoldByPid = new Map<number, number>();
  const mainSoldNameByPid = new Map<number, string>();
  const parentOrders: ParentOrderRow[] = [];

  for (const L of links) {
    const o = L.order;
    if (!o) continue;

    // Tally main SOLD by product (for recap)
    for (const it of o.items || []) {
      const pid = Number(it.productId ?? 0);
      if (!pid) continue;
      const qty = Math.max(0, Number(it.qty ?? 0));
      mainSoldByPid.set(pid, (mainSoldByPid.get(pid) || 0) + qty);

      // Pangalan galing sa POS item name
      if (!mainSoldNameByPid.has(pid) && it.name) {
        mainSoldNameByPid.set(pid, it.name);
      }
    }

    if (!o.items || o.items.length === 0) continue;

    // Build customer label
    const c = o.customer;
    let customerLabel = "";
    if (c) {
      customerLabel =
        (c.alias && c.alias.trim()) ||
        [c.firstName, c.lastName].filter(Boolean).join(" ");
    }
    if (!customerLabel && o.customerId) {
      customerLabel = `Customer #${o.customerId}`;
    }
    if (!customerLabel) customerLabel = "Walk-in / Unknown";

    // Effective AR/Cash status:
    // kung may snapshot override, yun ang sundin; else original POS isOnCredit
    const override = parentOverrideMap.get(o.id);
    const isCredit = override !== undefined ? override : !!o.isOnCredit;

    const priceInfo = parentPricingByOrderId.get(o.id);
    const lines: ParentOrderLine[] = (o.items || []).map((it: any) => {
      const pid =
        it.productId == null || Number.isNaN(Number(it.productId))
          ? null
          : Number(it.productId);
      const qty = Math.max(0, Number(it.qty ?? 0));
      // Base unit price = SRP kung meron, else product.price, fallback sa raw POS unitPrice
      const baseUnit =
        pid != null ? basePriceIndex.get(pid) ?? 0 : Number(it.unitPrice ?? 0);

      // customer-specific unit price kung meron sa pricing engine;
      // else fallback sa raw unitPrice from POS
      const effectiveUnit =
        priceInfo?.unitPriceByItemId.get(it.id) ??
        Math.max(0, Number(it.unitPrice ?? 0));

      const discountAmount = Math.max(
        0,
        Number((baseUnit - effectiveUnit).toFixed(2))
      );

      const lineTotal = Number((qty * effectiveUnit).toFixed(2));
      return {
        productId: pid,
        name: it.name ?? "",
        qty,
        unitPrice: effectiveUnit,
        baseUnitPrice: baseUnit || undefined,
        discountAmount: discountAmount > 0.01 ? discountAmount : undefined,
        lineTotal,
      };
    });

    const orderTotal =
      priceInfo?.orderTotal ?? lines.reduce((s, ln) => s + ln.lineTotal, 0);
    parentOrders.push({
      orderId: o.id,
      isCredit,
      customerLabel,
      lines,
      orderTotal,
    });
  }
  // 5) Build recap rows using:
  //    loaded (snapshot) vs sold(main + roadside) vs returned(snapshot)
  const allPids = new Set<number>([
    ...loadedByPid.keys(),
    ...returnedByPid.keys(),
    ...mainSoldByPid.keys(),
    ...roadsideSoldByPid.keys(),
  ]);

  const recapRows: RecapRow[] = Array.from(allPids).map((pid) => {
    const loadedEntry = loadedByPid.get(pid);

    // Source of truth: loadout snapshot kung meron.
    // Kung wala, assume at least yung parent POS qty was actually loaded.
    const loaded =
      loadedEntry !== undefined ? loadedEntry.qty : mainSoldByPid.get(pid) ?? 0;

    const sold =
      (mainSoldByPid.get(pid) || 0) + (roadsideSoldByPid.get(pid) || 0);
    const returned = returnedByPid.get(pid) || 0;
    const diff = loaded - sold - returned;

    const name =
      loadedEntry?.name ??
      mainSoldNameByPid.get(pid) ??
      // fallback: no name in loadout or POS items
      `#${pid}`;

    return { productId: pid, name, loaded, sold, returned, diff };
  });

  const hasDiffIssues = recapRows.some((r) => r.diff !== 0);

  return json<LoaderData>({
    run: {
      id: run.id,
      runCode: run.runCode,
      status: run.status as any,
      riderLabel,
    },
    recapRows,
    quickSales: quickSalesWithDiscount,
    hasDiffIssues,
    parentOrders,
  });
}

// ─────────────────────────────────────────
// Action: use snapshot only; manager just approves
// ─────────────────────────────────────────
export async function action({ request, params }: ActionFunctionArgs) {
  // 🔒 Extra guard: only MANAGER / ADMIN can post remit / revert
  await requireRole(request, ["STORE_MANAGER", "ADMIN"]);
  const id = Number(params.id);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "post-remit");
  if (!Number.isFinite(id)) {
    return json<ActionData>(
      { ok: false, error: "Invalid ID" },
      { status: 400 }
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

  // ─────────────────────────────────────
  // INTENT: Revert back to DISPATCHED
  // ─────────────────────────────────────
  if (intent === "revert-to-dispatched") {
    if (run.status !== "CHECKED_IN") {
      return json<ActionData>(
        { ok: false, error: "Only CHECKED_IN runs can be reverted." },
        { status: 400 }
      );
    }

    await db.deliveryRun.update({
      where: { id },
      data: {
        status: "DISPATCHED",
      },
    });

    // balik kay rider para ma-edit niya ulit ang check-in
    return redirect(`/runs/${id}/rider-checkin?reverted=1`);
  }

  // ─────────────────────────────────────
  // INTENT: Post remit & close run
  // ─────────────────────────────────────

  // Dito lang pwede mag-remit kapag CHECKED_IN na si rider.
  if (run.status !== "CHECKED_IN") {
    return json<ActionData>(
      { ok: false, error: "Run must be CHECKED_IN before remit." },
      { status: 400 }
    );
  }

  // Derive loadout (what was loaded)
  const loadout: Array<{ productId: number; name: string; qty: number }> =
    Array.isArray(run.loadoutSnapshot)
      ? (run.loadoutSnapshot as any[])
          .map((l) => ({
            productId: Number(l?.productId),
            name: String(l?.name ?? ""),
            qty: Math.max(0, Math.floor(Number(l?.qty ?? 0))),
          }))
          .filter(
            (l) => Number.isFinite(l.productId) && l.productId > 0 && l.qty > 0
          )
      : [];

  const loadedByPid = new Map<number, number>();
  for (const l of loadout) {
    loadedByPid.set(l.productId, (loadedByPid.get(l.productId) || 0) + l.qty);
  }

  // Pull soldRows from rider check-in snapshot
  const rawSnap = run.riderCheckinSnapshot as any;
  let soldRowsRaw: any[] = [];
  if (
    rawSnap &&
    typeof rawSnap === "object" &&
    Array.isArray(rawSnap.soldRows)
  ) {
    soldRowsRaw = rawSnap.soldRows as any[];
  }

  type SoldRow = {
    productId: number;
    name: string;
    qty: number;
    unitPrice: number;
    customerId: number | null;
    onCredit: boolean;
    cashAmount: number | null;
    customerName?: string | null;
    customerPhone?: string | null;
  };

  const soldRows: SoldRow[] = soldRowsRaw
    .map((r) => {
      const pid =
        r?.productId == null || Number.isNaN(Number(r.productId))
          ? null
          : Number(r.productId);
      const qty = Math.max(0, Math.floor(Number(r?.qty ?? 0)));
      const unitPrice = Math.max(0, Number(r?.unitPrice ?? 0));
      const customerId =
        r?.customerId == null || Number.isNaN(Number(r.customerId))
          ? null
          : Number(r.customerId);
      const flagIsCredit = !!(r?.onCredit ?? r?.isCredit);

      const snapshotTotal = Number((qty * unitPrice).toFixed(2));
      const rawCash =
        r?.cashAmount != null && !Number.isNaN(Number(r.cashAmount))
          ? Number(r.cashAmount)
          : NaN;
      const defaultCash = flagIsCredit ? 0 : snapshotTotal;
      let cashAmount = Number.isFinite(rawCash) ? rawCash : defaultCash;
      cashAmount = Math.max(0, Math.min(snapshotTotal, cashAmount));

      const hasCredit = cashAmount + 0.009 < snapshotTotal;

      return {
        productId: pid as number | null,
        name: typeof r?.name === "string" ? r.name : "",
        qty,
        unitPrice,
        customerId,
        onCredit: hasCredit,
        cashAmount,
        customerName:
          (typeof r?.customerName === "string" ? r.customerName.trim() : "") ||
          null,
        customerPhone:
          (typeof r?.customerPhone === "string"
            ? r.customerPhone.trim()
            : "") || null,
      };
    })
    .filter((r) => r.qty > 0 && r.productId != null) as SoldRow[];

  // If walang soldRows, okay lang — magre-return lang tayo ng full leftover
  // sum sold per product
  const soldByPid = new Map<number, number>();
  for (const r of soldRows) {
    soldByPid.set(r.productId, (soldByPid.get(r.productId) || 0) + r.qty);
  }

  // Guard: sold ≤ loaded
  const over: string[] = [];
  for (const [pid, soldQ] of soldByPid.entries()) {
    const loadedQ = loadedByPid.get(pid) || 0;
    if (soldQ > loadedQ) {
      over.push(`• Product #${pid}: sold ${soldQ} > loaded ${loadedQ}`);
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
      { status: 400 }
    );
  }

  // Price guard for remit:
  // - Hindi na mag-e-enforce ng "below allowed price" dito.
  // - Simple rule lang: kung naka-credit, kailangan may customer.
  const pids = Array.from(new Set(soldRows.map((r) => r.productId)));
  const products = pids.length
    ? await db.product.findMany({
        where: { id: { in: pids } },
        select: { id: true, price: true, srp: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  for (const r of soldRows) {
    if (r.onCredit && !r.customerId) {
      return json<ActionData>(
        { ok: false, error: "On-credit sale requires a customer." },
        { status: 400 }
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

  await db.$transaction(async (tx) => {
    // Create roadside orders from soldRows
    for (const r of soldRows) {
      const p = byId.get(r.productId)!;
      const basePack = Number(p.srp ?? p.price ?? 0);
      const allowed = await computeUnitPriceForCustomer(tx as any, {
        customerId: r.customerId ?? null,
        productId: r.productId,
        unitKind: UnitKind.PACK,
        baseUnitPrice: basePack,
      });

      const approx = (a: number, b: number, eps = 0.009) =>
        Math.abs(a - b) <= eps;
      const autoUseAllowed =
        !!r.customerId && (r.unitPrice <= 0 || approx(r.unitPrice, basePack));
      const unitPrice = autoUseAllowed ? allowed : r.unitPrice;
      const lineTotal = Number((unitPrice * r.qty).toFixed(2));

      // Actual cash on hand for this line
      const snapshotPaid =
        r.cashAmount != null
          ? Number(r.cashAmount)
          : r.onCredit
          ? 0
          : lineTotal;
      const paid = Math.max(
        0,
        Math.min(lineTotal, Number.isFinite(snapshotPaid) ? snapshotPaid : 0)
      );
      const hasCredit = paid + 0.009 < lineTotal;

      const code =
        `RS-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-` +
        crypto.randomUUID().slice(0, 6).toUpperCase();

      const isCredit = hasCredit;

      const newOrder = await tx.order.create({
        data: {
          channel: "DELIVERY",
          // Remit stage: lahat ng roadside orders papasok bilang UNPAID.
          // Si cashier lang ang puwedeng mag-mark ng PAID / PARTIALLY_PAID
          // sa cashier screen via payments.
          status: "UNPAID",
          paidAt: null,
          orderCode: code,
          printedAt: new Date(),
          expiryAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
          riderName,
          ...(r.customerId ? { customerId: r.customerId } : {}),
          isOnCredit: isCredit,
          // If may customer, hindi na need deliverTo; else may imprint from rider
          deliverTo: r.customerId ? null : r.customerName || null,
          deliverPhone: r.customerId ? null : r.customerPhone || null,
          subtotal: lineTotal,
          totalBeforeDiscount: lineTotal,
          dispatchedAt: new Date(),
          deliveredAt: new Date(),
          items: {
            create: [
              {
                productId: r.productId,
                name: r.name,
                qty: r.qty,
                unitPrice,
                lineTotal,
                unitKind: UnitKind.PACK,
                allowedUnitPrice: allowed,
                pricePolicy:
                  Math.abs(allowed - basePack) <= 0.009 ? "BASE" : "PER_ITEM",
              },
            ],
          },
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

    // Return leftovers to stock
    const soldMap = new Map<number, number>();
    for (const r of soldRows) {
      soldMap.set(r.productId, (soldMap.get(r.productId) || 0) + r.qty);
    }

    for (const l of loadout) {
      const sold = soldMap.get(l.productId) || 0;
      const leftover = Math.max(0, l.qty - sold);
      if (leftover > 0) {
        await tx.product.update({
          where: { id: l.productId },
          data: { stock: { increment: leftover } },
        });
        await tx.stockMovement.create({
          data: {
            type: "RETURN_IN",
            productId: l.productId,
            qty: leftover,
            refKind: "RUN",
            refId: id,
            notes: "Run remit return",
          },
        });
      }
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
  const { run, recapRows, quickSales, hasDiffIssues, parentOrders } =
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

  const totalCash = quickSales.reduce((s, q) => s + (q.cashAmount ?? 0), 0);
  const totalCredit = quickSales.reduce(
    (s, q) => s + (q.creditAmount ?? (q.isCredit ? q.lineTotal : 0)),
    0
  );

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
        {/* Header */}
        <div className="mb-2 flex items-end justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-800">
              Run Remit — Manager Review
            </h1>
            <div className="mt-1 text-sm text-slate-500">
              Run{" "}
              <span className="font-mono font-medium text-indigo-700">
                {run.runCode}
              </span>
              {run.riderLabel ? (
                <span className="ml-2">• Rider: {run.riderLabel}</span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Overview lang ito: check kung tama ang{" "}
              <span className="font-medium">Loaded / Sold / Returned</span> at
              listahan ng roadside sales bago i-approve.
            </p>
          </div>

          {(() => {
            const badgeText =
              run.status === "CLOSED" ? "Closed" : posted ? "Posted" : null;
            return badgeText ? (
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                {badgeText}
              </div>
            ) : null;
          })()}
        </div>

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
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-slate-800">
                  1. Stock Recap
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Auto-compute ng{" "}
                  <span className="font-medium">
                    Loaded vs Sold vs Returned
                  </span>{" "}
                  per product. Dapat{" "}
                  <span className="font-mono">Loaded = Sold + Returned</span>.
                </p>
              </div>
              {hasDiffIssues && (
                <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  May mga product na hindi nagtutugma ang Loaded vs Sold vs
                  Returned. Gamitin muna ang{" "}
                  <span className="font-semibold">“Revert to Dispatched”</span>{" "}
                  sa ibaba para ma-edit ulit ng rider ang Check-in bago
                  mag-approve ng remit.
                </div>
              )}
            </div>

            <div className="overflow-x-auto px-4 py-3">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-right">Loaded</th>
                    <th className="px-3 py-2 text-right">Sold</th>
                    <th className="px-3 py-2 text-right">Returned</th>
                    <th className="px-3 py-2 text-right">
                      Loaded − Sold − Ret
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recapRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-4 text-center text-slate-500"
                      >
                        No loadout snapshot or rider check-in data for this run.
                      </td>
                    </tr>
                  ) : (
                    recapRows.map((r) => {
                      const bad = r.diff !== 0;
                      return (
                        <tr
                          key={r.productId}
                          className={`border-t border-slate-100 ${
                            bad ? "bg-amber-50/70" : ""
                          }`}
                        >
                          <td className="px-3 py-2">
                            {r.name}{" "}
                            <span className="text-[10px] text-slate-400">
                              #{r.productId}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{r.loaded}</td>
                          <td className="px-3 py-2 text-right">{r.sold}</td>
                          <td className="px-3 py-2 text-right">{r.returned}</td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              bad ? "text-amber-700 font-semibold" : ""
                            }`}
                          >
                            {r.diff}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {hasDiffIssues && (
              <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                May mga product na hindi nagtutugma ang Loaded vs Sold vs
                Returned. Paki-open muna ang{" "}
                <span className="font-semibold">Rider Check-in</span> page para
                i-correct bago mag-approve ng remit.
              </div>
            )}
          </section>

          {/* Parent POS orders (from Order Pad / Cashier) */}
          {parentOrders.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
              </div>

              <div className="px-4 py-4 space-y-3">
                {parentOrders.map((o, idx) => (
                  <div
                    key={`${o.orderId}-${idx}`}
                    className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-medium text-slate-700">
                        Order #{o.orderId}
                      </div>
                      <div
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          o.isCredit
                            ? "border border-amber-200 bg-amber-50 text-amber-700"
                            : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {o.isCredit ? "Credit (A/R)" : "Cash"}
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 mb-1">
                      <span className="font-semibold">Customer:</span>{" "}
                      {o.customerLabel}
                    </div>

                    <div className="space-y-1 text-[11px] text-slate-600">
                      {o.lines.map((ln, li) => (
                        <div
                          key={`${o.orderId}-${li}`}
                          className="flex justify-between gap-2"
                        >
                          <div className="flex-1">
                            <span className="font-medium">{ln.name}</span>
                            {ln.productId != null && (
                              <span className="ml-1 text-[10px] text-slate-400">
                                #{ln.productId}
                              </span>
                            )}
                          </div>
                          <div className="text-right font-mono">
                            <div>Qty: {ln.qty}</div>
                            <div>
                              Price: {peso(ln.unitPrice)}
                              {ln.discountAmount != null && (
                                <span className="ml-1 inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  −{peso(ln.discountAmount)}
                                </span>
                              )}
                            </div>
                            <div className="font-semibold">
                              Total: {peso(ln.lineTotal)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-1 text-right text-[11px] text-slate-500">
                      Order total:{" "}
                      <span className="font-mono font-semibold">
                        {peso(o.orderTotal)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Quick sales overview */}
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
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
              <div className="text-right text-xs text-slate-600">
                <div>
                  Cash total:{" "}
                  <span className="font-semibold text-slate-900">
                    {peso(totalCash)}
                  </span>
                </div>
                <div>
                  Credit (A/R):{" "}
                  <span className="font-semibold text-slate-900">
                    {peso(totalCredit)}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-4 py-4 space-y-3">
              {quickSales.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center text-sm text-slate-500">
                  No roadside sales encoded in Rider Check-in.
                </div>
              ) : (
                quickSales.map((q) => (
                  <div
                    key={q.idx}
                    className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-medium text-slate-700">
                        Sale #{q.idx + 1}
                      </div>
                      <div
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          q.isCredit
                            ? "border border-amber-200 bg-amber-50 text-amber-700"
                            : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {q.isCredit ? "Credit (A/R)" : "Cash"}
                      </div>
                    </div>
                    <div className="text-xs text-slate-600">
                      <div className="mb-0.5">
                        <span className="font-semibold">Customer:</span>{" "}
                        {q.customerLabel}
                      </div>
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
                          Unit price:{" "}
                          <span className="font-mono">{peso(q.unitPrice)}</span>
                          {q.discountAmount != null && (
                            <span className="ml-1 inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                              −{peso(q.discountAmount)}
                            </span>
                          )}
                        </span>
                        <span>
                          Line total:{" "}
                          <span className="font-mono font-semibold">
                            {peso(q.lineTotal)}
                          </span>
                        </span>
                      </div>
                      <div className="mt-0.5 flex justify-between text-[11px] text-slate-600">
                        <span>
                          Cash:{" "}
                          <span className="font-mono font-semibold">
                            {peso(q.cashAmount)}
                          </span>
                        </span>
                        <span>
                          Credit (A/R):{" "}
                          <span className="font-mono font-semibold">
                            {peso(q.creditAmount)}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Submit / Approve */}
          <div className="sticky bottom-4 flex flex-col gap-2">
            {/* Revert button – allow manager to send back to rider */}
            {run.status === "CHECKED_IN" && (
              <button
                type="submit"
                name="_intent"
                value="revert-to-dispatched"
                className="inline-flex w-full items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:opacity-50"
                disabled={nav.state !== "idle"}
              >
                ⤺ Revert to Dispatched (allow rider to edit Check-in)
              </button>
            )}
            <button
              type="submit"
              name="_intent"
              value="post-remit"
              className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              disabled={
                nav.state !== "idle" ||
                run.status !== "CHECKED_IN" ||
                hasDiffIssues
              }
            >
              {hasDiffIssues
                ? "Cannot post: fix mismatches in Rider Check-in first"
                : run.status === "CLOSED"
                ? "Run already closed"
                : nav.state !== "idle"
                ? "Posting…"
                : "Approve Remit & Close Run"}
            </button>
          </div>
        </Form>
      </div>
    </main>
  );
}
