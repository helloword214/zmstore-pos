// app/routes/delivery-remit.$id.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
// NOTE: Cashier remit is MONEY-ONLY for DELIVERY (no stock mutations, no sold-from-load).
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import * as React from "react";

import { db } from "~/utils/db.server";
import { getRiderCashForDeliveryOrder } from "~/services/riderCash.server";
import { assertActiveShiftWritable } from "~/utils/shiftGuards.server";
import { allocateReceiptNo } from "~/utils/receipt";
import { CurrencyInput } from "~/components/ui/CurrencyInput";
import { requireOpenShift } from "~/utils/auth.server";

import { Prisma } from "@prisma/client";

import { r2 } from "~/utils/money";
import {
  sumCashPayments,
  sumShortageBridgePayments,
  sumFrozenLineTotals,
  hasAllFrozenLineTotals,
  EPS,
} from "~/services/settlementSoT";

// Lock TTL: ilang minuto valid ang lock ng cashier bago i-consider na expired
const REMIT_LOCK_TTL_MINUTES = 10;

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number(n || 0),
  );

const parseMoney = (s: string | number | null | undefined) => {
  if (s == null) return 0;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

type FrozenLine = {
  id: number;
  productId?: number | null;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  baseUnitPrice?: number | null;
  discountAmount?: number | null;
};

function buildDiscountViewFromLines(linesIn: FrozenLine[]) {
  const rows: DiscountRow[] = [];
  let subtotal = 0;
  let discountTotal = 0;
  let totalAfter = 0;
  let hasMissingLineTotals = false;

  for (const it of linesIn) {
    const qty = Number(it.qty ?? 0);
    const unit = Number(it.unitPrice ?? 0);
    // 🔒 CASHIER RULE: never recompute totals. lineTotal must be frozen.
    const hasLineTotal = it.lineTotal != null;
    const lineFinal = hasLineTotal ? Number(it.lineTotal) : 0;
    if (!hasLineTotal && qty > 0) hasMissingLineTotals = true;

    // IMPORTANT:
    // Cashier remit must NEVER "infer" discount from base-unit.
    // Only trust the frozen snapshot (discountAmount/baseUnitPrice) if present.
    const base =
      it.baseUnitPrice != null && Number(it.baseUnitPrice) > 0
        ? Number(it.baseUnitPrice)
        : unit; // UI fallback only (no inflation). Not an accounting truth.

    const perUnitDisc =
      it.discountAmount != null ? Math.max(0, Number(it.discountAmount)) : 0;

    const lineDisc = Math.max(0, r2(perUnitDisc * qty));

    subtotal = r2(subtotal + r2(base * qty));
    totalAfter = r2(totalAfter + r2(lineFinal));
    discountTotal = r2(discountTotal + r2(lineDisc));

    rows.push({
      id: Number(it.id),
      productId: it.productId != null ? Number(it.productId) : null,
      name: String(it.name ?? ""),
      qty,
      origUnit: base,
      perUnitDisc,
      effUnit: unit,
      lineDisc,
      lineFinal,
    });
  }

  return {
    subtotal: r2(subtotal),
    discountTotal: r2(discountTotal),
    totalAfter: r2(totalAfter),
    rows,
    hasMissingLineTotals,
  };
}

type DiscountRow = {
  id: number;
  productId?: number | null;
  name: string;
  qty: number;
  origUnit: number; // base (srp/price)
  perUnitDisc: number;
  effUnit: number;
  // (optional) show exact frozen discount when available
  // derived from OrderItem.baseUnitPrice/discountAmount
  lineDisc: number;
  lineFinal: number;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const me = await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  });

  // ─────────────────────────────────────────────
  // 🔒 SHIFT WRITABLE GUARD (loader does writes: lock claim)
  // - NO SHIFT     → redirect to open shift
  // - LOCKED SHIFT → redirect shift console (?locked=1)
  // ─────────────────────────────────────────────
  await assertActiveShiftWritable({
    request,
    next: `${url.pathname}${url.search || ""}`,
  });

  const id = Number(params.id);
  const fromRunIdParam = url.searchParams.get("fromRunId");
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderCode: true,
      channel: true,
      status: true,
      riderName: true,
      createdAt: true,
      dispatchedAt: true,
      deliveredAt: true,
      customerId: true,
      subtotal: true,
      totalBeforeDiscount: true,

      lockedAt: true,
      lockedBy: true,

      // ✅ Option B: roadside representation link (truth lives in RunReceipt)
      originRunReceiptId: true,
      originRunReceipt: {
        select: {
          id: true,
          cashCollected: true,
          runId: true,
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
      },

      items: {
        // ✅ keep only frozen fields stored on OrderItem
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

      payments: true,

      customer: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!order) throw new Response("Not found", { status: 404 });
  if (order.channel !== "DELIVERY")
    throw new Response("Not a delivery order", { status: 400 });
  if (order.status === "PAID")
    throw new Response("Order already settled", { status: 400 });

  // 🔒 Locking logic: i-hold ang order sa current cashier
  const now = new Date();
  const lockExpiresAt = order.lockedAt
    ? new Date(order.lockedAt.getTime() + REMIT_LOCK_TTL_MINUTES * 60 * 1000)
    : null;

  const meId = String(me.userId);
  const isLockedByOther =
    order.lockedAt &&
    order.lockedBy &&
    lockExpiresAt &&
    lockExpiresAt > now &&
    order.lockedBy !== meId;

  if (isLockedByOther) {
    throw new Response(
      "This delivery order is currently being remitted by another cashier.",
      { status: 423 },
    );
  }

  // Either walang lock, expired na, or tayo rin yung huling nag-open ⇒ (re)lock to current cashier
  await db.order.update({
    where: { id: order.id },
    data: { lockedAt: now, lockedBy: meId },
  });

  // 1) roadside representation: originRunReceipt.lines
  const originLines: FrozenLine[] =
    order.originRunReceipt?.lines?.map((ln: any) => ({
      id: Number(ln.id),
      productId: ln.productId != null ? Number(ln.productId) : null,
      name: String(ln.name ?? ""),
      qty: Number(ln.qty ?? 0),
      unitPrice: Number(ln.unitPrice ?? 0),
      lineTotal: Number(ln.lineTotal ?? 0),
      baseUnitPrice: ln.baseUnitPrice != null ? Number(ln.baseUnitPrice) : null,
      discountAmount:
        ln.discountAmount != null ? Number(ln.discountAmount) : null,
    })) ?? [];

  // 2) normal run delivery order: find its PARENT receipt
  const parentReceipt = !order.originRunReceiptId
    ? await db.runReceipt.findFirst({
        where: { kind: "PARENT", parentOrderId: order.id },
        select: {
          id: true,
          cashCollected: true,
          runId: true,
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
      })
    : null;

  const parentLines: FrozenLine[] =
    parentReceipt?.lines?.map((ln: any) => ({
      id: Number(ln.id),
      productId: ln.productId != null ? Number(ln.productId) : null,
      name: String(ln.name ?? ""),
      qty: Number(ln.qty ?? 0),
      unitPrice: Number(ln.unitPrice ?? 0),
      lineTotal: Number(ln.lineTotal ?? 0),
      // Only keep baseUnitPrice if we also have explicit discountAmount.
      // Otherwise we risk showing huge fake discounts in cashier remit.
      baseUnitPrice:
        ln.discountAmount != null && ln.baseUnitPrice != null
          ? Number(ln.baseUnitPrice)
          : null,
      discountAmount:
        ln.discountAmount != null ? Number(ln.discountAmount) : null,
    })) ?? [];

  // 3) fallback legacy: order.items (but keep your SRP/price base display)
  const fallbackLines: FrozenLine[] = ((order.items ?? []) as any[]).map(
    (it) => {
      const qty = Number(it.qty ?? 0);
      const unit = Number(it.unitPrice ?? 0);
      const lineFinal = it.lineTotal != null ? Number(it.lineTotal) : 0;

      const storedBase =
        it.baseUnitPrice != null ? Number(it.baseUnitPrice) : null;
      const storedDisc =
        it.discountAmount != null ? Number(it.discountAmount) : null;

      return {
        id: Number(it.id),
        productId: it.productId != null ? Number(it.productId) : null,
        name: String(it.name ?? ""),
        qty,
        unitPrice: unit,
        lineTotal: lineFinal,
        // IMPORTANT: don't fallback to product.srp/price here; it causes fake huge discounts.
        baseUnitPrice: storedBase != null && storedBase > 0 ? storedBase : null,
        discountAmount: storedDisc,
      };
    },
  );

  const chosenLines =
    originLines.length > 0
      ? originLines
      : parentLines.length > 0
      ? parentLines
      : fallbackLines;

  const discountView = buildDiscountViewFromLines(chosenLines);

  // ✅ Remit must be read-only on totals: require "freeze-first" to exist.
  // IMPORTANT: cashier should consider receipt lines as a valid freeze source.
  const hasFrozenLineTotalsFromItems =
    (order.items ?? []).length > 0 &&
    (order.items as any[]).every((it) => it?.lineTotal != null);
  const hasFrozenFromOrder =
    order.totalBeforeDiscount != null || hasFrozenLineTotalsFromItems;
  const hasFrozenFromReceipts =
    (originLines.length > 0 || parentLines.length > 0) &&
    chosenLines.every((x) => x.lineTotal != null);

  const hasFrozenTotalSafe = Boolean(
    (hasFrozenFromOrder || hasFrozenFromReceipts) &&
      !discountView.hasMissingLineTotals,
  );

  // ✅ Rider expected cash (SOURCE OF TRUTH)
  const orderFinal = Number(discountView.totalAfter ?? 0);
  let riderCash = 0;
  let runId: number | null = null;

  // If roadside order: follow originRunReceipt.cashCollected (truth)
  if (order.originRunReceiptId && order.originRunReceipt) {
    runId = Number(order.originRunReceipt.runId);
    riderCash = Number(order.originRunReceipt.cashCollected ?? 0);
  } else {
    // Normal delivery order: prefer parentReceipt.cashCollected if present (truth after check-in),
    // else fallback to service.
    if (parentReceipt?.id) {
      runId = parentReceipt.runId != null ? Number(parentReceipt.runId) : null;
      riderCash = Number(parentReceipt.cashCollected ?? 0);
    } else {
      const rc = await getRiderCashForDeliveryOrder(db as any, order.id);
      runId = rc.runId ?? null;
      riderCash = Number(rc.riderCash ?? 0);
    }
  }

  riderCash = Math.max(0, Math.min(orderFinal, riderCash));

  const customerName =
    order.customer?.firstName || order.customer?.lastName
      ? [order.customer?.firstName, order.customer?.lastName]
          .filter(Boolean)
          .join(" ")
      : null;

  return json({
    order,
    discountView,
    hasFrozenTotal: hasFrozenTotalSafe,
    riderCash,
    runId,
    fromRunId: fromRunIdParam ? Number(fromRunIdParam) : null,
    ui: {
      customerName,
    },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const me = await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  });

  // ─────────────────────────────────────────────
  // 🔒 SHIFT WRITABLE GUARD
  // action does writes (Payment.create, riderRunVariance.upsert, order.update)
  // ─────────────────────────────────────────────
  const { shiftId: shiftIdForPayment } = await assertActiveShiftWritable({
    request,
    next: `${url.pathname}${url.search || ""}`,
  });

  const id = Number(params.id);
  const fd = await request.formData();

  // Know where we came from (run remit page)
  const fromRunId = (() => {
    const raw = fd.get("fromRunId");
    const n = raw == null ? NaN : Number(raw);
    if (Number.isFinite(n)) return n;
    const qs = url.searchParams.get("fromRunId");
    const qn = qs ? Number(qs) : NaN;
    return Number.isFinite(qn) ? qn : null;
  })();

  const cashGiven = Number(fd.get("cashGiven") || 0);
  const printReceipt = fd.get("printReceipt") === "1";

  // Optional: resolve the delivery run for this order (for redirect after remit)
  const runLink = await db.deliveryRunOrder.findFirst({
    where: { orderId: id },
    select: { runId: true },
  });
  const runId = runLink?.runId ?? null;

  if (!Number.isFinite(cashGiven) || cashGiven < 0) {
    return json(
      { ok: false, error: "Invalid collected cash." },
      { status: 400 },
    );
  }

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      customerId: true,
      riderId: true,
      isOnCredit: true,
      subtotal: true,
      totalBeforeDiscount: true,
      originRunReceiptId: true,
      originRunReceipt: {
        select: { id: true, cashCollected: true, runId: true },
      },
      // riderId is needed for variance ledger
      dispatchedAt: true,
      deliveredAt: true,
      items: {
        select: {
          id: true,
          productId: true,
          name: true,
          qty: true,
          unitPrice: true,
          lineTotal: true, // ✅ freeze-first
          baseUnitPrice: true,
          discountAmount: true,
        },
        orderBy: { id: "asc" },
      },
      payments: {
        select: { id: true, amount: true, method: true, refNo: true },
      },
      lockedAt: true,
      lockedBy: true,
    },
  });

  // ✅ null-guard EARLY (fix: "'order' is possibly 'null'")
  if (!order)
    return json({ ok: false, error: "Order not found" }, { status: 404 });
  if (order.status === "PAID")
    return json({ ok: false, error: "Order already paid" }, { status: 400 });

  // ✅ Prefer RunReceipt frozen totals for remit computations
  // Priority:
  //   (1) originRunReceipt lines (roadside RS order)
  //   (2) parentReceipt lines (normal delivery parent order)
  //   (3) order.items freeze-first fields
  const originReceipt = order.originRunReceiptId
    ? await db.runReceipt.findUnique({
        where: { id: Number(order.originRunReceiptId) },
        select: {
          id: true,
          cashCollected: true,
          runId: true,
          // (optional) if you want customerId etc later
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
      })
    : null;

  const parentReceipt = !order.originRunReceiptId
    ? await db.runReceipt.findFirst({
        where: { kind: "PARENT", parentOrderId: id },
        select: {
          id: true,
          cashCollected: true,
          runId: true,
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
      })
    : null;

  const receiptLines: FrozenLine[] = (
    (originReceipt?.lines?.length
      ? originReceipt.lines
      : parentReceipt?.lines ?? []) as any[]
  ).map((ln: any) => ({
    id: Number(ln.id),
    productId: ln.productId != null ? Number(ln.productId) : null,
    name: String(ln.name ?? ""),
    qty: Number(ln.qty ?? 0),
    unitPrice: Number(ln.unitPrice ?? 0),
    lineTotal: Number(ln.lineTotal ?? 0),
    baseUnitPrice:
      ln.discountAmount != null && ln.baseUnitPrice != null
        ? Number(ln.baseUnitPrice)
        : null,
    discountAmount:
      ln.discountAmount != null ? Number(ln.discountAmount) : null,
  }));

  const finalTotalFromReceipt = hasAllFrozenLineTotals(receiptLines as any)
    ? sumFrozenLineTotals(receiptLines as any)
    : null;

  // 🔒 Guard: huwag payagan kung locked by another cashier (and lock not expired)
  {
    const now = new Date();
    const lockExpiresAt = order.lockedAt
      ? new Date(order.lockedAt.getTime() + REMIT_LOCK_TTL_MINUTES * 60 * 1000)
      : null;
    const meId = String(me.userId);
    const lockedByOther =
      order.lockedAt &&
      order.lockedBy &&
      lockExpiresAt &&
      lockExpiresAt > now &&
      order.lockedBy !== meId;

    if (lockedByOther) {
      return json(
        {
          ok: false,
          error:
            "This delivery order is currently being remitted by another cashier.",
        },
        { status: 409 },
      );
    }
  }

  // ✅ HARD GUARD: Cashier remit should NEVER create/overwrite freeze.
  {
    const hasFrozenLineTotalsFromItems =
      (order.items ?? []).length > 0 &&
      (order.items as any[]).every((it) => it?.lineTotal != null);
    const hasFrozenFromOrder =
      order.totalBeforeDiscount != null || hasFrozenLineTotalsFromItems;
    const hasFrozenFromReceipts =
      receiptLines.length > 0 &&
      receiptLines.every((ln) => ln.lineTotal != null);

    if (!hasFrozenFromOrder && !hasFrozenFromReceipts) {
      return json(
        {
          ok: false,
          error:
            "Totals are not frozen yet. Please complete Manager CHECK-IN first (freeze totals), then remit.",
        },
        { status: 400 },
      );
    }
  }

  // ✅ CASHIER REMIT RULE (non-negotiable):
  // Totals must come ONLY from frozen lineTotal fields:
  //   - RunReceiptLine.lineTotal (roadside/origin or parent receipt), else
  //   - OrderItem.lineTotal (PAD/POS frozen snapshot)
  // No Product.price/srp. No unitKind inference. No pricing engine.
  const finalTotal =
    finalTotalFromReceipt != null
      ? finalTotalFromReceipt
      : r2(
          (order.items ?? []).reduce(
            (s, it) => s + Number((it as any)?.lineTotal ?? 0),
            0,
          ),
        );

  // fix: "Cannot find name 'riderCash'"

  let riderCash = 0;
  // ✅ receipt-based idempotency key
  const receiptIdForTruth: number | null = originReceipt?.id
    ? Number(originReceipt.id)
    : parentReceipt?.id
    ? Number(parentReceipt.id)
    : null;
  let riderRunId: number | null = null;
  if (originReceipt?.id) {
    riderCash = Number(originReceipt.cashCollected ?? 0);
    riderRunId =
      originReceipt.runId != null ? Number(originReceipt.runId) : null;
  } else if (parentReceipt?.id) {
    riderCash = Number(parentReceipt.cashCollected ?? 0);
    riderRunId =
      parentReceipt.runId != null ? Number(parentReceipt.runId) : null;
  } else {
    const rc = await getRiderCashForDeliveryOrder(db as any, order.id);
    riderCash = Number(rc.riderCash ?? 0);
    riderRunId = rc.runId != null ? Number(rc.runId) : null;
  }
  riderCash = Math.max(0, Math.min(finalTotal, riderCash));

  const runIdForTruth =
    riderRunId != null && riderRunId > 0 ? riderRunId : null;

  // ✅ CASH drawer truth only
  const alreadyPaidCash = sumCashPayments(order.payments);
  // ✅ Existing shortage bridge (idempotency guard)
  const alreadyShortageSettled = sumShortageBridgePayments(order.payments);

  // ✅ Run-scope due: riderCash minus payments already recorded (capped)
  const paidForRunBefore = Math.min(alreadyPaidCash, riderCash);
  const dueBeforeRun = Math.max(0, riderCash - paidForRunBefore);

  const appliedPayment = Math.min(Math.max(0, cashGiven), dueBeforeRun);

  // ✅ Shortage-settlement rule (Option B "bridge line"):
  // Only when CUSTOMER is fully paid by rider truth (riderCash == finalTotal),
  // but CASHIER received less cash (appliedPayment < dueBeforeRun).

  // If customer is fully paid (riderCash==finalTotal) but cashier receives less cash,
  // we will add a second NON-CASH settlement line (RIDER_SHORTAGE) to keep ledger balanced.
  const isCustomerFullyPaidByRiderTruth =
    Math.abs(riderCash - finalTotal) <= EPS;
  const shortageForThisRemit = Math.max(0, dueBeforeRun - appliedPayment);
  const canCreateShortageSettlement =
    isCustomerFullyPaidByRiderTruth &&
    shortageForThisRemit > EPS &&
    alreadyShortageSettled <= EPS && // prevent double posting by payments scan
    receiptIdForTruth != null; // ✅ receipt-based flow requires receipt id

  const shortageSettlement = canCreateShortageSettlement
    ? shortageForThisRemit
    : 0;

  // ✅ Customer settlement truth = CASH + BRIDGE (existing + new)
  const customerSettledNow =
    alreadyPaidCash +
    alreadyShortageSettled +
    appliedPayment +
    shortageSettlement;

  const remaining = Math.max(0, finalTotal - customerSettledNow);

  if (remaining > 0 && !order.customerId) {
    return json(
      { ok: false, error: "Link a customer before accepting partial payment." },
      { status: 400 },
    );
  }

  // ✅ Resolve riderId for variance ledger (required by schema)
  // Prefer Order.riderId; else fallback to the run's riderId.
  let resolvedRiderId: number | null =
    order.riderId != null ? Number(order.riderId) : null;
  if (!resolvedRiderId) {
    const runIdCandidate =
      originReceipt?.runId != null
        ? Number(originReceipt.runId)
        : parentReceipt?.runId != null
        ? Number(parentReceipt.runId)
        : runId != null
        ? Number(runId)
        : null;
    if (runIdCandidate) {
      const runRow = await db.deliveryRun.findUnique({
        where: { id: runIdCandidate },
        select: { riderId: true },
      });
      resolvedRiderId = runRow?.riderId != null ? Number(runRow.riderId) : null;
    }
  }
  if (shortageSettlement > EPS && !resolvedRiderId) {
    return json(
      {
        ok: false,
        error: "Cannot create rider shortage variance: missing riderId.",
      },
      { status: 400 },
    );
  }
  if (shortageSettlement > EPS && !runIdForTruth) {
    return json(
      {
        ok: false,
        error: "Cannot create rider shortage variance: missing runId.",
      },
      { status: 400 },
    );
  }

  let createdPaymentId: number | null = null;

  await db.$transaction(async (tx) => {
    // 💵 Record cash payment (MAIN DELIVERY)
    if (appliedPayment > 0) {
      const change = Math.max(0, cashGiven - appliedPayment);
      const p = await tx.payment.create({
        data: {
          orderId: order.id,
          method: "CASH",
          amount: appliedPayment,
          tendered: Number(cashGiven || 0).toFixed(2),
          change: Number(change || 0).toFixed(2),
          refNo: "MAIN-DELIVERY",
          shiftId: shiftIdForPayment,
          cashierId: me.userId,
        },
        select: { id: true },
      });
      createdPaymentId = p.id;
    }

    // ✅ Second settlement line (NON-CASH): Rider shortage bridge
    // This keeps SOA/receipt "fully settled" while cash drawer remains truthful.
    if (shortageSettlement > EPS) {
      await tx.payment.create({
        data: {
          orderId: order.id,
          // ✅ use existing enum (schema-safe)
          method: "INTERNAL_CREDIT" as any,
          amount: shortageSettlement,
          tendered: 0,
          change: 0,
          refNo: `RIDER-SHORTAGE:RR:${Number(receiptIdForTruth)}`, // ok; detector now supports prefix
          shiftId: shiftIdForPayment,
          cashierId: me.userId,
        },
      });

      // ✅ Create/upsert RiderRunVariance at the same time (receipt-based one-time lock)
      const expected = new Prisma.Decimal(Number(riderCash || 0).toFixed(2));
      // ✅ actual must match CASH posted (appliedPayment), not tendered input
      const actual = new Prisma.Decimal(Number(appliedPayment || 0).toFixed(2));
      const variance = new Prisma.Decimal(
        (Number(appliedPayment || 0) - Number(riderCash || 0)).toFixed(2),
      );

      await tx.riderRunVariance.upsert({
        where: { receiptId: Number(receiptIdForTruth) },
        create: {
          receiptId: Number(receiptIdForTruth),
          runId: Number(runIdForTruth),
          riderId: Number(resolvedRiderId),
          shiftId: shiftIdForPayment,
          expected,
          actual,
          variance,
          note: `AUTO: cashier shortage settlement for Order#${order.id}`,
          status: "OPEN" as any,
        },
        update: {
          // keep it OPEN; manager review will decide resolution
          shiftId: shiftIdForPayment,
          expected,
          actual,
          variance,
          note: `AUTO: cashier shortage settlement for Order#${order.id}`,
          status: "OPEN" as any,
        },
      });
    }

    // ✅ Mark PAID if customer is fully settled (cash + bridge).
    if (remaining <= EPS) {
      const receiptNo = await allocateReceiptNo(tx);
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          receiptNo,
          lockedAt: null,
          lockedBy: null,
          dispatchedAt: order.dispatchedAt ?? new Date(),
          deliveredAt: order.deliveredAt ?? new Date(),
          isOnCredit: false,
        },
      });
    } else {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "PARTIALLY_PAID",
          isOnCredit: true,
          lockedAt: null,
          lockedBy: null,
          dispatchedAt: order.dispatchedAt ?? new Date(),
          deliveredAt: order.deliveredAt ?? new Date(),
        },
      });
    }
  });

  // ✅ CASE 1: galing sa run remit page
  if (fromRunId && Number.isFinite(fromRunId)) {
    return redirect(`/cashier/delivery/${fromRunId}`);
  }

  // ✅ CASE 2: standalone remit
  if (printReceipt) {
    const change = Math.max(0, cashGiven - appliedPayment);
    const returnTo = runId ? `/cashier/delivery/${runId}` : "/cashier";

    // Centralized print route:
    // - If order became PAID + receiptNo => OFFICIAL RECEIPT mode
    // - Else => ACK / CREDIT ACK mode (same route decides wording/layout)
    const qs = new URLSearchParams({
      autoprint: "1",
      autoback: "1",
      returnTo,
      cash: cashGiven.toFixed(2),
      change: change.toFixed(2),
    });
    if (createdPaymentId) qs.set("pid", String(createdPaymentId));
    return redirect(`/orders/${id}/receipt?${qs.toString()}`);
  }

  return redirect(runId ? `/cashier/delivery/${runId}` : `/cashier`);
}

export default function RemitOrderPage() {
  const { order, discountView, hasFrozenTotal, riderCash, fromRunId, ui } =
    useLoaderData<typeof loader>();

  const nav = useNavigation();

  const alreadyPaid = sumCashPayments(order.payments ?? []);

  const total = Number(discountView.totalAfter ?? 0);
  const due = Math.max(0, total - alreadyPaid);

  const riderCashSafe = Math.max(0, Math.min(Number(riderCash ?? 0), total));
  const suggested = Math.min(due, riderCashSafe);

  const [cashGivenStr, setCashGivenStr] = React.useState<string>(() =>
    Number.isFinite(suggested) ? suggested.toFixed(2) : "0.00",
  );

  const rows = (discountView.rows ?? []) as DiscountRow[];

  const cashGivenNum = parseMoney(cashGivenStr);

  const willCreateVariance =
    hasFrozenTotal &&
    cashGivenNum + EPS < riderCashSafe && // cashier receives less than rider cash
    riderCashSafe > 0.009;

  const customerLabel =
    ui?.customerName ||
    (order.customerId ? `Customer #${order.customerId}` : "Walk-in / Unknown");

  // 🔒 UI hint: if missing frozen line totals, we should already be blocking "Post Remit"
  // but keep this defensive for visibility.
  const missingLineTotals = Boolean(
    (discountView as any)?.hasMissingLineTotals,
  );

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl px-5 py-6">
        {/* Header */}
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-800">
              Delivery Payment Remit
            </h1>
            <div className="mt-1 text-sm text-slate-500">
              Order{" "}
              <span className="font-mono font-medium text-indigo-700">
                {order.orderCode}
              </span>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
              Customer:{" "}
              <span className="font-medium text-slate-700">
                {customerLabel}
              </span>
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
              Rider:{" "}
              <span className="font-medium text-slate-700">
                {order.riderName || "—"}
              </span>
            </span>
          </div>
        </div>

        {!hasFrozenTotal && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This order is not frozen yet. Please complete Manager CHECK-IN first
            before remitting.
          </div>
        )}

        {missingLineTotals && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Missing frozen line totals on one or more items. Cashier remit is
            read-only and cannot recompute totals — please re-freeze at Manager
            CHECK-IN.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-12">
          {/* LEFT: Items + per-line */}
          <section className="md:col-span-8 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium text-slate-800">Items</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Freeze-first view: base (SRP/Price) → frozen unit → line
                    totals.
                  </p>
                </div>
                <div className="text-right text-xs text-slate-600">
                  <div>
                    Subtotal:{" "}
                    <span className="font-semibold">
                      {peso(discountView.subtotal)}
                    </span>
                  </div>
                  <div>
                    Discounts:{" "}
                    <span className="font-semibold text-rose-600">
                      −{peso(discountView.discountTotal)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-slate-500">
                    No items found.
                  </div>
                ) : (
                  rows.map((r) => {
                    const hasDisc = Number(r.perUnitDisc || 0) > 0.009;
                    return (
                      <div key={r.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800 truncate">
                              {r.name}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              Qty{" "}
                              <span className="font-mono font-semibold text-slate-800">
                                {r.qty}
                              </span>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-sm font-mono font-semibold text-slate-900">
                              {peso(r.lineFinal)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {r.qty} × {peso(r.effUnit)}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                          <span>
                            Base{" "}
                            <span className="font-mono font-semibold">
                              {peso(r.origUnit)}
                            </span>
                          </span>

                          {hasDisc ? (
                            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">
                              Disc −
                              <span className="ml-1 font-mono font-semibold">
                                {peso(r.perUnitDisc)}
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">
                              No discount
                            </span>
                          )}

                          <span>
                            Final unit{" "}
                            <span className="font-mono font-semibold text-slate-800">
                              {peso(r.effUnit)}
                            </span>
                          </span>

                          {hasDisc ? (
                            <span className="text-slate-500">
                              Line disc{" "}
                              <span className="font-mono font-semibold text-rose-700">
                                −{peso(r.lineDisc)}
                              </span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {/* RIGHT: Payment */}
          <section className="md:col-span-4">
            <Form
              method="post"
              className="space-y-4"
              onSubmit={(e) => {
                if (!willCreateVariance) return;
                const ok = window.confirm(
                  "Payment is not exact vs rider collection (cash on hand). This will create a variance for Manager/Rider review. Continue?",
                );
                if (!ok) e.preventDefault();
              }}
            >
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="text-sm font-medium text-slate-800">Totals</h2>
                </div>

                <div className="px-4 py-4 space-y-3 text-sm">
                  <Row label="Subtotal" value={peso(discountView.subtotal)} />
                  <Row
                    label="Discounts"
                    value={`−${peso(discountView.discountTotal)}`}
                    valueClass={
                      discountView.discountTotal > 0
                        ? "text-rose-600 font-semibold"
                        : ""
                    }
                  />
                  <div className="pt-2 border-t border-slate-100">
                    <Row
                      label="Final total"
                      value={peso(discountView.totalAfter)}
                      valueClass="text-slate-900 font-semibold"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-slate-800">
                    Payment
                  </h2>
                  <Link
                    to={
                      fromRunId ? `/cashier/delivery/${fromRunId}` : "/cashier"
                    }
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Back
                  </Link>
                </div>

                <div className="px-4 py-4 space-y-3 text-sm">
                  <Row label="Already paid" value={peso(alreadyPaid)} />
                  <Row
                    label="Due now"
                    value={peso(due)}
                    valueClass="text-indigo-700 font-semibold"
                  />
                  {riderCashSafe > 0 ? (
                    <Row
                      label="Rider cash on hand"
                      value={peso(riderCashSafe)}
                      valueClass="text-emerald-700 font-semibold"
                    />
                  ) : null}

                  {/* preserve context */}
                  {fromRunId != null && Number.isFinite(Number(fromRunId)) ? (
                    <input
                      type="hidden"
                      name="fromRunId"
                      value={Number(fromRunId)}
                    />
                  ) : null}

                  {/* FIX for your error: CurrencyInput Props requires `name` */}
                  <CurrencyInput
                    name="cashGiven_display"
                    label="Cash collected"
                    value={cashGivenStr}
                    onChange={(e) => setCashGivenStr(e.target.value)}
                    placeholder="0.00"
                  />

                  <input
                    type="hidden"
                    name="cashGiven"
                    value={parseMoney(cashGivenStr).toFixed(2)}
                  />

                  <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      name="printReceipt"
                      value="1"
                      className="h-4 w-4 accent-indigo-600"
                      defaultChecked
                    />
                    <span>Go to summary & print after posting</span>
                  </label>

                  <button
                    className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                    disabled={
                      nav.state !== "idle" ||
                      !hasFrozenTotal ||
                      missingLineTotals
                    }
                  >
                    {nav.state !== "idle" ? "Posting…" : "Post Remit"}
                  </button>

                  {!hasFrozenTotal || missingLineTotals ? (
                    <div className="text-xs text-amber-700">
                      ⚠️ Prices are not frozen yet. Manager must CHECK-IN first.
                    </div>
                  ) : null}
                </div>
              </div>
            </Form>
          </section>
        </div>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
