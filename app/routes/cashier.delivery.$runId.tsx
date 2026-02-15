// app/routes/cashier.delivery.$runId.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
// NOTE: Customer settlement truth = (CASH + RIDER_SHORTAGE bridge) per Order. Cash drawer truth = Order.payments (CASH).
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";
import { resolveFinalTotalFreezeFirst } from "~/services/orderTotals.server";
import { loadRunReceiptCashMaps } from "~/services/runReceipts.server";

type LoaderData = {
  run: {
    id: number;
    runCode: string;
    status: string;
    notes: string | null;
    dispatchedAt: string | null;
    closedAt: string | null;
    riderName: string;
    vehicleName: string;
  };

  variance: null | {
    id: number;
    status: string;
    resolution: string | null;
    managerApprovedAt: string | null;
    riderAcceptedAt: string | null;
    expected: number;
    actual: number;
    variance: number;
    note: string | null;
  };

  riderCharge: null | {
    id: number;
    status: string;
    amount: number;
    paid: number;
    remaining: number;
    note: string | null;
    settledAt: string | null;
  };

  orders: Array<{
    id: number;
    orderCode: string;
    status: string;
    customerLabel: string;
    channel: string;
    totalFinal: number;
    // Cashier drawer truth (actual money received & encoded on this Order)
    alreadyPaid: number; // CASH-only payments recorded by cashier
    // Bridge settlement (non-cash) for rider shortage; keeps SOA/receipt fully settled
    bridgePaid: number; // INTERNAL_CREDIT w/ refNo RIDER_SHORTAGE (or legacy prefix)
    // Customer payment truth (what rider recorded as collected from customer)
    riderCash: number; // = RunReceipt.cashCollected (PARENT/ROAD), clamped to totalFinal
    // Gap between customer-paid (RunReceipt) vs cashier-received (Order.payments), capped per order
    remaining: number; // rider short (run-scope) = riderCash - min(alreadyPaid, riderCash)
    lockedByMe: boolean;
    lockedByOther: boolean;
    lockOwner: string | null;
  }>;
  summary: {
    totalOrders: number;
    unsettledCount: number;
    totalFinal: number;
    totalPaid: number; // cashier-received cash (run-scope, capped per order to riderCash)
    totalRemaining: number; // rider short (run-scope)
    totalBridge: number; // INTERNAL_CREDIT bridge posted for rider shortage (run-scope, capped)
    expectedCash: number; // customer-paid cash from run (RunReceipt.cashCollected, summed)
    expectedAR: number; // credit portion from this run
    cashShort: number; // rider short = expectedCash (customer-paid) - totalPaid (cashier-received)
  };
};

const EPS = 0.01;

// Cash expected vs actual must be CASH-only.
// Non-cash (fund transfer/card) is still a Payment, but not rider cash remit.
const sumCashPayments = (payments: any[] | null | undefined) =>
  (payments ?? []).reduce((sum, p) => {
    const method = String((p as any)?.method ?? "").toUpperCase();
    const amt = Number((p as any)?.amount ?? 0);
    if (method !== "CASH") return sum;
    return sum + (Number.isFinite(amt) ? amt : 0);
  }, 0);

// Bridge: shortage settlement line posted by cashier when rider comes up short.
// This is NOT cash drawer money; it's "internal credit" to keep customer fully settled.
const sumShortageBridgePayments = (payments: any[] | null | undefined) =>
  (payments ?? []).reduce((sum, p) => {
    const method = String((p as any)?.method ?? "").toUpperCase();
    if (method !== "INTERNAL_CREDIT") return sum;
    const ref = String((p as any)?.refNo ?? "").toUpperCase();
    // accept both current canonical and legacy formats
    const isShort =
      ref === "RIDER_SHORTAGE" || ref.startsWith("RIDER-SHORTAGE");
    if (!isShort) return sum;
    const amt = Number((p as any)?.amount ?? 0);
    return sum + (Number.isFinite(amt) ? amt : 0);
  }, 0);

// Normalize auth identity across routes (some older routes used me.id).
// Prefer userId, fallback to id for back-compat.
const getAuthUserId = (me: any) => {
  const v = Number(me?.userId ?? me?.id ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

const isVarianceClearedBySchema = (v: {
  status: string | null | undefined;
  resolution?: string | null | undefined;
  managerApprovedAt?: string | Date | null | undefined;
  riderAcceptedAt?: string | Date | null | undefined;
}) => {
  const status = String(v?.status ?? "");
  const resolution = String(v?.resolution ?? "");
  const hasMgrApproval = !!v?.managerApprovedAt;
  const hasRiderAccept = !!v?.riderAcceptedAt;

  // Always cleared once explicitly waived/closed
  if (status === "WAIVED" || status === "CLOSED") return true;

  // Charge rider requires rider acceptance
  if (resolution === "CHARGE_RIDER") return hasRiderAccept;

  // Info-only / waive decision is cleared once manager approved
  if (resolution === "INFO_ONLY" || resolution === "WAIVE")
    return hasMgrApproval;

  // Back-compat: if status is RIDER_ACCEPTED, treat as cleared
  if (status === "RIDER_ACCEPTED") return true;

  return false;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const me = await requireOpenShift(request);

  // Lock identity for delivery remit: per CASHIER userId
  const myUserId = getAuthUserId(me as any);
  const myToken = String(myUserId || "");

  const runId = Number(params.runId);
  if (!Number.isFinite(runId)) {
    throw new Response("Invalid run ID", { status: 400 });
  }

  const run = await db.deliveryRun.findUnique({
    where: { id: runId },
    include: {
      rider: true,
      vehicle: true,
      orders: {
        include: {
          order: {
            select: {
              id: true,
              orderCode: true,
              status: true,
              channel: true,
              createdAt: true,
              customerId: true,
              subtotal: true,
              totalBeforeDiscount: true,
              customer: {
                select: {
                  firstName: true,
                  lastName: true,
                  alias: true,
                },
              },
              payments: true,
              lockedAt: true,
              lockedBy: true,
              isOnCredit: true,
              items: {
                select: {
                  id: true,
                  productId: true,
                  name: true,
                  qty: true,
                  unitPrice: true,
                  lineTotal: true,
                },
                orderBy: { id: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw new Response("Delivery run not found", { status: 404 });
  }

  // Cashier remit page should see CLOSED runs; allow SETTLED for history view
  if (run.status !== "CLOSED" && run.status !== "SETTLED") {
    throw new Response(`Run is not ready for remit (status: ${run.status}).`, {
      status: 400,
    });
  }

  // Helper: safe money rounding
  const r2 = (n: number) =>
    Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

  // ────────────────────────────────────────────────
  // Existing variance (run-level) for gating + UI
  // ────────────────────────────────────────────────
  const variance = run.riderId
    ? await db.riderRunVariance.findFirst({
        where: {
          runId,
          riderId: run.riderId,
          status: {
            // include CLOSED so SETTLED runs can still show the variance ref + timestamps
            in: [
              "OPEN",
              "MANAGER_APPROVED",
              "RIDER_ACCEPTED",
              "WAIVED",
              "CLOSED",
            ],
          },
        },
        orderBy: { id: "desc" },
        select: {
          id: true,
          status: true,
          expected: true,
          actual: true,
          variance: true,
          note: true,
          managerApprovedAt: true,
          resolution: true,
          riderAcceptedAt: true,
        },
      })
    : null;

  // ────────────────────────────────────────────────
  // RiderCharge ledger (OPTION B) - show shortage payment status
  // Prefer varianceId (1:1), then fallback to runId+riderId
  // ────────────────────────────────────────────────
  const riderChargeRow = variance?.id
    ? await db.riderCharge.findUnique({
        where: { varianceId: variance.id },
        select: {
          id: true,
          status: true,
          amount: true,
          note: true,
          settledAt: true,
          payments: { select: { amount: true } },
        },
      })
    : run.riderId
    ? await db.riderCharge.findFirst({
        where: { runId, riderId: run.riderId },
        orderBy: { id: "desc" },
        select: {
          id: true,
          status: true,
          amount: true,
          note: true,
          settledAt: true,
          payments: { select: { amount: true } },
        },
      })
    : null;

  const riderCharge = riderChargeRow
    ? (() => {
        const amount = r2(Number(riderChargeRow.amount ?? 0));
        const paid = r2(
          (riderChargeRow.payments ?? []).reduce(
            (s, p) => s + Number(p.amount ?? 0),
            0
          )
        );
        const remaining = r2(Math.max(0, amount - paid));
        return {
          id: riderChargeRow.id,
          status: String(riderChargeRow.status ?? ""),
          amount,
          paid,
          remaining,
          note: riderChargeRow.note ?? null,
          settledAt: riderChargeRow.settledAt
            ? riderChargeRow.settledAt.toISOString()
            : null,
        };
      })()
    : null;

  // ────────────────────────────────────────────────
  // ✅ Source of truth for DISCOUNTED totals (PARENT receipts)
  // If present, cashier should rely on RunReceipt lines (frozen prices).
  // ────────────────────────────────────────────────
  const parentReceipts = await db.runReceipt.findMany({
    where: { runId, kind: "PARENT", parentOrderId: { not: null } },
    select: {
      parentOrderId: true,
      cashCollected: true,
      note: true,
      lines: {
        select: { qty: true, unitPrice: true, lineTotal: true },
        orderBy: { id: "asc" },
      },
    },
  });

  const parentReceiptByOrderId = new Map<
    number,
    { total: number; cash: number; isCredit: boolean }
  >();

  for (const r of parentReceipts) {
    const oid = Number(r.parentOrderId ?? 0);
    if (!oid) continue;
    const total = (r.lines || []).reduce((s, ln) => {
      // lineTotal is already frozen; use it if present
      const lt = Number((ln as any).lineTotal ?? NaN);
      if (Number.isFinite(lt)) return s + lt;
      const qty = Number((ln as any).qty ?? 0);
      const up = Number((ln as any).unitPrice ?? 0);
      return s + qty * up;
    }, 0);
    const cash = Math.max(0, Number(r.cashCollected ?? 0));
    // IMPORTANT: for PARENT receipts, do NOT infer credit from cashCollected.
    // Default CASH unless meta explicitly says isCredit=true (same as summary/remit).
    let isCredit = false;
    try {
      const meta = r.note ? JSON.parse(r.note) : null;
      if (meta && typeof meta.isCredit === "boolean") isCredit = meta.isCredit;
    } catch {}
    // ✅ Aggregate per parent orderId (avoid overwrite if multiple receipts exist)
    const prev = parentReceiptByOrderId.get(oid);
    parentReceiptByOrderId.set(oid, {
      total: r2((prev?.total || 0) + total),
      cash: r2((prev?.cash || 0) + cash),
      // if ANY receipt says credit, treat as credit
      isCredit: Boolean(prev?.isCredit || isCredit),
    });
  }

  // ────────────────────────────────────────────────
  // ✅ Source of truth for ROAD receipts totals + cash (discounted/frozen)
  // Deterministic mapping per spec:
  //   orderCode = RS-RUN{runId}-RR{runReceiptId}
  // ────────────────────────────────────────────────
  const roadReceipts = await db.runReceipt.findMany({
    where: { runId, kind: "ROAD" },
    select: {
      id: true,
      cashCollected: true,
      lines: {
        select: { qty: true, unitPrice: true, lineTotal: true },
        orderBy: { id: "asc" },
      },
    },
  });
  const roadReceiptById = new Map<number, { total: number; cash: number }>();
  for (const rr of roadReceipts) {
    const total = (rr.lines || []).reduce((s, ln) => {
      const lt = Number((ln as any).lineTotal ?? NaN);
      if (Number.isFinite(lt)) return s + lt;
      const qty = Number((ln as any).qty ?? 0);
      const up = Number((ln as any).unitPrice ?? 0);
      return s + qty * up;
    }, 0);
    const cash = Math.max(0, Number(rr.cashCollected ?? 0));
    roadReceiptById.set(rr.id, { total: r2(total), cash: r2(cash) });
  }

  const parseRoadReceiptIdFromOrderCode = (orderCode: string | null) => {
    if (!orderCode) return null;
    // Accept both old "RS-" prefix and your deterministic "RS-RUN{runId}-RR{id}"
    // As long as it ends with -RR{digits}, we can resolve.
    const m = String(orderCode).match(/-RR(\d+)$/);
    if (!m) return null;
    const id = Number(m[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  };

  // ────────────────────────────────────────────────
  // Source of truth maps for rider cash (ROAD + PARENT)
  // ────────────────────────────────────────────────
  const {
    roadsideCashByOrderCode,
    parentCashByOrderId,
    expectedCashRoad,
    expectedARRoad,
  } = await loadRunReceiptCashMaps(db, runId);

  // ────────────────────────────────────────────────
  // Expected CASH / AR for this run (computed for BOTH CLOSED and SETTLED)
  // ────────────────────────────────────────────────
  const rawSnap = run.riderCheckinSnapshot as any;
  const parentOverrideMap = new Map<number, boolean>(); // legacy fallback
  const parentPaymentMap = new Map<number, number>(); // legacy fallback

  if (rawSnap && typeof rawSnap === "object") {
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

  let expectedCash = 0;
  let expectedAR = 0;
  expectedCash += expectedCashRoad;
  expectedAR += expectedARRoad;

  const mappedOrders = run.orders
    .map((ro) => ro.order)
    .filter((o): o is NonNullable<typeof o> => !!o)
    .filter((o) => o.channel === "DELIVERY");

  let totalRunPaid = 0;
  let totalRunRemaining = 0;
  let totalRunBridge = 0;
  // Build product map only if we actually need legacy fallback
  const needsLegacyFallback = mappedOrders.some((o) => {
    const isRoadside = !!o.orderCode && o.orderCode.startsWith("RS-");
    if (isRoadside) {
      const rrId = parseRoadReceiptIdFromOrderCode(o.orderCode);
      // fallback only if cannot map to a ROAD runReceipt
      return !rrId || !roadReceiptById.has(rrId);
    }
    return !parentReceiptByOrderId.has(o.id);
  });

  const byProductId = new Map<
    number,
    { price: number; srp: number; allowPackSale: boolean }
  >();
  if (needsLegacyFallback) {
    const allProductIds = Array.from(
      new Set(
        mappedOrders
          .flatMap((o) =>
            (o.items ?? []).map((it: any) => Number(it.productId))
          )
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );
    const products = allProductIds.length
      ? await db.product.findMany({
          where: { id: { in: allProductIds } },
          select: { id: true, price: true, srp: true, allowPackSale: true },
        })
      : [];
    for (const p of products) {
      byProductId.set(p.id, {
        price: Number(p.price ?? 0),
        srp: Number(p.srp ?? 0),
        allowPackSale: Boolean(p.allowPackSale ?? true),
      });
    }
  }
  const orders = await Promise.all(
    mappedOrders.map(async (o) => {
      let riderCash = 0; // ✅ FIX: must be per-row
      // ✅ Prefer RunReceipt totals for parent orders (discounted/frozen)
      const isRoadside = !!o.orderCode && o.orderCode.startsWith("RS-");
      const parentReceipt = !isRoadside
        ? parentReceiptByOrderId.get(o.id)
        : null;

      let finalTotalNum = 0;
      if (isRoadside) {
        const rrId = parseRoadReceiptIdFromOrderCode(o.orderCode);
        const rr = rrId ? roadReceiptById.get(rrId) : null;
        if (rr) {
          finalTotalNum = rr.total;
          riderCash = Math.max(0, Math.min(rr.total, rr.cash));
        } else {
          // legacy fallback when ROAD receipt not resolvable
          const { finalTotal } = await resolveFinalTotalFreezeFirst(
            db,
            {
              id: o.id,
              customerId: (o as any).customerId ?? null,
              createdAt: o.createdAt ?? new Date(),
              subtotal: o.subtotal ?? null,
              totalBeforeDiscount: o.totalBeforeDiscount ?? null,
              items: (o.items ?? []).map((it: any) => ({
                id: it.id,
                productId: it.productId,
                name: it.name,
                qty: it.qty,
                unitPrice: it.unitPrice,
                lineTotal: it.lineTotal,
              })),
            } as any,
            byProductId
          );
          finalTotalNum = Number(finalTotal ?? 0);
          const rs = roadsideCashByOrderCode.get(String(o.orderCode ?? ""));
          riderCash = rs ? Math.max(0, Math.min(finalTotalNum, rs.cash)) : 0;
        }
      } else if (parentReceipt) {
        finalTotalNum = parentReceipt.total;
      } else {
        // legacy fallback ONLY when no parent receipt exists
        const { finalTotal } = await resolveFinalTotalFreezeFirst(
          db,
          {
            id: o.id,
            customerId: (o as any).customerId ?? null,
            createdAt: o.createdAt ?? new Date(),
            subtotal: o.subtotal ?? null,
            totalBeforeDiscount: o.totalBeforeDiscount ?? null,
            items: (o.items ?? []).map((it: any) => ({
              id: it.id,
              productId: it.productId,
              name: it.name,
              qty: it.qty,
              unitPrice: it.unitPrice,
              lineTotal: it.lineTotal,
            })),
          } as any,
          byProductId
        );
        finalTotalNum = Number(finalTotal ?? 0);
      }

      // ✅ CASH-only: actual cash received for this order
      const cashierReceivedCash = sumCashPayments(o.payments as any);
      // ✅ Bridge: non-cash settlement line for rider shortage
      const bridgePaid = sumShortageBridgePayments(o.payments as any);

      if (!isRoadside) {
        // ✅ Parent cash + totals: if RunReceipt exists, use it (frozen)
        if (parentReceipt) {
          const cash = parentReceipt.cash;
          riderCash = Math.max(0, Math.min(finalTotalNum, cash));
        } else {
          // Parent cash: fallback to runReceipt cash map / snapshot behavior (legacy)
          const prCash = parentCashByOrderId.get(o.id);
          if (prCash != null && Number.isFinite(prCash)) {
            riderCash = Math.max(0, Math.min(finalTotalNum, prCash));
          } else {
            const hasSnapshotControls =
              parentOverrideMap.has(o.id) || parentPaymentMap.has(o.id);

            let isCredit = !!o.isOnCredit;
            if (parentOverrideMap.has(o.id)) {
              isCredit = !!parentOverrideMap.get(o.id);
            }

            const rawSnapshotCash = parentPaymentMap.get(o.id);

            if (hasSnapshotControls) {
              if (rawSnapshotCash != null && Number.isFinite(rawSnapshotCash)) {
                riderCash = Math.max(
                  0,
                  Math.min(finalTotalNum, rawSnapshotCash)
                );
              } else {
                riderCash = isCredit ? 0 : Number(finalTotalNum ?? 0);
              }
            } else {
              riderCash = isCredit ? 0 : Number(finalTotalNum ?? 0);
            }
          }
        }

        // ✅ Expected CASH always counts what rider should remit (what rider actually collected per receipts)
        expectedCash += riderCash;

        // ✅ Expected AR only counts if order is CREDIT (override > isOnCredit)
        const override = parentOverrideMap.get(o.id);
        const isCreditFromOrder =
          override !== undefined ? override : Boolean(o.isOnCredit);

        // If we have a parentReceipt, it may also carry explicit isCredit from receipt meta
        const isCreditEffective =
          parentReceipt != null
            ? Boolean(parentReceipt.isCredit)
            : isCreditFromOrder;

        if (isCreditEffective) {
          expectedAR += Math.max(0, Number(finalTotalNum ?? 0) - riderCash);
        }
      }

      // IMPORTANT:
      // - riderCash == "customer paid" truth (RunReceipt.cashCollected)
      // - cashierReceivedCash == "cashier drawer received" truth (Order.payments CASH)
      // - bridgePaid == "internal settlement" (NOT CASH) to keep customer fully settled
      // The gap (vs CASH) is rider shortage, NOT customer underpayment.
      const cashForRun = Math.min(cashierReceivedCash, riderCash);
      const riderShort = Math.max(0, riderCash - cashForRun);

      totalRunPaid += cashForRun;
      totalRunBridge += Math.min(
        bridgePaid,
        Math.max(0, riderCash - cashierReceivedCash)
      );
      totalRunRemaining += riderShort;

      const lockedByToken = (o.lockedBy ?? "").trim();
      const isLockActive = !!lockedByToken;

      const lockedByMe = isLockActive && lockedByToken === myToken;
      const lockedByOther = isLockActive && lockedByToken !== myToken;

      const customerLabel = o.customer
        ? o.customer.alias
          ? `${o.customer.alias} (${o.customer.firstName} ${o.customer.lastName})`
          : `${o.customer.firstName} ${o.customer.lastName}`
        : "Walk-in / No customer";

      return {
        id: o.id,
        orderCode: o.orderCode,
        status: o.status,
        customerLabel,
        channel: o.channel,
        totalFinal: r2(finalTotalNum),
        alreadyPaid: r2(cashierReceivedCash),
        bridgePaid: r2(bridgePaid),
        remaining: r2(riderShort),
        riderCash: r2(riderCash),
        lockedByMe,
        lockedByOther,
        lockOwner: o.lockedBy,
      };
    })
  );

  // Unsettled for CASHIER remit purposes = riderCash not yet turned over as CASH
  // (Bridge does not remove the need to track rider shortage; it just settles the customer.)
  const unsettled = orders.filter((o) => {
    if (o.riderCash <= 0.009) return false;
    const statusOpen = o.status === "UNPAID" || o.status === "PARTIALLY_PAID";
    return statusOpen && o.remaining > 0.009;
  });

  const totalOrders = orders.length;
  const unsettledCount = unsettled.length;

  const totalFinal = orders.reduce((sum, o) => sum + o.totalFinal, 0);
  const totalPaid = totalRunPaid;
  const totalRemaining = totalRunRemaining;

  const cashShort = r2(expectedCash - totalPaid);

  // ─────────────────────────────────────────────
  // CLAIM LOCK: only while CLOSED
  // ─────────────────────────────────────────────
  if (run.status === "CLOSED") {
    // ✅ lock only orders that actually need cashier remit (avoid locking full A/R)
    const openOrderIds = orders
      .filter(
        (o) =>
          (o.status === "UNPAID" || o.status === "PARTIALLY_PAID") &&
          o.remaining > 0.009 &&
          o.riderCash > 0.009
      )
      .map((o) => o.id);

    if (openOrderIds.length > 0) {
      const result = await db.order.updateMany({
        where: {
          id: { in: openOrderIds },
          OR: [{ lockedBy: null }, { lockedBy: "" }, { lockedBy: myToken }],
        },
        data: {
          lockedBy: myToken,
          lockedAt: new Date(),
          lockNote: "DELIVERY_RUN_REMIT",
        },
      });

      if (result.count < openOrderIds.length) {
        throw new Response(
          "This delivery run is currently being remitted by another cashier.",
          { status: 409 }
        );
      }
    }
  }

  // ✅ IMPORTANT:
  // Auto-promote only when BALANCED.
  // If there is shortage/overage, require explicit clearance flow (Manager → Rider → Cashier finalize).
  const autoSettleAllowed = Math.abs(cashShort) < EPS;
  let runStatus = run.status as string;
  if (
    runStatus === "CLOSED" &&
    autoSettleAllowed &&
    unsettledCount === 0 &&
    totalRemaining <= 0.009
  ) {
    await db.deliveryRun.update({
      where: { id: run.id },
      data: { status: "SETTLED" },
    });
    runStatus = "SETTLED";
  }

  const data: LoaderData = {
    run: {
      id: run.id,
      runCode: run.runCode,
      status: runStatus,
      notes: run.notes ?? null,
      dispatchedAt: run.dispatchedAt ? run.dispatchedAt.toISOString() : null,
      closedAt: run.closedAt ? run.closedAt.toISOString() : null,
      riderName: run.rider
        ? `${run.rider.firstName} ${run.rider.lastName}${
            run.rider.alias ? ` (${run.rider.alias})` : ""
          }`
        : "—",
      vehicleName: run.vehicle ? run.vehicle.name : "—",
    },
    variance: variance
      ? {
          id: variance.id,
          status: String(variance.status ?? ""),
          resolution: variance.resolution ? String(variance.resolution) : null,
          managerApprovedAt: variance.managerApprovedAt
            ? new Date(variance.managerApprovedAt).toISOString()
            : null,
          riderAcceptedAt: variance.riderAcceptedAt
            ? new Date(variance.riderAcceptedAt).toISOString()
            : null,
          expected: r2(Number(variance.expected ?? 0)),
          actual: r2(Number(variance.actual ?? 0)),
          variance: r2(Number(variance.variance ?? 0)),
          note: variance.note ?? null,
        }
      : null,
    riderCharge,
    orders,
    summary: {
      totalOrders,
      unsettledCount,
      totalFinal,
      totalPaid,
      totalRemaining,
      totalBridge: r2(totalRunBridge),
      expectedCash: r2(expectedCash),
      expectedAR: r2(expectedAR),
      cashShort: r2(cashShort),
    },
  };

  return json(data);
}

// ────────────────────────────────────────────────
// ACTION: Record rider shortage/overage variance
// ────────────────────────────────────────────────
export async function action({ request, params }: ActionFunctionArgs) {
  const me = await requireOpenShift(request);
  const runId = Number(params.runId);
  if (!Number.isFinite(runId)) {
    throw new Response("Invalid run ID", { status: 400 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  if (intent !== "finalize-settlement") {
    throw new Response("Unsupported intent", { status: 400 });
  }

  const run = await db.deliveryRun.findUnique({
    where: { id: runId },
    include: {
      rider: true,
      vehicle: true,
      orders: {
        include: {
          order: {
            select: {
              id: true,
              orderCode: true,
              status: true,
              channel: true,
              createdAt: true,
              customerId: true,
              subtotal: true,
              totalBeforeDiscount: true,
              payments: true,
              isOnCredit: true,
              items: {
                select: {
                  id: true,
                  productId: true,
                  name: true,
                  qty: true,
                  unitPrice: true,
                  lineTotal: true,
                },
                orderBy: { id: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw new Response("Delivery run not found", { status: 404 });
  }

  // Only for CLOSED runs (SETTLED is read-only)
  if (run.status !== "CLOSED")
    throw new Response("Run is not closed yet.", { status: 400 });

  if (!run.riderId) {
    throw new Response("Run has no rider assigned.", { status: 400 });
  }

  // Recompute expected CASH (run-scope)
  let expectedCash = 0;

  const { roadsideCashByOrderCode, parentCashByOrderId, expectedCashRoad } =
    await loadRunReceiptCashMaps(db, runId);
  expectedCash += expectedCashRoad;

  const r2 = (n: number) =>
    Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

  const parseRoadReceiptIdFromOrderCode = (orderCode: string | null) => {
    if (!orderCode) return null;
    const m = String(orderCode).match(/-RR(\d+)$/);
    if (!m) return null;
    const id = Number(m[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  };

  // ✅ Same truth: use PARENT RunReceipt lines when present
  const parentReceipts = await db.runReceipt.findMany({
    where: { runId, kind: "PARENT", parentOrderId: { not: null } },
    select: {
      parentOrderId: true,
      cashCollected: true,
      note: true,
      lines: { select: { qty: true, unitPrice: true, lineTotal: true } },
    },
  });
  const parentReceiptByOrderId = new Map<
    number,
    { total: number; cash: number; isCredit: boolean }
  >();
  for (const r of parentReceipts) {
    const oid = Number(r.parentOrderId ?? 0);
    if (!oid) continue;
    const total = (r.lines || []).reduce((s, ln) => {
      const lt = Number((ln as any).lineTotal ?? NaN);
      if (Number.isFinite(lt)) return s + lt;
      const qty = Number((ln as any).qty ?? 0);
      const up = Number((ln as any).unitPrice ?? 0);
      return s + qty * up;
    }, 0);
    const cash = Math.max(0, Number(r.cashCollected ?? 0));
    let isCredit = false;
    try {
      const meta = r.note ? JSON.parse(r.note) : null;
      if (meta && typeof meta.isCredit === "boolean") isCredit = meta.isCredit;
    } catch {}
    const prev = parentReceiptByOrderId.get(oid);
    parentReceiptByOrderId.set(oid, {
      total: r2((prev?.total || 0) + total),
      cash: r2((prev?.cash || 0) + cash),
      isCredit: Boolean(prev?.isCredit || isCredit),
    });
  }

  // ✅ ROAD receipts SOT (same as loader) for RR mapping
  const roadReceipts = await db.runReceipt.findMany({
    where: { runId, kind: "ROAD" },
    select: {
      id: true,
      cashCollected: true,
      lines: { select: { qty: true, unitPrice: true, lineTotal: true } },
    },
  });
  const roadReceiptById = new Map<number, { total: number; cash: number }>();
  for (const rr of roadReceipts) {
    const total = (rr.lines || []).reduce((s, ln) => {
      const lt = Number((ln as any).lineTotal ?? NaN);
      if (Number.isFinite(lt)) return s + lt;
      const qty = Number((ln as any).qty ?? 0);
      const up = Number((ln as any).unitPrice ?? 0);
      return s + qty * up;
    }, 0);
    const cash = Math.max(0, Number(rr.cashCollected ?? 0));
    roadReceiptById.set(rr.id, { total: r2(total), cash: r2(cash) });
  }

  const mappedOrders = run.orders
    .map((ro) => ro.order)
    .filter((o): o is NonNullable<typeof o> => !!o)
    .filter((o) => o.channel === "DELIVERY");

  // Legacy fallback product map only if needed
  const needsLegacyFallback = mappedOrders.some((o) => {
    const isRoadside = !!o.orderCode && o.orderCode.startsWith("RS-");
    if (isRoadside) {
      const rrId = parseRoadReceiptIdFromOrderCode(o.orderCode);
      return !rrId || !roadReceiptById.has(rrId);
    }
    return !parentReceiptByOrderId.has(o.id);
  });
  const byProductId = new Map<
    number,
    { price: number; srp: number; allowPackSale: boolean }
  >();
  if (needsLegacyFallback) {
    const allProductIds = Array.from(
      new Set(
        mappedOrders
          .flatMap((o) =>
            (o.items ?? []).map((it: any) => Number(it.productId))
          )
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );
    const products = allProductIds.length
      ? await db.product.findMany({
          where: { id: { in: allProductIds } },
          select: { id: true, price: true, srp: true, allowPackSale: true },
        })
      : [];
    for (const p of products) {
      byProductId.set(p.id, {
        price: Number(p.price ?? 0),
        srp: Number(p.srp ?? 0),
        allowPackSale: Boolean(p.allowPackSale ?? true),
      });
    }
  }

  let totalPaidRun = 0;
  let totalRemainingRun = 0;

  for (const o of mappedOrders) {
    const isRoadside = !!o.orderCode && o.orderCode.startsWith("RS-");
    const parentReceipt = !isRoadside ? parentReceiptByOrderId.get(o.id) : null;

    let orderFinal = 0;
    if (isRoadside) {
      const rrId = parseRoadReceiptIdFromOrderCode(o.orderCode);
      const rr = rrId ? roadReceiptById.get(rrId) : null;
      if (rr) {
        orderFinal = rr.total;
      } else {
        const { finalTotal } = await resolveFinalTotalFreezeFirst(
          db,
          {
            id: o.id,
            customerId: (o as any).customerId ?? null,
            createdAt: (o as any).createdAt ?? new Date(),
            subtotal: o.subtotal ?? null,
            totalBeforeDiscount: o.totalBeforeDiscount ?? null,
            items: (o.items ?? []).map((it: any) => ({
              id: it.id,
              productId: it.productId,
              name: it.name,
              qty: it.qty,
              unitPrice: it.unitPrice,
              lineTotal: it.lineTotal,
            })),
          } as any,
          byProductId
        );
        orderFinal = Number(finalTotal ?? 0);
      }
    } else if (parentReceipt) {
      orderFinal = parentReceipt.total;
    } else {
      // legacy fallback only when receipt missing (or roadside)
      const { finalTotal } = await resolveFinalTotalFreezeFirst(
        db,
        {
          id: o.id,
          customerId: (o as any).customerId ?? null,
          createdAt: (o as any).createdAt ?? new Date(),
          subtotal: o.subtotal ?? null,
          totalBeforeDiscount: o.totalBeforeDiscount ?? null,
          items: (o.items ?? []).map((it: any) => ({
            id: it.id,
            productId: it.productId,
            name: it.name,
            qty: it.qty,
            unitPrice: it.unitPrice,
            lineTotal: it.lineTotal,
          })),
        } as any,
        byProductId
      );
      orderFinal = Number(finalTotal ?? 0);
    }
    const alreadyPaidCash = sumCashPayments(o.payments as any);

    let riderCash = 0;

    if (isRoadside) {
      const rrId = parseRoadReceiptIdFromOrderCode(o.orderCode);
      const rr = rrId ? roadReceiptById.get(rrId) : null;
      if (rr) {
        riderCash = Math.max(0, Math.min(orderFinal, rr.cash));
      } else {
        const rs = roadsideCashByOrderCode.get(String(o.orderCode ?? ""));
        const cash = rs ? rs.cash : 0;
        riderCash = Math.max(0, Math.min(orderFinal, cash));
      }
    } else {
      // ✅ if parent receipt exists, cashCollected is truth for rider cash portion
      const pr = parentReceiptByOrderId.get(o.id);
      if (pr) {
        riderCash = Math.max(0, Math.min(orderFinal, pr.cash));
      } else {
        const prCash = parentCashByOrderId.get(o.id) ?? 0;
        riderCash = Math.max(0, Math.min(orderFinal, prCash));
      }
      expectedCash += riderCash;
    }

    const paidForRun = Math.min(alreadyPaidCash, riderCash);
    totalPaidRun += paidForRun;

    const remaining = Math.max(0, riderCash - paidForRun);
    totalRemainingRun += remaining;
  }

  const cashShort = r2(expectedCash - totalPaidRun);

  // Shared: load existing variance (if any)
  const existing = await db.riderRunVariance.findFirst({
    where: {
      runId,
      riderId: run.riderId!,
      status: { in: ["OPEN", "MANAGER_APPROVED", "RIDER_ACCEPTED", "WAIVED"] },
    },
    orderBy: { id: "desc" },
  });

  // ────────────────────────────────────────────────
  // INTENT: finalize settlement (cashier)
  // ────────────────────────────────────────────────
  // Must have all per-order remits done (run-scope)
  if (totalRemainingRun > 0.009) {
    throw new Response("There are still unsettled order remits on this run.", {
      status: 400,
    });
  }

  const balanced = Math.abs(cashShort) < EPS;
  const varianceCleared = existing
    ? isVarianceClearedBySchema(existing)
    : false;

  // If not balanced, require cleared variance (created via receipt-based remit flow)
  if (!balanced && !varianceCleared) {
    throw new Response(
      "Cash variance is not cleared yet. Manager clearance (and rider acceptance if charged) is required.",
      { status: 400 }
    );
  }

  // ✅ Multi-cashier audit: stamp closing shiftId when available
  const shiftIdNum = Number((me as any)?.shiftId ?? 0);
  const shiftId =
    Number.isFinite(shiftIdNum) && shiftIdNum > 0 ? shiftIdNum : null;

  await db.$transaction(async (tx) => {
    await tx.deliveryRun.update({
      where: { id: runId },
      data: { status: "SETTLED" },
    });

    // close existing variance on settlement (if any)
    if (existing?.id) {
      await tx.riderRunVariance.update({
        where: { id: existing.id },
        data: {
          status: "CLOSED",
          resolvedAt: new Date(),
          ...(shiftId ? { shiftId } : {}),
        },
      });
    }
  });

  return redirect(`/cashier/delivery?settled=1&runId=${runId}`);
}

export default function CashierDeliveryRunRemitPage() {
  const { run, orders, summary, variance, riderCharge } =
    useLoaderData<typeof loader>();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const unsettled = orders.filter(
    (o) =>
      (o.status === "UNPAID" || o.status === "PARTIALLY_PAID") &&
      o.remaining > 0.009
  );

  const isSettled = run.status === "SETTLED";

  const balanced = Math.abs(summary.cashShort) < EPS;
  const varianceCleared = variance
    ? isVarianceClearedBySchema(variance)
    : false;

  const canFinalize =
    !isSettled &&
    summary.unsettledCount === 0 &&
    summary.totalRemaining <= 0.009 &&
    (balanced || varianceCleared);

  const hasShort = summary.cashShort > 0.009;
  const hasOver = summary.cashShort < -0.009;

  const rowsToShow = unsettled.length > 0 ? unsettled : orders;

  const canOpenRemitForOrder = (o: (typeof orders)[number]) => {
    // Only open remit when there's still CASH gap to remit (run-scope),
    // and the order is still open for payments.
    if (isSettled) return false;
    const isOpen = o.status === "UNPAID" || o.status === "PARTIALLY_PAID";
    if (!isOpen) return false;
    if (o.riderCash <= 0.009) return false; // full A/R (no cash remit)
    return o.remaining > 0.009;
  };

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-6xl px-5 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-800">
              Delivery Run Remit
            </h1>
            <div className="mt-1 text-sm text-slate-500 space-y-0.5">
              <div>
                Run{" "}
                <span className="font-mono font-medium text-indigo-700">
                  {run.runCode}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  Rider:{" "}
                  <span className="font-medium text-slate-700">
                    {run.riderName}
                  </span>
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  Vehicle:{" "}
                  <span className="font-medium text-slate-700">
                    {run.vehicleName}
                  </span>
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  Status:{" "}
                  <span className="font-medium text-emerald-700">
                    {run.status}
                  </span>
                </span>
                {run.closedAt && (
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                    Closed:{" "}
                    <span className="font-medium text-slate-700">
                      {new Date(run.closedAt).toLocaleString()}
                    </span>
                  </span>
                )}
              </div>
              {run.notes && (
                <div className="mt-1 text-xs text-slate-500">
                  Notes: {run.notes}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <Link
              to="/cashier/delivery"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ← Back to runs
            </Link>
            <div className="text-xs text-slate-500">
              {summary.unsettledCount > 0
                ? `${summary.unsettledCount} delivery order(s) to remit`
                : "All delivery orders for this run are settled."}
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <section className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-slate-500">Orders on this run</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">
              {summary.totalOrders}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {summary.unsettledCount} to remit
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-slate-500">
              Customer-paid cash (per receipts)
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {peso(summary.expectedCash)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {peso(summary.totalRemaining)} still to remit
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-slate-500">
              Cashier received (this run)
            </div>
            <div className="mt-1 text-lg font-semibold text-emerald-700">
              {peso(summary.totalPaid)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              CASH payments recorded (capped per order to customer-paid cash)
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-slate-500">
              Total A/R (credit from this run)
            </div>
            <div className="mt-1 text-lg font-semibold text-amber-700">
              {peso(summary.expectedAR)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              To be managed in AR module
            </div>
          </div>
        </section>

        {/* Short / over vs expected cash */}
        <section className="space-y-2">
          <div className="text-xs text-slate-500">
            {hasShort ? (
              <>
                Rider short vs customer-paid:{" "}
                <span className="font-semibold text-rose-700">
                  {peso(summary.cashShort)}
                </span>
              </>
            ) : hasOver ? (
              <>
                Cash over vs customer-paid:{" "}
                <span className="font-semibold text-emerald-700">
                  {peso(-summary.cashShort)}
                </span>
              </>
            ) : (
              <>Cash balanced vs expected.</>
            )}
          </div>

          {!isSettled && Math.abs(summary.cashShort) >= EPS && (
            <div className="space-y-2">
              {variance ? (
                <div className="text-xs text-slate-600">
                  Variance status:{" "}
                  <span className="font-semibold text-slate-800">
                    {variance.status}
                  </span>{" "}
                  (ref #{variance.id})
                  <div className="mt-1 text-[11px] text-slate-500">
                    Needs clearance:
                    <span className="ml-1">
                      <Link
                        className="text-indigo-700 underline"
                        to="/store/rider-variances"
                      >
                        Manager review
                      </Link>
                    </span>
                    {String(variance.status) === "MANAGER_APPROVED" &&
                    String(variance.resolution ?? "") === "CHARGE_RIDER" ? (
                      <span className="ml-2">
                        <Link
                          className="text-indigo-700 underline"
                          to={`/rider/variance/${variance.id}`}
                        >
                          Rider acceptance
                        </Link>
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {riderCharge ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold">Rider charge</span>{" "}
                      <span className="text-slate-500">
                        (ref #{riderCharge.id})
                      </span>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px]">
                      {riderCharge.status}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <div>
                      <div className="text-[11px] text-slate-500">Amount</div>
                      <div className="font-semibold">
                        {peso(riderCharge.amount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Paid</div>
                      <div className="font-semibold text-emerald-700">
                        {peso(riderCharge.paid)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">
                        Remaining
                      </div>
                      <div className="font-semibold text-rose-700">
                        {peso(riderCharge.remaining)}
                      </div>
                    </div>
                  </div>
                  {riderCharge.note ? (
                    <div className="mt-2 text-[11px] text-slate-500">
                      Note: {riderCharge.note}
                    </div>
                  ) : null}
                  {riderCharge.settledAt ? (
                    <div className="mt-1 text-[11px] text-slate-500">
                      Settled at:{" "}
                      {new Date(riderCharge.settledAt).toLocaleString()}
                    </div>
                  ) : null}
                  <div className="mt-2 text-[11px] text-slate-500">
                    Payments are recorded in{" "}
                    <Link
                      className="text-indigo-700 underline"
                      to="/store/rider-charges"
                    >
                      Rider Charges
                    </Link>
                    .
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {!isSettled && canFinalize ? (
            <Form method="post" className="mt-2">
              <button
                type="submit"
                name="_intent"
                value="finalize-settlement"
                className="inline-flex items-center rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700"
              >
                Finalize run settlement
              </button>
            </Form>
          ) : null}

          {isSettled && (
            <div
              className={`rounded-2xl border px-4 py-3 text-xs shadow-sm ${
                hasShort
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : hasOver
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {hasShort ? (
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide">
                      Rider cash short on this run
                    </div>
                    <div className="text-sm font-semibold">
                      {peso(summary.cashShort)}{" "}
                      <span className="text-[11px] font-normal">
                        vs expected cash from orders.
                      </span>
                    </div>
                    <p className="mt-1 text-[11px]">
                      All delivery orders are already settled. Pwede nang
                      i-encode ito as charge sa rider (Rider shortage) or i-log
                      manually, depende sa policy.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="mt-2 inline-flex items-center justify-center rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-[11px] font-medium text-rose-700 shadow-sm hover:bg-rose-50 sm:mt-0"
                    disabled
                    title="Coming soon: RiderCharge posting"
                  >
                    Record rider shortage (soon)
                  </button>
                </div>
              ) : hasOver ? (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-wide">
                    Cash over vs expected
                  </div>
                  <div className="text-sm font-semibold">
                    {peso(-summary.cashShort)}{" "}
                    <span className="text-[11px] font-normal">
                      extra cash vs expected from orders.
                    </span>
                  </div>
                  <p className="mt-1 text-[11px]">
                    All delivery orders are settled. Puwede itong i-treat as
                    overage / extra deposit, depende sa accounting rules.
                  </p>
                </>
              ) : (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-wide">
                    Run balanced
                  </div>
                  <p className="mt-1 text-[11px]">
                    Lahat ng delivery orders sa run na ito ay settled at tugma
                    ang cash vs expected. Wala nang pending sa rider.
                  </p>
                </>
              )}
            </div>
          )}
        </section>

        {/* Orders table */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-slate-800">
                {isSettled
                  ? "Delivery orders on this run (history)"
                  : "Delivery orders to remit"}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {isSettled
                  ? "This run is fully settled. Below is a read-only summary of all delivery orders on this run."
                  : "One remit per delivery order. Locked orders are currently being handled by another cashier."}
              </p>
            </div>
            <span className="text-xs text-slate-500">
              {isSettled
                ? `${orders.length} orders on this run`
                : `${unsettled.length} unsettled / ${orders.length} total`}
            </span>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Order</th>
                <th className="px-3 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">
                  Total (final)
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Customer paid
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Cashier received
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Bridge (shortage)
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Cash Short (Rider Accountability)
                </th>
                <th className="px-3 py-2 text-left font-medium">Lock</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-4 text-center text-slate-500"
                  >
                    No delivery orders attached to this run.
                  </td>
                </tr>
              ) : (
                rowsToShow.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono">{o.orderCode}</td>
                    <td className="px-3 py-2">
                      <div className="text-slate-800">{o.customerLabel}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          o.status === "UNPAID" || o.status === "PARTIALLY_PAID"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {peso(o.totalFinal)}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums text-slate-700"
                      title="Customer payment truth (RunReceipt.cashCollected)"
                    >
                      {peso(o.riderCash)}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums text-emerald-700"
                      title="Cashier drawer truth (Order.payments CASH), capped to customer-paid"
                    >
                      {peso(Math.min(o.alreadyPaid, o.riderCash))}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums text-indigo-700"
                      title="Bridge settlement (INTERNAL_CREDIT) for rider shortage (does not affect cash drawer)"
                    >
                      {peso(
                        Math.min(
                          o.bridgePaid,
                          Math.max(0, o.riderCash - o.alreadyPaid)
                        )
                      )}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums text-rose-700"
                      title="Cash short (rider accountability) = customer-paid (receipt) - cashier received CASH (run-scope)"
                    >
                      {peso(o.remaining)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {isSettled ? (
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                          Settled
                        </span>
                      ) : o.lockedByOther ? (
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5">
                          Locked by another cashier
                        </span>
                      ) : o.lockedByMe ? (
                        <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5">
                          Locked by you
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                          Available
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isSettled ? (
                        <span className="inline-flex items-center rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-400">
                          Remit completed
                        </span>
                      ) : o.riderCash <= 0.009 ? (
                        <span className="inline-flex items-center rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500">
                          Full A/R (no cash to remit)
                        </span>
                      ) : o.lockedByOther ? (
                        <button
                          type="button"
                          className="inline-flex items-center rounded-xl bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500"
                          disabled
                        >
                          In remit…
                        </button>
                      ) : canOpenRemitForOrder(o) ? (
                        <Link
                          to={`/delivery-remit/${o.id}?fromRunId=${
                            run.id
                          }&expected=${o.riderCash.toFixed(2)}`}
                          className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                        >
                          Open Remit
                        </Link>
                      ) : (
                        <span
                          className="inline-flex items-center rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500"
                          title="No remaining cash remit needed for this order."
                        >
                          Read-only
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
