// app/routes/runs.$id.rider-checkin.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  useFetcher,
} from "@remix-run/react";
import * as React from "react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { CustomerPicker } from "~/components/CustomerPicker";

// Pricing engine
import {
  computeUnitPriceForCustomer,
  applyDiscounts,
  fetchActiveCustomerRules,
  buildCartFromOrderItems,
  type Cart,
  type Rule,
  type UnitKind,
} from "~/services/pricing";

// -------------------------------------------------------
// Types
// -------------------------------------------------------
type StockRow = {
  productId: number;
  name: string;
  loaded: number;
  sold: number; // loader: main POS + snapshot quick sales
  returned: number; // editable
};

type SoldRowPayload = {
  productId: number | null;
  name: string;
  qty: number;
  unitPrice: number;
  isCredit?: boolean;
  customerId?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  // optional: magkano talaga ang cash na nakuha para sa line na ito
  cashAmount?: number | null;
};

// UI structure: grouped receipts
type SoldLineUI = {
  key: string;
  productId: number | null;
  name: string;
  qty: number;
  unitPrice: number;
  // cash collected for this line (<= qty * unitPrice)
  cashAmount?: number | null;
  // raw string for smooth typing
  cashInput?: string;
};

type SoldReceiptUI = {
  key: string;
  isCredit: boolean;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerObj?: any | null;
  lines: SoldLineUI[];
};

type ParentLineUI = {
  key: string;
  productId: number | null;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

type ParentReceiptUI = {
  key: string;
  orderId: number;
  isCredit: boolean;
  customerLabel: string;
  lines: ParentLineUI[];
  orderTotal: number;
  // optional: actual cash collected for this POS order (snapshot only)
  cashCollected?: number;
  // raw string for smooth typing sa "Cash collected" input
  cashInput?: string;
};

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: string;
    riderLabel: string | null;
  };
  rows: StockRow[];
  productOptions: Array<{ productId: number; name: string; price: number }>;
  initialSoldRows: SoldRowPayload[];
  hasSnapshot: boolean;
  parentReceipts: ParentReceiptUI[];
  customerPrices: Array<{
    customerId: number;
    productId: number;
    unitPrice: number;
  }>;
  role: string;
};

// -------------------------------------------------------
// Loader
// -------------------------------------------------------
export async function loader({ request, params }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN", "EMPLOYEE"]);

  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid id", { status: 400 });

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

  if (run.status !== "DISPATCHED") {
    return redirect(`/runs/${id}/summary?note=not-dispatched`);
  }

  const rawSnap = run.riderCheckinSnapshot as any;

  // Parent AR/Cash overrides saved from previous check-in (snapshot only)
  const parentOverrideMap = new Map<number, boolean>();
  // Parent cash collected snapshot (per POS order)
  const parentPaymentMap = new Map<number, number>();
  if (
    rawSnap &&
    typeof rawSnap === "object" &&
    (Array.isArray(rawSnap.parentOverrides) ||
      Array.isArray(rawSnap.parentPayments))
  ) {
    if (Array.isArray(rawSnap.parentOverrides)) {
      for (const row of rawSnap.parentOverrides) {
        const oid = Number(row?.orderId ?? 0);
        if (!oid) continue;
        parentOverrideMap.set(oid, !!row?.isCredit);
      }
    }

    if (Array.isArray(rawSnap.parentPayments)) {
      for (const row of rawSnap.parentPayments) {
        const oid = Number(row?.orderId ?? 0);
        if (!oid) continue;
        const amt = Number(row?.cashCollected ?? 0);
        if (!Number.isFinite(amt) || amt < 0) continue;
        parentPaymentMap.set(oid, amt);
      }
    }
  }

  // Rider Label
  let riderLabel: string | null = null;
  if (run.riderId) {
    const rr = await db.employee.findUnique({
      where: { id: run.riderId },
      select: { alias: true, firstName: true, lastName: true },
    });
    riderLabel =
      rr?.alias?.trim() ||
      [rr?.firstName, rr?.lastName].filter(Boolean).join(" ") ||
      null;
  }

  // 1. LOAD SNAPSHOT (extra load sa dispatch)
  const loadedMap = new Map<number, { name: string; qty: number }>();
  const loadSnap = Array.isArray(run.loadoutSnapshot)
    ? (run.loadoutSnapshot as any[])
    : [];

  for (const row of loadSnap) {
    const pid = Number(row?.productId ?? 0);
    if (!pid) continue;
    loadedMap.set(pid, {
      name: String(row?.name ?? `#${pid}`),
      qty: Math.max(0, Number(row?.qty ?? 0)),
    });
  }

  // 2. MAIN SOLD (from delivery orders – parent PAD orders)
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
              id: true, // 🔴 important: needed for pricing map
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

  // Pricing engine for parent POS orders (for display only)
  const parentPricingByOrderId = new Map<
    number,
    { unitPriceByItemId: Map<number, number>; orderTotal: number }
  >();

  for (const L of links) {
    const o = L.order;
    if (!o || !o.items || o.items.length === 0) continue;

    const customerId = o.customerId ?? null;
    const rules: Rule[] = await fetchActiveCustomerRules(db, customerId);

    if (!rules.length) continue;

    const cart: Cart = buildCartFromOrderItems({
      items: o.items as any,
      rules,
    });

    const pricing = applyDiscounts(cart, rules, { id: customerId });

    const unitPriceByItemId = new Map<number, number>();
    for (const adj of pricing.adjustedItems || []) {
      if (adj.id == null || !Number.isFinite(adj.effectiveUnitPrice)) continue;
      unitPriceByItemId.set(adj.id as number, adj.effectiveUnitPrice);
    }

    const fallbackTotal = o.items.reduce((sum, it) => {
      const qty = Number(it.qty ?? 0);
      const up = Number(it.unitPrice ?? 0);
      return sum + qty * up;
    }, 0);

    parentPricingByOrderId.set(o.id, {
      unitPriceByItemId,
      orderTotal: pricing.total ?? fallbackTotal,
    });
  }

  const mainSoldMap = new Map<number, number>();
  const mainSoldNameMap = new Map<number, string>();
  for (const L of links) {
    for (const it of L.order?.items || []) {
      const pid = Number(it.productId ?? 0);
      if (!pid) continue;
      mainSoldMap.set(pid, (mainSoldMap.get(pid) || 0) + Number(it.qty));
      if (!mainSoldNameMap.has(pid) && it.name) {
        mainSoldNameMap.set(pid, it.name);
      }
    }
  }

  // Parent POS orders (for read-only display with prices)
  const parentReceipts: ParentReceiptUI[] = links
    .filter((L) => L.order && (L.order.items?.length || 0) > 0)
    .map((L, idx) => {
      const o = L.order!;
      const c = o.customer;

      const priceInfo = parentPricingByOrderId.get(o.id);

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

      // Effective AR/Cash status: override from snapshot if meron,
      // else fallback sa original POS isOnCredit
      const isCredit = parentOverrideMap.has(o.id)
        ? !!parentOverrideMap.get(o.id)
        : !!o.isOnCredit;

      const lines: ParentLineUI[] = o.items.map((it, lineIdx) => {
        const pid = it.productId != null ? Number(it.productId) : null;
        const qty = Number(it.qty ?? 0);
        const effectiveUnit =
          priceInfo?.unitPriceByItemId.get((it as any).id) ??
          Number(it.unitPrice ?? 0);
        const lineTotal = Number((qty * effectiveUnit).toFixed(2));
        return {
          key: `p-ln-${idx}-${lineIdx}`,
          productId: pid,
          name: it.name ?? "",
          qty,
          unitPrice: effectiveUnit,
          lineTotal,
        };
      });

      const orderTotal =
        priceInfo?.orderTotal ?? lines.reduce((s, ln) => s + ln.lineTotal, 0);

      const snapCash =
        parentPaymentMap.get(o.id) != null
          ? parentPaymentMap.get(o.id)
          : undefined;

      return {
        key: `p-rec-${idx}`,
        orderId: o.id,
        isCredit,
        customerLabel,
        lines,
        orderTotal,
        cashCollected: snapCash,
        cashInput: snapCash != null ? snapCash.toFixed(2) : "",
      };
    });

  // 3. RETURNS
  const returns = await db.stockMovement.findMany({
    where: { refKind: "RUN", refId: id, type: "RETURN_IN" },
    select: { productId: true, qty: true },
  });

  const returnedMap = new Map<number, number>();
  for (const r of returns) {
    const pid = Number(r.productId ?? 0);
    if (!pid) continue;
    returnedMap.set(pid, (returnedMap.get(pid) || 0) + Number(r.qty));
  }

  // 3.5 Allowed PIDs = parent PAD products + extra loadout products
  const allowedPids = new Set<number>([
    ...loadedMap.keys(),
    ...mainSoldMap.keys(),
  ]);

  // 4. Snapshot (quicksales + previous returned)
  let existingSold: SoldRowPayload[] = [];
  let existingReturnedRows: Array<{ productId: number; returned: number }> = [];

  if (rawSnap && typeof rawSnap === "object") {
    if (Array.isArray(rawSnap.stockRows)) {
      existingReturnedRows = rawSnap.stockRows
        .map((r: any) => ({
          productId: Number(r?.productId ?? 0),
          returned: Math.max(0, Number(r?.returned ?? 0)),
        }))
        .filter((r) => r.productId > 0 && allowedPids.has(r.productId));
    }

    const rawSold = Array.isArray(rawSnap.soldRows) ? rawSnap.soldRows : [];
    existingSold = rawSold
      .map((r: any) => {
        const pid =
          r?.productId == null || Number.isNaN(Number(r.productId))
            ? null
            : Number(r.productId);
        return {
          productId: pid,
          name: r?.name ?? "",
          qty: Number(r?.qty ?? 0),
          unitPrice: Number(r?.unitPrice ?? 0),
          isCredit: !!r?.isCredit,
          customerId:
            r?.customerId == null || Number.isNaN(Number(r.customerId))
              ? null
              : Number(r.customerId),
          customerName: r?.customerName ?? null,
          customerPhone: r?.customerPhone ?? null,
          cashAmount:
            r?.cashAmount != null && !Number.isNaN(Number(r.cashAmount))
              ? Number(r.cashAmount)
              : null,
        } as SoldRowPayload;
      })
      .filter((r: SoldRowPayload) => {
        if (r.productId == null) return true; // allow for now; mafi-filter sa submit
        return allowedPids.has(r.productId);
      });
  }

  // Quicksale (snapshot) qty per pid
  const snapshotQuickSoldByPid = new Map<number, number>();
  for (const s of existingSold) {
    if (s.productId == null) continue;
    const pid = s.productId;
    if (!allowedPids.has(pid)) continue;
    snapshotQuickSoldByPid.set(
      pid,
      (snapshotQuickSoldByPid.get(pid) || 0) + Number(s.qty || 0)
    );
  }

  // 5. Unified PID list (parent PAD + extra)
  const allPids = new Set<number>(allowedPids);

  // 6. Load base product info (name + price) from DB
  const pidList = Array.from(allPids);
  const prodRows = pidList.length
    ? await db.product.findMany({
        where: { id: { in: pidList } },
        select: { id: true, name: true, price: true, srp: true },
      })
    : [];

  const priceIndex = new Map<number, number>();
  const prodNameIndex = new Map<number, string>();
  for (const p of prodRows) {
    const base = Number(p.srp ?? p.price ?? 0);
    priceIndex.set(p.id, Number.isFinite(base) ? base : 0);
    if (p.name) {
      prodNameIndex.set(p.id, p.name);
    }
  }

  // 7. Compose rows:
  //    Loaded = actual load from loadoutSnapshot
  //    Sold   = parent PAD orders (mainSold) + snapshot quick sales
  const rows: StockRow[] = Array.from(allPids).map((pid) => {
    const loadedEntry = loadedMap.get(pid);

    // Source of truth: loadout snapshot.
    // Fallback lang sa mainSoldMap kung legacy run na walang snapshot.
    const loaded =
      loadedEntry !== undefined ? loadedEntry.qty : mainSoldMap.get(pid) ?? 0;

    const name =
      loadedEntry?.name ||
      mainSoldNameMap.get(pid) ||
      prodNameIndex.get(pid) ||
      `#${pid}`;

    const mainSold = mainSoldMap.get(pid) ?? 0;
    const roadsideSold = snapshotQuickSoldByPid.get(pid) ?? 0;
    const sold = mainSold + roadsideSold;

    const returned =
      existingReturnedRows.find((r) => r.productId === pid)?.returned ??
      returnedMap.get(pid) ??
      0;

    return { productId: pid, name, loaded, sold, returned };
  });

  const productOptions = Array.from(allPids).map((pid) => ({
    productId: pid,
    name:
      loadedMap.get(pid)?.name ||
      mainSoldNameMap.get(pid) ||
      prodNameIndex.get(pid) ||
      `#${pid}`,
    price: priceIndex.get(pid) ?? 0,
  }));

  // ─────────────────────────────────────────────────────────────
  // Customer-specific prices for Quick Sales (pricing engine)
  // ─────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  // Customer-specific prices for Quick Sales (pricing engine)
  // - Goal: pag pinili ng rider ang customer + product,
  //   makita niya agad yung effective price (customer rule) instead of plain SRP.
  // ─────────────────────────────────────────────────────────────
  const customerIds = new Set<number>();
  // from parent POS orders
  for (const L of links) {
    const cid = L.order?.customerId;
    if (cid) customerIds.add(cid);
  }
  // from existing quick sales snapshot
  for (const s of existingSold) {
    if (s.customerId) customerIds.add(s.customerId);
  }

  const customerPrices: Array<{
    customerId: number;
    productId: number;
    unitPrice: number;
  }> = [];

  const pidListForCart = Array.from(allPids);

  if (customerIds.size && pidListForCart.length) {
    for (const cid of customerIds) {
      const rules: Rule[] = await fetchActiveCustomerRules(db, cid);
      if (!rules.length) continue;

      const cart: Cart = {
        items: pidListForCart.map((pid, idx) => ({
          id: idx,
          productId: pid,
          name: "",
          qty: 1,
          // base price = SRP/price (same as priceIndex)
          unitPrice: priceIndex.get(pid) ?? 0,
          // Quick Sales from truck → assume RETAIL per-piece
          unitKind: "PACK" as UnitKind,
        })),
      };

      const out = applyDiscounts(cart, rules, { id: cid });
      for (const adj of out.adjustedItems || []) {
        if (!adj.productId) continue;
        customerPrices.push({
          customerId: cid,
          productId: adj.productId,
          unitPrice: adj.effectiveUnitPrice,
        });
      }
    }
  }

  return json<LoaderData>({
    run: {
      id: run.id,
      runCode: run.runCode,
      status: run.status,
      riderLabel,
    },
    rows,
    productOptions,
    initialSoldRows: existingSold,
    hasSnapshot: !!run.riderCheckinSnapshot,
    parentReceipts,
    customerPrices,
    role: me.role,
  });
}

// -------------------------------------------------------
// Action
// -------------------------------------------------------
export async function action({ request, params }: ActionFunctionArgs) {
  // Same guard as loader: only rider/employee/manager/admin can submit
  await requireRole(request, ["STORE_MANAGER", "ADMIN", "EMPLOYEE"]);

  const id = Number(params.id);

  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  if (intent !== "submit-checkin") {
    return redirect(`/runs/${id}/rider-checkin`);
  }

  // Save only RETURNED from stock rows
  const rowsJson = fd.get("rows");
  const parsedRows = JSON.parse(String(rowsJson || "[]"));

  const stockRows = parsedRows.map((r: any) => ({
    productId: Number(r.productId),
    returned: Math.max(0, Number(r.returned || 0)),
  }));

  // Save quicksale rows
  const soldJson = fd.get("soldJson");
  let soldRows = JSON.parse(String(soldJson || "[]")) as any[];

  // ─────────────────────────────────────────────────────────────
  // PRICING-AWARE GUARD FOR QUICK SALES (cashAmount)
  // ─────────────────────────────────────────────────────────────
  if (Array.isArray(soldRows) && soldRows.length > 0) {
    const productIds = Array.from(
      new Set(
        soldRows
          .map((r) => Number(r?.productId ?? 0))
          .filter((pid) => Number.isFinite(pid) && pid > 0)
      )
    );

    const products = productIds.length
      ? await db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, price: true, srp: true },
        })
      : [];

    const basePriceMap = new Map<number, number>();
    for (const p of products) {
      const rawBase = Number(p.srp ?? p.price ?? 0);
      const base =
        Number.isFinite(rawBase) && rawBase > 0
          ? rawBase
          : Number(p.price ?? 0) || 0;
      basePriceMap.set(p.id, base);
    }

    const adjusted: any[] = [];

    for (const row of soldRows) {
      const productId =
        row?.productId != null && !Number.isNaN(Number(row.productId))
          ? Number(row.productId)
          : null;
      const customerId =
        row?.customerId != null && !Number.isNaN(Number(row.customerId))
          ? Number(row.customerId)
          : null;
      const qty = Number(row?.qty ?? 0) || 0;
      const rawUnitPrice = Number(row?.unitPrice ?? 0) || 0;

      let allowedUnitPrice = rawUnitPrice;

      if (productId && qty > 0) {
        const baseFromProduct = basePriceMap.get(productId) ?? rawUnitPrice;

        if (customerId) {
          const eff = await computeUnitPriceForCustomer(db, {
            customerId,
            productId,
            unitKind: "PACK" as UnitKind,
            baseUnitPrice: baseFromProduct || rawUnitPrice,
          });
          if (Number.isFinite(eff) && eff > 0) {
            allowedUnitPrice = eff;
          } else {
            allowedUnitPrice = baseFromProduct || rawUnitPrice;
          }
        } else {
          allowedUnitPrice = baseFromProduct || rawUnitPrice;
        }
      }

      const allowedLineTotal = allowedUnitPrice * qty;

      const cashAmount =
        row?.cashAmount != null && !Number.isNaN(Number(row.cashAmount))
          ? Number(row.cashAmount)
          : null;

      let isCredit = !!row?.isCredit;

      // If marked as Cash pero masyadong mababa ang cash vs allowed total → force A/R
      if (
        !isCredit &&
        cashAmount != null &&
        allowedLineTotal > 0 &&
        cashAmount < allowedLineTotal * 0.8
      ) {
        isCredit = true;
      }

      adjusted.push({
        ...row,
        isCredit,
      });
    }

    soldRows = adjusted;
  }

  // Save parent order AR/Cash overrides (proposed by rider)
  const parentOverridesJson = fd.get("parentOverridesJson");
  const rawParentOverrides = JSON.parse(
    String(parentOverridesJson || "[]")
  ) as Array<{ orderId: number; isCredit: boolean }>;

  // Save parent order cash collected (snapshot only)
  const parentPaymentsJson = fd.get("parentPaymentsJson");
  const rawParentPayments = JSON.parse(
    String(parentPaymentsJson || "[]")
  ) as Array<{ orderId: number; cashCollected: number }>;

  // --- Guard: detect underpaid "cash" that should really be A/R ---
  const orderIds = Array.from(
    new Set([
      ...rawParentOverrides.map((o) => Number(o.orderId) || 0),
      ...rawParentPayments.map((p) => Number(p.orderId) || 0),
    ])
  ).filter((oid) => oid > 0);

  const orderTotalMap = new Map<number, number>();
  if (orderIds.length > 0) {
    const orders = await db.order.findMany({
      where: { id: { in: orderIds } },
      select: {
        id: true,
        items: { select: { qty: true, unitPrice: true } },
      },
    });

    for (const o of orders) {
      const total = o.items.reduce((sum, it) => {
        const qty = Number(it.qty || 0);
        const unitPrice = Number(it.unitPrice || 0);
        return sum + qty * unitPrice;
      }, 0);
      orderTotalMap.set(o.id, total);
    }
  }

  // Normalize payments (clamp 0..orderTotal)
  const parentPayments = rawParentPayments.map((p) => {
    const orderId = Number(p.orderId) || 0;
    const orderTotal = orderTotalMap.get(orderId);

    let cashCollected = Number(p.cashCollected || 0);
    if (cashCollected < 0) cashCollected = 0;
    if (orderTotal != null && orderTotal > 0 && cashCollected > orderTotal) {
      cashCollected = orderTotal;
    }

    return { orderId, cashCollected };
  });

  // Build a quick lookup for payments by orderId
  const paymentByOrderId = new Map<number, number>();
  for (const p of parentPayments) {
    paymentByOrderId.set(p.orderId, p.cashCollected);
  }

  const SAFE_RATIO = 0.9;

  const parentOverrides = rawParentOverrides.map((o) => {
    const orderId = Number(o.orderId) || 0;
    const orderTotal = orderTotalMap.get(orderId);
    const paid = paymentByOrderId.get(orderId);

    let isCredit = !!o.isCredit;

    if (
      orderTotal != null &&
      orderTotal > 0 &&
      paid != null &&
      paid < orderTotal * SAFE_RATIO
    ) {
      // masyadong mababa ang bayad kumpara sa total → siguradong may A/R
      isCredit = true;
    }

    return { orderId, isCredit };
  });

  await db.deliveryRun.update({
    where: { id },
    data: {
      status: "CHECKED_IN",
      riderCheckinSnapshot: {
        stockRows,
        soldRows,
        parentOverrides,
        parentPayments,
      },
      riderCheckinAt: new Date(),
    },
  });

  return redirect(`/runs/${id}/summary?checkin=1`);
}

// -------------------------------------------------------
// PAGE
// -------------------------------------------------------
export default function RiderCheckinPage() {
  const {
    run,
    rows,
    productOptions,
    initialSoldRows,
    hasSnapshot,
    parentReceipts,
    customerPrices: initialCustomerPrices,
  } = useLoaderData<LoaderData>();
  const nav = useNavigation();
  const pricingFetcher = useFetcher<{ rules: Rule[] }>();
  const pendingCustomerIdRef = React.useRef<number | null>(null);
  const busy = nav.state !== "idle";

  const [parentReceiptsState, setParentReceiptsState] =
    React.useState(parentReceipts);

  // Base price per product (for auto-fill)
  const priceByProductId = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const p of productOptions) {
      m.set(p.productId, p.price);
    }
    return m;
  }, [productOptions]);

  const getDefaultPrice = React.useCallback(
    (pid: number | null) => {
      if (!pid) return 0;
      return priceByProductId.get(pid) ?? 0;
    },
    [priceByProductId]
  );

  const allowedPids = React.useMemo(
    () => new Set(productOptions.map((p) => p.productId)),
    [productOptions]
  );

  // For building carts when computing prices client-side
  const allPidsForCart = React.useMemo(
    () => productOptions.map((p) => p.productId),
    [productOptions]
  );

  // Make customerPrices mutable so we can add new customers (not just loader ones)
  const [customerPricesState, setCustomerPricesState] = React.useState<
    Array<{ customerId: number; productId: number; unitPrice: number }>
  >(() => initialCustomerPrices ?? []);

  // Map for customer-specific prices: (customerId, productId) -> unitPrice
  const customerPriceByKey = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const cp of customerPricesState || []) {
      const key = `${cp.customerId}:${cp.productId}`;
      if (!m.has(key)) {
        m.set(key, cp.unitPrice);
      }
    }
    return m;
  }, [customerPricesState]);

  const getCustomerUnitPrice = React.useCallback(
    (
      customerId: number | null,
      productId: number | null
    ): number | undefined => {
      if (!customerId || !productId) return undefined;
      const key = `${customerId}:${productId}`;
      return customerPriceByKey.get(key);
    },
    [customerPriceByKey]
  );

  // Helper: given rules for a customer, compute per-product prices (PACK) on the client
  const applyCustomerRulesClient = React.useCallback(
    (customerId: number, rules: Rule[]) => {
      if (!customerId || !rules?.length || !allPidsForCart.length) return;

      const cart: Cart = {
        items: allPidsForCart.map((pid, idx) => ({
          id: idx,
          productId: pid,
          name: "",
          qty: 1,
          unitPrice: getDefaultPrice(pid),
          unitKind: "PACK" as UnitKind,
        })),
      };

      const out = applyDiscounts(cart, rules, { id: customerId });
      const adjusted = (out.adjustedItems || []).filter(
        (a) => a.productId != null && Number.isFinite(a.effectiveUnitPrice)
      );

      if (!adjusted.length) return;

      setCustomerPricesState((prev) => {
        const existing = new Set(
          prev.map((cp) => `${cp.customerId}:${cp.productId}`)
        );
        const extra = adjusted
          .map((a) => ({
            customerId,
            productId: a.productId!,
            unitPrice: a.effectiveUnitPrice,
          }))
          .filter((cp) => !existing.has(`${cp.customerId}:${cp.productId}`));
        if (!extra.length) return prev;
        return [...prev, ...extra];
      });
    },
    [allPidsForCart, getDefaultPrice]
  );

  // When /api/customer-pricing returns rules, apply them for the pending customer
  React.useEffect(() => {
    if (!pricingFetcher.data?.rules) return;
    const cid = pendingCustomerIdRef.current;
    if (!cid) return;
    applyCustomerRulesClient(cid, pricingFetcher.data.rules);
    pendingCustomerIdRef.current = null;
  }, [pricingFetcher.data, applyCustomerRulesClient]);

  const peso = React.useCallback(
    (n: number) =>
      new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
      }).format(n),
    []
  );

  // snapshot quick-sold by pid (from initial snapshot)
  const snapshotQuickSoldByPid = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const s of initialSoldRows || []) {
      if (s.productId == null) continue;
      const pid = s.productId;
      m.set(pid, (m.get(pid) || 0) + Number(s.qty || 0));
    }
    return m;
  }, [initialSoldRows]);

  // baseSoldByPid = loader.sold - snapshot quick (meaning: main POS only)
  const baseSoldByPid = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) {
      const snap = snapshotQuickSoldByPid.get(r.productId) ?? 0;
      const base = Math.max(0, (r.sold || 0) - snap);
      m.set(r.productId, base);
    }
    return m;
  }, [rows, snapshotQuickSoldByPid]);

  // receipts state (quick sales UI)
  const [receipts, setReceipts] = React.useState<SoldReceiptUI[]>(() => {
    if (!initialSoldRows || !initialSoldRows.length) return [];

    const groups = new Map<string, SoldReceiptUI>();

    initialSoldRows.forEach((r, idx) => {
      const key = `${r.customerId ?? "x"}|${r.customerName ?? ""}|${
        r.customerPhone ?? ""
      }|${r.isCredit ? 1 : 0}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key: `rec-${idx}`,
          isCredit: !!r.isCredit,
          customerId: r.customerId ?? null,
          customerName: r.customerName ?? null,
          customerPhone: r.customerPhone ?? null,
          customerObj: null,
          lines: [],
        });
      }

      const normalizedCash =
        r.cashAmount != null && !Number.isNaN(Number(r.cashAmount))
          ? Number(r.cashAmount)
          : null;

      groups.get(key)!.lines.push({
        key: `ln-${idx}`,
        productId: r.productId,
        name: r.name,
        qty: r.qty,
        unitPrice: r.unitPrice,
        cashAmount: normalizedCash,
        cashInput: normalizedCash != null ? normalizedCash.toFixed(2) : "",
      });
    });

    return Array.from(groups.values());
  });

  // Which line's product dropdown is currently open (by ln.key)
  const [openProductDropdown, setOpenProductDropdown] = React.useState<
    string | null
  >(null);

  // current quick-sold by pid (based on receipts state – live)
  const currentQuickSoldByPid = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const rec of receipts) {
      for (const ln of rec.lines) {
        if (ln.productId == null) continue;
        const pid = ln.productId;
        m.set(pid, (m.get(pid) || 0) + Number(ln.qty || 0));
      }
    }
    return m;
  }, [receipts]);

  // for returned hidden JSON
  function updateReturned(i: number, value: number) {
    const rowsEl = document.getElementById("rows-json") as HTMLInputElement;
    const arr = JSON.parse(rowsEl.value || "[]");
    if (!arr[i]) return;
    arr[i].returned = value;
    rowsEl.value = JSON.stringify(arr);
  }

  // helper: display sold for recap = base + current quick
  const displaySold = React.useCallback(
    (pid: number) => {
      const base = baseSoldByPid.get(pid) ?? 0;
      const quick = currentQuickSoldByPid.get(pid) ?? 0;
      return base + quick;
    },
    [baseSoldByPid, currentQuickSoldByPid]
  );

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-5">
      <div className="mx-auto max-w-5xl">
        <Link
          to={`/runs/${run.id}/summary`}
          className="text-sm text-indigo-600"
        >
          ← Back
        </Link>

        <h1 className="mt-4 text-lg font-semibold">
          Rider Check-in — {run.runCode}
        </h1>
        <p className="text-sm text-slate-600">
          Rider: {run.riderLabel || "—"} • DISPATCHED
        </p>

        <Form method="post" className="mt-5">
          <input type="hidden" name="intent" value="submit-checkin" />

          {/* Hidden: stock rows (only productId + returned) */}
          <input
            id="rows-json"
            name="rows"
            type="hidden"
            defaultValue={JSON.stringify(
              rows.map((r) => ({
                productId: r.productId,
                returned: r.returned,
              }))
            )}
          />

          {/* Stock Recap */}
          <h2 className="text-sm font-medium mb-2">1. Stock Recap</h2>
          <div className="rounded-xl border overflow-x-auto bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Loaded</th>
                  <th className="px-3 py-2 text-right">Sold (auto)</th>
                  <th className="px-3 py-2 text-right">Expected Ret</th>
                  <th className="px-3 py-2 text-right">Returned</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const soldNow = displaySold(r.productId);
                  const expectedRet = Math.max(0, r.loaded - soldNow);
                  return (
                    <tr key={r.productId} className="border-t">
                      <td className="px-3 py-2">
                        <span className="text-xs text-slate-400 mr-1">
                          #{r.productId}
                        </span>
                        <span>{r.name}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{r.loaded}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">
                        {soldNow}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {expectedRet}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          defaultValue={r.returned}
                          onChange={(e) =>
                            updateReturned(
                              i,
                              Math.max(0, Number(e.target.value))
                            )
                          }
                          className="w-20 border rounded px-1 py-0.5 text-right"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Parent POS Orders (read-only) */}
          {parentReceiptsState.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-medium mb-2">
                2. Parent Orders (from POS)
              </h2>
              <div className="space-y-3">
                {parentReceiptsState.map((rec) => (
                  <div key={rec.key} className="p-3 border rounded-xl bg-white">
                    <div className="flex justify-between mb-1 text-xs">
                      <div className="font-medium">
                        {rec.customerLabel}
                        <span className="ml-2 text-[10px] text-slate-400">
                          POS: {rec.isCredit ? "Credit" : "Cash"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setParentReceiptsState((prev) =>
                              prev.map((r) =>
                                r.key === rec.key
                                  ? { ...r, isCredit: false }
                                  : r
                              )
                            )
                          }
                          className={`rounded-full px-2 py-0.5 border ${
                            !rec.isCredit
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-white text-slate-600"
                          }`}
                        >
                          Cash
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setParentReceiptsState((prev) =>
                              prev.map((r) =>
                                r.key === rec.key ? { ...r, isCredit: true } : r
                              )
                            )
                          }
                          className={`rounded-full px-2 py-0.5 border ${
                            rec.isCredit
                              ? "border-amber-300 bg-amber-50 text-amber-700"
                              : "border-slate-200 bg-white text-slate-600"
                          }`}
                        >
                          Credit (A/R)
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1 text-[11px] text-slate-600">
                      {rec.lines.map((ln) => (
                        <div
                          key={ln.key}
                          className="flex justify-between gap-2"
                        >
                          <div className="flex-1">
                            <span className="font-medium">{ln.name}</span>
                            {ln.productId != null && (
                              <span className="ml-1 text-[10px] text-slate-400">
                                #{ln.productId}
                              </span>
                            )}
                            {/* Helper: show customer price / % off vs base (read-only) */}
                            {ln.productId != null &&
                              (() => {
                                const base =
                                  getDefaultPrice(ln.productId!) || 0;
                                const eff = ln.unitPrice ?? base;

                                // kung wala tayong base o eff, huwag mag-display
                                if (!base || !eff) return null;

                                const diff = base - eff;

                                // Kung walang actual discount (eff >= base),
                                // plain customer price lang
                                if (diff <= 0.01) {
                                  return (
                                    <span className="ml-2 text-[10px] text-emerald-600">
                                      Customer price: {peso(eff)}
                                    </span>
                                  );
                                }

                                // May discount talaga → show peso discount
                                return (
                                  <span className="ml-2 text-[10px] text-emerald-600">
                                    Customer price: {peso(eff)} ({peso(diff)}{" "}
                                    off)
                                  </span>
                                );
                              })()}
                          </div>
                          <div className="text-right font-mono">
                            <div>Qty: {ln.qty}</div>
                            <div>Price: {peso(ln.unitPrice)}</div>
                            <div className="font-semibold">
                              Total: {peso(ln.lineTotal)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                      <div>
                        Order total:{" "}
                        <span className="font-mono font-semibold">
                          {peso(rec.orderTotal)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>Cash collected:</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          className="w-24 border rounded px-1 py-0.5 text-right"
                          value={rec.cashInput ?? ""}
                          onChange={(e) => {
                            const rawStr = e.target.value;
                            setParentReceiptsState((prev) =>
                              prev.map((r) =>
                                r.key === rec.key
                                  ? { ...r, cashInput: rawStr }
                                  : r
                              )
                            );
                          }}
                          onBlur={(e) => {
                            const rawStr = e.target.value;

                            setParentReceiptsState((prev) =>
                              prev.map((r) => {
                                if (r.key !== rec.key) return r;

                                // alisin lahat ng hindi number at dot
                                const cleaned = rawStr.replace(/[^0-9.]/g, "");

                                // allow blank (madaling mag-delete)
                                if (cleaned === "") {
                                  return {
                                    ...r,
                                    cashCollected: undefined,
                                    cashInput: "",
                                  };
                                }

                                const raw = parseFloat(cleaned);
                                if (!Number.isFinite(raw) || raw < 0) {
                                  // invalid → balik sa last known numeric value (kung meron)
                                  return {
                                    ...r,
                                    cashInput:
                                      r.cashCollected != null
                                        ? r.cashCollected.toFixed(2)
                                        : "",
                                  };
                                }

                                const total = r.orderTotal;
                                const clamped = Math.max(
                                  0,
                                  Math.min(total, raw)
                                );
                                return {
                                  ...r,
                                  cashCollected: clamped,
                                  cashInput: clamped.toFixed(2),
                                };
                              })
                            );
                          }}
                        />
                      </div>
                    </div>

                    {rec.cashCollected != null && rec.cashCollected > 0 && (
                      <div className="mt-1 text-right text-[11px] text-slate-500">
                        Balance (A/R):{" "}
                        <span className="font-mono font-semibold">
                          {peso(
                            Math.max(0, rec.orderTotal - rec.cashCollected)
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quicksale Section */}
          <div className="mt-8">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-medium">
                {parentReceipts.length > 0
                  ? "3. Quick Sales (optional)"
                  : "2. Quick Sales (optional)"}
              </h2>
              <button
                type="button"
                onClick={() =>
                  setReceipts((prev) => [
                    ...prev,
                    {
                      key: crypto.randomUUID(),
                      isCredit: false,
                      customerId: null,
                      customerName: "",
                      customerPhone: "",
                      customerObj: null,
                      lines: [
                        {
                          key: crypto.randomUUID(),
                          productId: null,
                          name: "",
                          qty: 0,
                          unitPrice: 0,
                          cashAmount: null,
                          cashInput: "",
                        },
                      ],
                    },
                  ])
                }
                className="rounded border px-3 py-1 text-xs"
              >
                + Add Customer
              </button>
            </div>

            {receipts.map((rec) => (
              <div
                key={rec.key}
                className="mt-4 p-3 border rounded-xl bg-white"
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="text-xs font-medium">Customer Receipt</div>

                  {/* Cash vs Credit toggle */}
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setReceipts((prev) =>
                          prev.map((r) =>
                            r.key === rec.key ? { ...r, isCredit: false } : r
                          )
                        )
                      }
                      className={`rounded-full px-2 py-0.5 border ${
                        !rec.isCredit
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // AR / Credit must always be linked to an existing customer
                        if (!rec.customerId) {
                          alert(
                            "Paki-select muna ang customer bago i-mark as Credit (A/R)."
                          );
                          return;
                        }

                        setReceipts((prev) =>
                          prev.map((r) =>
                            r.key === rec.key ? { ...r, isCredit: true } : r
                          )
                        );
                      }}
                      className={`rounded-full px-2 py-0.5 border ${
                        rec.isCredit
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      Credit (A/R)
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setReceipts((prev) =>
                        prev.filter((x) => x.key !== rec.key)
                      )
                    }
                    className="text-slate-500 ml-2"
                  >
                    ✕
                  </button>
                </div>

                {/* Customer Picker */}
                <CustomerPicker
                  value={rec.customerObj}
                  onChange={(val) => {
                    const norm = val
                      ? {
                          id: val.id,
                          firstName: val.firstName ?? "",
                          lastName: val.lastName ?? "",
                          alias: val.alias ?? null,
                          phone: val.phone ?? null,
                        }
                      : null;

                    // If new customer (not in loader’s list), fetch their pricing rules
                    if (norm?.id) {
                      const hasPricesAlready = customerPricesState.some(
                        (cp) => cp.customerId === norm.id
                      );
                      if (!hasPricesAlready) {
                        pendingCustomerIdRef.current = norm.id;
                        pricingFetcher.load(
                          `/api/customer-pricing?customerId=${norm.id}`
                        );
                      }
                    }

                    setReceipts((prev) =>
                      prev.map((r) =>
                        r.key === rec.key
                          ? {
                              ...r,
                              customerObj: norm,
                              customerId: norm?.id ?? null,
                              customerName:
                                norm != null
                                  ? norm.alias ||
                                    [norm.firstName, norm.lastName]
                                      .filter(Boolean)
                                      .join(" ") ||
                                    ""
                                  : r.customerName,
                              customerPhone: norm?.phone ?? r.customerPhone,
                              // Recompute unitPrice for existing lines when customer changes
                              lines: r.lines.map((ln) => {
                                if (ln.productId == null) return ln;
                                const base = getDefaultPrice(ln.productId);
                                const custPrice = getCustomerUnitPrice(
                                  norm?.id ?? null,
                                  ln.productId
                                );
                                return {
                                  ...ln,
                                  unitPrice: custPrice ?? base,
                                };
                              }),
                            }
                          : r
                      )
                    );
                  }}
                />

                {/* AR requires customer */}
                {rec.isCredit && !rec.customerId && (
                  <p className="mt-1 text-[11px] text-red-600">
                    • Credit (A/R) requires selecting a customer.
                  </p>
                )}

                {/* Lines */}
                <div className="mt-3 space-y-2">
                  {rec.lines.map((ln) => {
                    const pid = ln.productId;

                    // compute remaining stock for this line
                    let remainingForLine: number | null = null;
                    if (pid && allowedPids.has(pid)) {
                      const row = rows.find((rr) => rr.productId === pid);
                      if (row) {
                        const loaded = row.loaded;
                        const base = baseSoldByPid.get(pid) ?? 0;
                        const currentQuick =
                          currentQuickSoldByPid.get(pid) ?? 0;
                        // all quick sales for this pid except this line
                        const otherQuick = currentQuick - ln.qty;
                        const rem = loaded - base - otherQuick;
                        remainingForLine = Math.max(0, rem);
                      }
                    }

                    const isOutOfStock =
                      remainingForLine !== null && remainingForLine <= 0;

                    // kapag qty = 0 or out-of-stock → price display = 0
                    const effectiveUnitPrice =
                      ln.qty <= 0 || isOutOfStock ? 0 : ln.unitPrice ?? 0;

                    const lineTotal = (ln.qty || 0) * effectiveUnitPrice;
                    const cashDisabled = isOutOfStock || ln.qty <= 0;

                    return (
                      <div
                        key={ln.key}
                        className={`grid grid-cols-12 gap-2 items-center ${
                          isOutOfStock ? "bg-amber-50 rounded-md px-1 py-1" : ""
                        }`}
                      >
                        {/* Product dropdown (limited to current load) */}
                        <div className="col-span-5 relative">
                          <button
                            type="button"
                            className={`w-full border rounded px-2 py-1 text-sm flex items-center justify-between ${
                              isOutOfStock
                                ? "bg-amber-50 border-amber-300 text-amber-800"
                                : "bg-white border-slate-300 text-slate-900"
                            }`}
                            onClick={() =>
                              setOpenProductDropdown((prev) =>
                                prev === ln.key ? null : ln.key
                              )
                            }
                          >
                            <span
                              className={
                                ln.productId != null
                                  ? "text-slate-900"
                                  : "text-slate-400"
                              }
                            >
                              {ln.productId != null
                                ? (() => {
                                    const found = productOptions.find(
                                      (p) => p.productId === ln.productId
                                    );
                                    return `#${ln.productId} • ${
                                      found?.name ?? ln.name ?? "Unknown"
                                    }`;
                                  })()
                                : "Select product…"}
                            </span>
                            <span className="ml-2 text-xs text-slate-400">
                              ▾
                            </span>
                          </button>

                          {openProductDropdown === ln.key && (
                            <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-white shadow-lg text-sm">
                              {productOptions.map((p) => (
                                <button
                                  key={p.productId}
                                  type="button"
                                  className="w-full text-left px-2 py-1 hover:bg-indigo-50"
                                  onClick={() => {
                                    const pid = p.productId;
                                    const name = p.name;
                                    const defaultPrice = getDefaultPrice(pid);
                                    const customerIdForRec =
                                      rec.customerId ?? null;
                                    const customerUnitPrice =
                                      getCustomerUnitPrice(
                                        customerIdForRec,
                                        pid
                                      );
                                    const unitPriceToUse =
                                      customerUnitPrice ?? defaultPrice;

                                    setReceipts((prev) =>
                                      prev.map((r) =>
                                        r.key === rec.key
                                          ? {
                                              ...r,
                                              lines: r.lines.map((x) =>
                                                x.key === ln.key
                                                  ? {
                                                      ...x,
                                                      productId: pid,
                                                      name,
                                                      unitPrice: unitPriceToUse,
                                                      qty: (() => {
                                                        const row = rows.find(
                                                          (rr) =>
                                                            rr.productId === pid
                                                        );
                                                        if (!row) return 0;
                                                        const loaded =
                                                          row.loaded;
                                                        const base =
                                                          baseSoldByPid.get(
                                                            pid
                                                          ) ?? 0;
                                                        const otherQuick =
                                                          currentQuickSoldByPid.get(
                                                            pid
                                                          ) ?? 0;
                                                        const remaining =
                                                          Math.max(
                                                            0,
                                                            loaded -
                                                              base -
                                                              otherQuick
                                                          );
                                                        return remaining > 0
                                                          ? 1
                                                          : 0;
                                                      })(),
                                                    }
                                                  : x
                                              ),
                                            }
                                          : r
                                      )
                                    );
                                    setOpenProductDropdown(null);
                                  }}
                                >
                                  <span className="text-xs text-slate-400 mr-1">
                                    #{p.productId}
                                  </span>
                                  <span>{p.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {isOutOfStock && (
                            <div className="mt-1 text-[10px] font-semibold text-amber-700">
                              Out of stock
                            </div>
                          )}
                        </div>

                        {/* Qty with guard: loaded - (baseSold + other quick) */}
                        <input
                          className="col-span-3 border rounded px-2 py-1 text-sm text-right"
                          type="number"
                          min={0}
                          value={ln.qty}
                          onChange={(e) => {
                            const raw = Math.max(
                              0,
                              Number(e.target.value) || 0
                            );
                            setReceipts((prev) => {
                              const pid = ln.productId;
                              if (!pid || !allowedPids.has(pid)) {
                                // Walang load, huwag na i-guard
                                return prev.map((r) =>
                                  r.key === rec.key
                                    ? {
                                        ...r,
                                        lines: r.lines.map((x) =>
                                          x.key === ln.key
                                            ? { ...x, qty: raw }
                                            : x
                                        ),
                                      }
                                    : r
                                );
                              }

                              const row = rows.find(
                                (rr) => rr.productId === pid
                              );
                              if (!row) {
                                return prev.map((r) =>
                                  r.key === rec.key
                                    ? {
                                        ...r,
                                        lines: r.lines.map((x) =>
                                          x.key === ln.key
                                            ? { ...x, qty: raw }
                                            : x
                                        ),
                                      }
                                    : r
                                );
                              }

                              const loaded = row.loaded;
                              const base = baseSoldByPid.get(pid) ?? 0;

                              // Other quick quantities (all lines except ln)
                              let otherQuick = 0;
                              for (const r of prev) {
                                for (const x of r.lines) {
                                  if (x.productId === pid && x.key !== ln.key) {
                                    otherQuick += x.qty;
                                  }
                                }
                              }

                              const maxExtra = Math.max(
                                0,
                                loaded - base - otherQuick
                              );
                              const newQty = Math.min(raw, maxExtra);

                              return prev.map((r) =>
                                r.key === rec.key
                                  ? {
                                      ...r,
                                      lines: r.lines.map((x) =>
                                        x.key === ln.key
                                          ? { ...x, qty: newQty }
                                          : x
                                      ),
                                    }
                                  : r
                              );
                            });
                          }}
                        />

                        {/* Unit Price (read-only, pricing engine) */}
                        <input
                          className="col-span-3 border rounded px-2 py-1 text-sm text-right bg-slate-50"
                          type="number"
                          min={0}
                          step="0.01"
                          readOnly
                          value={effectiveUnitPrice.toFixed(2)}
                        />

                        {/* Remove line */}
                        <button
                          type="button"
                          className="col-span-1 flex justify-end text-slate-500"
                          onClick={() =>
                            setReceipts((prev) =>
                              prev
                                .map((r) =>
                                  r.key === rec.key
                                    ? {
                                        ...r,
                                        lines: r.lines.filter(
                                          (x) => x.key !== ln.key
                                        ),
                                      }
                                    : r
                                )
                                .filter((r) => r.lines.length > 0)
                            )
                          }
                        >
                          ✕
                        </button>

                        {/* Line total + Cash collected + discount helper */}
                        <div className="col-span-12 flex items-center justify-between text-[11px] text-slate-500">
                          <div>
                            Total:{" "}
                            <span className="font-mono font-semibold">
                              {peso(lineTotal)}
                            </span>
                            {/* Optional helper: show customer discount vs base price */}
                            {rec.customerId &&
                              ln.productId != null &&
                              (() => {
                                const base =
                                  getDefaultPrice(ln.productId!) || 0;
                                const eff = ln.unitPrice ?? base;

                                // kung wala tayong base o eff, huwag mag-display
                                if (!base || !eff) return null;

                                const diff = base - eff;

                                // Kung walang actual discount (eff >= base),
                                // plain customer price lang
                                if (diff <= 0.01) {
                                  return (
                                    <span className="ml-2 text-[10px] text-emerald-600">
                                      Customer price: {peso(eff)}
                                    </span>
                                  );
                                }

                                // May discount talaga → show peso discount
                                return (
                                  <span className="ml-2 text-[10px] text-emerald-600">
                                    Customer price: {peso(eff)} ({peso(diff)}{" "}
                                    off)
                                  </span>
                                );
                              })()}
                          </div>
                          <div className="flex items-center gap-1">
                            <span>Cash:</span>{" "}
                            <input
                              type="text"
                              className={`w-20 border rounded px-1 py-0.5 text-right ${
                                cashDisabled
                                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                  : ""
                              }`}
                              inputMode="decimal"
                              placeholder={cashDisabled ? "—" : "0.00"}
                              disabled={cashDisabled}
                              value={cashDisabled ? "" : ln.cashInput ?? ""}
                              onChange={(e) => {
                                if (cashDisabled) return;
                                const rawStr = e.target.value;
                                setReceipts((prev) =>
                                  prev.map((r) =>
                                    r.key === rec.key
                                      ? {
                                          ...r,
                                          lines: r.lines.map((x) =>
                                            x.key === ln.key
                                              ? { ...x, cashInput: rawStr }
                                              : x
                                          ),
                                        }
                                      : r
                                  )
                                );
                              }}
                              onBlur={(e) => {
                                if (cashDisabled) return;
                                const rawStr = e.target.value;
                                // alisin lahat ng hindi number at dot
                                const cleaned = rawStr.replace(/[^0-9.]/g, "");

                                // allow blank (para madaling mag-delete)
                                if (cleaned === "") {
                                  setReceipts((prev) =>
                                    prev.map((r) =>
                                      r.key === rec.key
                                        ? {
                                            ...r,
                                            lines: r.lines.map((x) =>
                                              x.key === ln.key
                                                ? {
                                                    ...x,
                                                    cashAmount: null,
                                                    cashInput: "",
                                                  }
                                                : x
                                            ),
                                          }
                                        : r
                                    )
                                  );
                                  return;
                                }

                                const raw = parseFloat(cleaned);
                                if (!Number.isFinite(raw) || raw < 0) {
                                  // invalid → balik sa last known numeric value (kung meron)
                                  setReceipts((prev) =>
                                    prev.map((r) =>
                                      r.key === rec.key
                                        ? {
                                            ...r,
                                            lines: r.lines.map((x) =>
                                              x.key === ln.key
                                                ? {
                                                    ...x,
                                                    cashInput:
                                                      x.cashAmount != null
                                                        ? x.cashAmount.toFixed(
                                                            2
                                                          )
                                                        : "",
                                                  }
                                                : x
                                            ),
                                          }
                                        : r
                                    )
                                  );
                                  return;
                                }

                                const total = lineTotal;

                                // kung may total na (>0), clamp 0..total
                                // kung wala pang total (0), wag i-clamp
                                const clamped =
                                  total > 0
                                    ? Math.max(0, Math.min(total, raw))
                                    : raw;

                                const formatted = clamped.toFixed(2);

                                setReceipts((prev) =>
                                  prev.map((r) =>
                                    r.key === rec.key
                                      ? {
                                          ...r,
                                          lines: r.lines.map((x) =>
                                            x.key === ln.key
                                              ? {
                                                  ...x,
                                                  cashAmount: clamped,
                                                  cashInput: formatted,
                                                }
                                              : x
                                          ),
                                        }
                                      : r
                                  )
                                );
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    className="mt-1 text-xs border rounded px-2 py-1"
                    onClick={() =>
                      setReceipts((prev) =>
                        prev.map((r) =>
                          r.key === rec.key
                            ? {
                                ...r,
                                lines: [
                                  ...r.lines,
                                  {
                                    key: crypto.randomUUID(),
                                    productId: null,
                                    name: "",
                                    qty: 0,
                                    unitPrice: 0,
                                    cashAmount: null,
                                    cashInput: "",
                                  },
                                ],
                              }
                            : r
                        )
                      )
                    }
                  >
                    + Add Product
                  </button>
                </div>
              </div>
            ))}

            {/* Hidden: sold rows */}
            <input
              type="hidden"
              name="soldJson"
              value={JSON.stringify(
                receipts.flatMap((rec) =>
                  rec.lines
                    .filter(
                      (ln) =>
                        ln.qty > 0 &&
                        (ln.productId == null || allowedPids.has(ln.productId))
                    )
                    .map((ln) => ({
                      productId: ln.productId,
                      name: ln.name,
                      qty: ln.qty,
                      unitPrice: ln.unitPrice,
                      isCredit: rec.isCredit,
                      customerId: rec.customerId,
                      customerName: rec.customerName,
                      customerPhone: rec.customerPhone,
                      cashAmount:
                        ln.cashAmount != null
                          ? Number(ln.cashAmount)
                          : undefined,
                    }))
                )
              )}
            />

            {/* Hidden: parent order AR/Cash overrides */}
            <input
              type="hidden"
              name="parentOverridesJson"
              value={JSON.stringify(
                parentReceiptsState.map((rec) => ({
                  orderId: rec.orderId,
                  isCredit: rec.isCredit,
                }))
              )}
            />

            {/* Hidden: parent order cash collected (snapshot only) */}
            <input
              type="hidden"
              name="parentPaymentsJson"
              value={JSON.stringify(
                parentReceiptsState
                  .filter(
                    (rec) => rec.cashCollected != null && rec.cashCollected > 0
                  )
                  .map((rec) => ({
                    orderId: rec.orderId,
                    cashCollected: rec.cashCollected,
                  }))
              )}
            />
          </div>

          <button
            disabled={busy}
            className="mt-6 bg-indigo-600 text-white px-4 py-2 rounded-xl"
          >
            {busy
              ? "Saving…"
              : hasSnapshot
              ? "Update Check-in"
              : "Submit Check-in"}
          </button>
        </Form>
      </div>
    </main>
  );
}
