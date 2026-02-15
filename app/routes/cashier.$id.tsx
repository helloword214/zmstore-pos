/* app/routes/cashier.$id.tsx */
/* WALK-IN SETTLEMENT (PICKUP order) — Cashier page for claimLock + settlePayment */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* Patch: taga-sa-bato guard — block cashier settle if any lineTotal is missing (read-only totals). */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { r2, peso } from "~/utils/money";
import {
  useLoaderData,
  useActionData,
  Form,
  useNavigation,
  useRouteError,
  isRouteErrorResponse,
} from "@remix-run/react";
import React, { useMemo } from "react";
import { allocateReceiptNo } from "~/utils/receipt";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";
import { assertActiveShiftWritable } from "~/utils/shiftGuards.server";
import { sumAllPayments, EPS } from "~/services/settlementSoT";

// Lock TTL: 5 minutes (same as queue page)
const LOCK_TTL_MS = 5 * 60 * 1000;

function isMineLock(lockedBy: unknown, meId: string) {
  const v = String(lockedBy ?? "");
  if (!v) return false;
  // ✅ new format
  if (v === meId) return true;
  // ✅ legacy format from old queue
  if (v === `CASHIER-${meId}`) return true;
  return false;
}

// 🔒 Make loader output explicit to avoid union/confusion in useLoaderData<>
type LoaderData = {
  order: any; // (you can narrow later if you like)
  isStale: boolean;
  lockExpiresAt: number | null;
  lockedByLabel: string | null;
  canClaim: boolean;
  meId: string;
};

type FrozenLine = {
  id: number;
  productId?: number | null;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number | null;
  baseUnitPrice?: number | null;
  discountAmount?: number | null; // per-unit discount, if present
};

type DiscountRow = {
  id: number;
  productId?: number | null;
  name: string;
  qty: number;
  origUnit: number; // base
  perUnitDisc: number;
  effUnit: number; // final/frozen unitPrice
  lineDisc: number;
  lineFinal: number; // frozen lineTotal
};

function buildDiscountViewFromLines(linesIn: FrozenLine[]) {
  const rows: DiscountRow[] = [];
  let subtotal = 0;
  let discountTotal = 0;
  let hasMissingLineTotals = false;

  for (const it of linesIn) {
    const qty = Number(it.qty ?? 0);
    const unit = Number(it.unitPrice ?? 0);

    // 🔒 CASHIER RULE: never recompute totals. lineTotal must be frozen.
    const hasLineTotal = it.lineTotal != null;
    const lineFinal = hasLineTotal ? Number(it.lineTotal) : 0;
    if (!hasLineTotal && qty > 0) hasMissingLineTotals = true;

    // IMPORTANT:
    // Cashier should NEVER "infer" discounts from product SRP/price.
    // Only trust frozen snapshot fields when present.
    const base =
      it.baseUnitPrice != null && Number(it.baseUnitPrice) > 0
        ? Number(it.baseUnitPrice)
        : unit; // UI fallback only; not accounting truth.

    const perUnitDisc =
      it.discountAmount != null ? Math.max(0, Number(it.discountAmount)) : 0;

    const lineDisc = Math.max(0, r2(perUnitDisc * qty));

    subtotal = r2(subtotal + r2(base * qty));
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
    rows,
    hasMissingLineTotals,
  };
}

function formatCustomerLabel(c: any) {
  if (!c) return "No customer";
  const full =
    [c.firstName, c.middleName, c.lastName].filter(Boolean).join(" ").trim() ||
    "";
  const alias = c.alias ? ` (${c.alias})` : "";
  const phone = c.phone ? ` • ${c.phone}` : "";
  return `${full || "Customer"}${alias}${phone}`.trim();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const me = await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  }); // 🔒 must have an open shift for money actions

  // ─────────────────────────────────────────────
  // 🔒 STRICT MODE: SHIFT WRITABLE GUARD (NO SHIFT = bawal view, LOCKED = bawal view)
  // - NO SHIFT     → redirect to open shift
  // - LOCKED SHIFT → redirect shift console (?locked=1)
  // ─────────────────────────────────────────────
  await assertActiveShiftWritable({
    request,
    next: `${url.pathname}${url.search || ""}`,
  });

  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });
  const order = await db.order.findFirst({
    where: { id, channel: "PICKUP" },
    include: {
      items: true,
      payments: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          alias: true,
          phone: true,
        },
      },
    },
  });

  if (!order) throw new Response("Not found", { status: 404 });

  // lockedBy is a USER id string (new) or "CASHIER-<id>" (legacy).
  function extractUserIdFromLock(lockedBy: unknown) {
    const v = String(lockedBy ?? "").trim();
    if (!v) return null;
    if (/^\d+$/.test(v)) return Number(v);
    if (v.startsWith("CASHIER-")) {
      const raw = v.slice("CASHIER-".length);
      if (/^\d+$/.test(raw)) return Number(raw);
    }
    return null;
  }

  async function resolveUserLabelFromLock(lockedBy: unknown) {
    const userId = extractUserIdFromLock(lockedBy);
    if (!userId) return null;
    const u = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true, alias: true } },
      },
    });
    if (!u) return null;
    const emp = u.employee;
    return (
      emp?.alias ||
      [emp?.firstName, emp?.lastName].filter(Boolean).join(" ") ||
      u.email ||
      `User#${u.id}`
    );
  }

  // 🔒 READ-ONLY LOADER (NO WRITES)
  // We only *report* lock state here.
  // Lock claiming must be explicit via POST action to avoid "accidental locks"
  // ─────────────────────────────────────────────
  const meId = String(me.userId);
  const nowMs = Date.now();
  const lockExpiresAtMs = order.lockedAt
    ? order.lockedAt.getTime() + LOCK_TTL_MS
    : null;

  const hasFreshLock =
    !!order.lockedAt &&
    !!order.lockedBy &&
    lockExpiresAtMs != null &&
    lockExpiresAtMs > nowMs;

  const isOtherFresh = hasFreshLock && !isMineLock(order.lockedBy, meId);

  const lockedByLabel = order.lockedBy
    ? await resolveUserLabelFromLock(order.lockedBy)
    : null;

  // Stale = lock exists but already expired
  const isStale = !!order.lockedAt && !!order.lockedBy && !hasFreshLock;
  const lockExpiresAt = hasFreshLock ? lockExpiresAtMs : null;

  // You can claim if: unlocked OR expired OR mine
  const canClaim = !isOtherFresh;

  return json<LoaderData>({
    order,
    isStale,
    lockExpiresAt,
    lockedByLabel,
    canClaim,
    meId,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  // Get the logged-in cashier with a verified open shift

  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return json({ ok: false, error: "Invalid ID" }, { status: 400 });
  }
  const url = new URL(request.url);
  const me = await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  });
  const fd = await request.formData();
  const act = String(fd.get("_action") || "");

  // NOTE: any action here may write, so shift must be writable when it matters.
  // ─────────────────────────────────────────────
  // 🔒 STRICT MODE: NO SHIFT / LOCKED SHIFT = bawal kahit VIEW-ACTIONS dito.
  // We guard ALL actions (reprint/release/claim/settle) so off-duty cashier cannot interact.
  // ─────────────────────────────────────────────
  await assertActiveShiftWritable({
    request,
    next: `${url.pathname}${url.search || ""}`,
  });

  if (act === "reprint") {
    await db.order.update({
      where: { id },
      data: { printCount: { increment: 1 }, printedAt: new Date() },
    });
    // Centralized print route (handles OR / ACK / CREDIT based on order state)
    const qs = new URLSearchParams({
      autoprint: "1",
      autoback: "1",
      returnTo: `${url.pathname}${url.search || ""}`,
    });
    return redirect(`/orders/${id}/receipt?${qs.toString()}`);
  }
  if (act === "release") {
    await db.order.update({
      where: { id },
      data: { lockedAt: null, lockedBy: null },
    });
    return redirect("/cashier");
  }

  if (act === "claimLock") {
    // already guarded above (strict)

    const order = await db.order.findUnique({
      where: { id },
      select: {
        id: true,
        lockedAt: true,
        lockedBy: true,
        channel: true,
      },
    });
    if (!order)
      return json({ ok: false, error: "Order not found" }, { status: 404 });
    if (order.channel !== "PICKUP") {
      return json(
        { ok: false, error: "This page is for WALK-IN orders only." },
        { status: 400 },
      );
    }

    const meId = String(me.userId);
    const nowMs = Date.now();
    const lockExpiresAtMs = order.lockedAt
      ? order.lockedAt.getTime() + LOCK_TTL_MS
      : null;
    const hasFreshLock =
      !!order.lockedAt &&
      !!order.lockedBy &&
      lockExpiresAtMs != null &&
      lockExpiresAtMs > nowMs;

    if (hasFreshLock && !isMineLock(order.lockedBy, meId)) {
      return json(
        {
          ok: false,
          error:
            "This order is currently locked by another cashier. Please wait for the lock to expire or ask them to release it.",
        },
        { status: 409 },
      );
    }

    await db.order.update({
      where: { id: order.id },
      data: { lockedAt: new Date(), lockedBy: meId },
    });

    return redirect(`${url.pathname}${url.search || ""}`);
  }

  if (act === "settlePayment") {
    const cashGiven = Number(fd.get("cashGiven") || 0);
    const printReceipt = fd.get("printReceipt") === "1";
    const releaseWithBalance = fd.get("releaseWithBalance") === "1";
    const releasedApprovedBy =
      String(fd.get("releaseApprovedBy") || "").trim() || null;

    // ─────────────────────────────────────────────
    // 🔒 SHIFT WRITABLE GUARD (SoT + audit safety)
    // - NO SHIFT     → redirect to open shift
    // - LOCKED SHIFT → redirect shift console (?locked=1)
    // ─────────────────────────────────────────────
    // already guarded above (strict), but we still need shiftId for audit tagging
    const { shiftId: shiftIdForPayment } = await assertActiveShiftWritable({
      request,
      next: `${url.pathname}${url.search || ""}`,
    });

    // Cashier requires an actual payment (> 0). Full utang is a separate flow.
    if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
      return json(
        {
          ok: false,
          error: "Enter cash > 0. For full utang, use “Record as Credit”.",
        },
        { status: 400 },
      );
    }

    // Load order (with items + payments for running balance)
    const order = await db.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
      },
    });
    if (!order)
      return json({ ok: false, error: "Order not found" }, { status: 404 });
    // Strict WALK-IN only
    if (order.channel !== "PICKUP") {
      return json(
        { ok: false, error: "This page is for WALK-IN orders only." },
        { status: 400 },
      );
    }
    if (order.status !== "UNPAID" && order.status !== "PARTIALLY_PAID") {
      return json(
        { ok: false, error: "Order is already settled/voided" },
        { status: 400 },
      );
    }

    // 🔒 Require lock before settlement (explicit step prevents accidental locks)
    // If no fresh lock OR not mine, block and ask to "Start settlement".
    // (Still safe under concurrency because we re-check below.)

    // ─────────────────────────────────────────────
    // 🔒 SERVER-SIDE LOCK GUARD (no UI-only stale)
    // Rule:
    // - If locked by someone else AND lock is still fresh => BLOCK
    // - If unlocked OR expired OR locked by me => allow and (re)claim lock
    // ─────────────────────────────────────────────
    const meId = String(me.userId);
    const nowMs = Date.now();
    const lockExpiresAtMs = order.lockedAt
      ? order.lockedAt.getTime() + LOCK_TTL_MS
      : null;
    const hasFreshLock =
      !!order.lockedAt &&
      !!order.lockedBy &&
      lockExpiresAtMs != null &&
      lockExpiresAtMs > nowMs;

    if (!hasFreshLock || !isMineLock(order.lockedBy, meId)) {
      return json(
        {
          ok: false,
          error:
            "Please click “Start settlement” first to claim the lock before posting a payment.",
        },
        { status: 409 },
      );
    }

    // NOTE: the check above already covers "fresh but not mine".
    // Keep only one lock guard to avoid confusion and unreachable branches.

    // (no re-claim here; lock is claimed explicitly via claimLock)

    // ✅ HARD GUARD (taga-sa-bato):
    // Cashier settlement is READ-ONLY on totals.
    // If any lineTotal is missing, cashier must NOT proceed (no recompute, no infer).
    const hasFrozenLineTotals =
      (order.items ?? []).length > 0 &&
      (order.items as any[]).every((it) => it?.lineTotal != null);

    if (!hasFrozenLineTotals) {
      return json(
        {
          ok: false,
          error:
            "Totals are not frozen yet (missing line totals). Please finalize/freeze this order first before cashier settlement.",
        },
        { status: 400 },
      );
    }

    // ✅ CUSTOMER IS READ-ONLY AT CASHIER (SoT).
    const effectiveCustomerId = order.customerId ?? null;

    // ✅ WALK-IN settlement truth: ALL payments count against remaining balance
    const alreadyPaid = sumAllPayments(order.payments);

    // ✅ CASHIER RULE: use ONLY frozen line totals for payable total.
    // (Cashier is read-only on totals; do not recompute.)
    const total = r2(
      (order.items ?? []).reduce(
        (s: number, it: any) => s + Number(it?.lineTotal ?? 0),
        0,
      ),
    );

    const productIds = Array.from(new Set(order.items.map((i) => i.productId)));
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        stock: true, // packs (pre-check only; final enforcement happens in tx)
        packingStock: true, // retail units (pre-check only; final enforcement happens in tx)
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const dueBefore = Math.max(0, total - alreadyPaid);
    const appliedPayment = Math.min(Math.max(0, cashGiven), dueBefore);
    const change = Math.max(0, cashGiven - appliedPayment);
    const nowPaid = alreadyPaid + appliedPayment;
    const remaining = Math.max(0, total - nowPaid);

    // For utang/partial balance, require a customer to carry the balance
    if (remaining > 0 && !effectiveCustomerId) {
      return json(
        {
          ok: false,
          error:
            "This order has a remaining balance but has no customer attached. Customer is read-only at cashier — please attach a customer in the order/PAD flow first.",
        },
        { status: 400 },
      );
    }
    // If releasing goods with balance, require manager approval note
    if (remaining > 0 && releaseWithBalance && !releasedApprovedBy) {
      return json(
        {
          ok: false,
          error: "Manager PIN/Name is required to release with balance.",
        },
        { status: 400 },
      );
    }

    // Build deltas (retail vs pack) using robust price inference
    const errors: Array<{ id: number; reason: string }> = [];
    const deltas = new Map<number, { pack: number; retail: number }>();

    for (const it of order.items) {
      const p = byId.get(it.productId);
      if (!p) {
        errors.push({ id: it.productId, reason: "Product missing" });
        continue;
      }
      const qty = Number(it.qty);

      const packStock = Number(p.stock ?? 0);
      const retailStock = Number(p.packingStock ?? 0);

      // 🔒 Unit source of truth: OrderItem.unitKind (frozen)
      const unitKind = String((it as any).unitKind || "PACK");
      if (unitKind === "RETAIL") {
        if (qty > retailStock) {
          errors.push({
            id: it.productId,
            reason: `Not enough retail stock (${retailStock} available)`,
          });
          continue;
        }
        const c = deltas.get(p.id) ?? { pack: 0, retail: 0 };
        c.retail += qty;
        deltas.set(p.id, c);
      } else {
        if (qty > packStock) {
          errors.push({
            id: it.productId,
            reason: `Not enough pack stock (${packStock} available)`,
          });
          continue;
        }
        const c = deltas.get(p.id) ?? { pack: 0, retail: 0 };
        c.pack += qty;
        deltas.set(p.id, c);
      }
    }

    // WALK-IN/PICKUP: deduct stock only when fully paid OR released with balance.
    const willDeductNow =
      remaining <= EPS || (releaseWithBalance && !order.releasedAt);

    if (errors.length && willDeductNow) {
      return json({ ok: false, errors }, { status: 400 });
    }

    let createdPaymentId: number | null = null;

    // Perform everything atomically
    await db.$transaction(async (tx) => {
      // 1) Record payment actually applied against the balance
      if (appliedPayment > 0) {
        const p = await tx.payment.create({
          data: {
            orderId: order.id,
            method: "CASH",
            amount: appliedPayment,
            // 🔎 Audit tags for shift tracing:
            cashierId: me.userId, // who processed
            // ✅ Always tag to an ACTIVE + WRITABLE shift (guarded above)
            shiftId: shiftIdForPayment,
            // 🧾 What happened at the till:
            tendered: cashGiven.toFixed(2),
            change: change.toFixed(2),
          },
          select: { id: true },
        });
        createdPaymentId = p.id;
      }

      // 2) Deduct inventory only when needed (see rule above)
      if (willDeductNow) {
        for (const [pid, c] of deltas.entries()) {
          // ✅ Atomic decrement to avoid stale overwrite
          // ✅ Enforce "gte" using updateMany so we can detect insufficient stock under concurrency
          const res = await tx.product.updateMany({
            where: {
              id: pid,
              stock: { gte: c.pack },
              packingStock: { gte: c.retail },
            },
            data: {
              stock: { decrement: c.pack },
              packingStock: { decrement: c.retail },
            },
          });
          if (res.count !== 1) {
            // Either missing product or not enough stock (race-safe)
            throw new Error(
              `Insufficient stock while deducting (product #${pid}). Please refresh and retry.`,
            );
          }
        }
      }

      // 3) Update order status & fields
      if (remaining <= EPS) {
        // Fully paid
        const receiptNo = await allocateReceiptNo(tx);
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "PAID",
            paidAt: new Date(),
            receiptNo,
            lockedAt: null,
            lockedBy: null,
            // If this full payment also did a release now, persist release metadata.
            ...(releaseWithBalance && !order.releasedAt
              ? {
                  releaseWithBalance: true,
                  releasedApprovedBy,
                  releasedAt: new Date(),
                }
              : {}),
          },
        });
      } else {
        // Partial payment
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "PARTIALLY_PAID",
            isOnCredit: true,
            lockedAt: null,
            lockedBy: null,
            ...(releaseWithBalance && !order.releasedAt
              ? {
                  releaseWithBalance: true,
                  releasedApprovedBy,
                  releasedAt: new Date(),
                }
              : {}),
          },
        });
      }
    });

    // Navigate
    if (printReceipt) {
      // Centralized print route:
      // - Fully paid (PAID + receiptNo) => OFFICIAL RECEIPT
      // - Partial payment (PARTIALLY_PAID / isOnCredit) => ACK mode
      // - Full credit (no payment) is handled by /orders/:id/credit flow, not here
      const qs = new URLSearchParams({
        autoprint: "1",
        autoback: "1",
        returnTo: "/cashier",
      });
      if (createdPaymentId) qs.set("pid", String(createdPaymentId));
      // Always pass what happened at the till (customer-facing)
      qs.set("cash", cashGiven.toFixed(2));
      qs.set("change", Math.max(0, cashGiven - appliedPayment).toFixed(2));
      return redirect(`/orders/${id}/receipt?${qs.toString()}`);
    }

    // Otherwise just go back to queue (ensures we don't fall through)
    return redirect("/cashier");
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CashierOrder() {
  const { order, isStale, lockExpiresAt, lockedByLabel, canClaim, meId } =
    useLoaderData<LoaderData>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [printReceipt, setPrintReceipt] = React.useState(true); // default: checked like order-pad toggle
  // Cash input + change preview
  const [cashGiven, setCashGiven] = React.useState("");

  const [remaining, setRemaining] = React.useState(
    lockExpiresAt ? lockExpiresAt - Date.now() : 0,
  );

  // ...inside CashierOrder component (top of render state)

  React.useEffect(() => {
    if (actionData && (actionData as any).redirectToReceipt) {
      window.location.assign((actionData as any).redirectToReceipt);
    }
  }, [actionData]);
  React.useEffect(() => {
    if (!lockExpiresAt) return;
    const id = setInterval(() => {
      setRemaining(lockExpiresAt - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [lockExpiresAt]);

  // ---------------------------------------------------------

  // Build DiscountView (like delivery-remit) from frozen OrderItem fields
  const discountView = useMemo(() => {
    const lines: FrozenLine[] = ((order.items ?? []) as any[]).map((it) => ({
      id: Number(it.id),
      productId: it.productId != null ? Number(it.productId) : null,
      name: String(it.name ?? ""),
      qty: Number(it.qty ?? 0),
      unitPrice: Number(it.unitPrice ?? 0),
      lineTotal: it.lineTotal != null ? Number(it.lineTotal) : null,
      // Keep base only if explicitly stored (avoid fake huge discounts).
      baseUnitPrice:
        it.baseUnitPrice != null && Number(it.baseUnitPrice) > 0
          ? Number(it.baseUnitPrice)
          : null,
      discountAmount:
        it.discountAmount != null ? Number(it.discountAmount) : null,
    }));
    return buildDiscountViewFromLines(lines);
  }, [order.items]);

  // ✅ YOU MISSED THIS LINE (fixes "Cannot find name 'rows'")
  const rows = (discountView.rows ?? []) as DiscountRow[];

  const missingLineTotals = Boolean(
    (discountView as any)?.hasMissingLineTotals,
  );

  // 🔢 Use discounted total for payment figures (UI)
  // ✅ WALK-IN settlement truth: ALL payments count against remaining balance
  const alreadyPaid = sumAllPayments(order.payments);
  const entered = Number(cashGiven) || 0;
  // ✅ “taga-sa-bato” alignment:
  // UI payment math should also be based on frozen line totals (same as action)
  const effectiveTotal = r2(
    (order.items ?? []).reduce(
      (s: number, it: any) => s + Number(it?.lineTotal ?? 0),
      0,
    ),
  );
  const dueBefore = Math.max(0, effectiveTotal - alreadyPaid);
  const changePreview = entered > 0 ? Math.max(0, entered - dueBefore) : 0;
  const balanceAfterThisPayment = Math.max(
    0,
    effectiveTotal - alreadyPaid - entered,
  );
  const willBePartial = balanceAfterThisPayment > 0;
  const hasCustomer = Boolean(order.customerId);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Page header */}
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                Order{" "}
                <span className="font-mono text-indigo-700">
                  {order.orderCode}
                </span>
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ring-1 ${
                    order.lockedBy
                      ? "bg-amber-50 text-amber-700 ring-amber-200"
                      : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                  {order.lockedBy
                    ? `Locked by ${lockedByLabel ?? order.lockedBy}`
                    : "Unlocked"}
                  {!!order.lockedAt && isStale && (
                    <span className="ml-1 opacity-70">• stale</span>
                  )}
                </span>

                {!isStale && typeof remaining === "number" && remaining > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 ring-1 ring-slate-200">
                    Lock expires in{" "}
                    <span className="font-mono tabular-nums">
                      {String(
                        Math.max(0, Math.floor(remaining / 60000)),
                      ).padStart(2, "0")}
                      :
                      {String(
                        Math.max(0, Math.floor((remaining % 60000) / 1000)),
                      ).padStart(2, "0")}
                    </span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Form method="post">
                <input type="hidden" name="_action" value="claimLock" />
                <button
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 active:shadow-none disabled:opacity-50"
                  disabled={!canClaim || nav.state !== "idle"}
                  title={
                    !canClaim
                      ? "Locked by another cashier"
                      : "Claim lock to start settlement"
                  }
                >
                  Start settlement
                </button>
              </Form>
              <Form method="post">
                <input type="hidden" name="_action" value="reprint" />
                <button className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 active:shadow-none">
                  Reprint
                </button>
              </Form>
              <Form method="post">
                <input type="hidden" name="_action" value="release" />
                <button className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 active:shadow-none">
                  Release
                </button>
              </Form>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-5 py-6">
        {missingLineTotals ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Missing frozen line totals on one or more items. Cashier settlement
            is read-only and cannot recompute totals — please finalize/freeze
            the order first.
          </div>
        ) : null}
        {/* Content grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left: items */}
          <section className="lg:col-span-2">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <h2 className="text-sm font-medium tracking-wide text-slate-700">
                    Items
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Freeze-first view: base → frozen unit → line totals.
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
                      <div
                        key={r.id}
                        className="px-4 py-3 hover:bg-slate-50/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate text-sm font-medium text-slate-900">
                                {r.name}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-slate-600">
                              Qty{" "}
                              <span className="font-mono font-semibold text-slate-800">
                                {r.qty}
                              </span>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-sm font-semibold text-slate-900 font-mono">
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

              {/* Totals panel */}
              <div className="mt-2 border-t border-slate-100 bg-slate-50/50 px-4 py-3 space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="font-medium text-slate-900">
                    {peso(discountView.subtotal)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-rose-700">Discounts</span>
                  <span className="font-medium text-rose-700">
                    −{peso(discountView.discountTotal)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm font-semibold text-indigo-700">
                  <span>Total payable (frozen)</span>
                  <span>{peso(effectiveTotal)}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Right: payment card (simplified) */}
          <aside className="lg:col-span-1">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-medium tracking-wide text-slate-800">
                  Payment
                </h3>
                {hasCustomer ? (
                  <a
                    href={`/orders/${order.id}/credit?returnTo=/cashier/${order.id}`}
                    className="text-xs text-indigo-600 hover:underline"
                    title="Record this as full utang / credit without taking payment"
                  >
                    Record as Credit
                  </a>
                ) : (
                  <span
                    className="text-xs text-slate-400"
                    title="Attach a customer first to allow utang/credit."
                  >
                    Record as Credit
                  </span>
                )}
              </div>

              {/* Notices */}
              <div className="px-4 pt-4 space-y-2">
                {actionData &&
                "errors" in actionData &&
                actionData.errors?.length ? (
                  <ul className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {actionData.errors.map((e: any, i: number) => (
                      <li key={i}>
                        Product #{e.id}: {e.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {actionData &&
                "error" in actionData &&
                (actionData as any).error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {(actionData as any).error}
                  </div>
                ) : null}
              </div>

              {/* Form */}
              <Form
                id="settle-form"
                method="post"
                className="px-4 pb-4 mt-3 space-y-4"
              >
                <input type="hidden" name="_action" value="settlePayment" />
                {/* Totals strip */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-600">Due now</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(dueBefore)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-600">
                      Already paid
                    </div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(alreadyPaid)}
                    </div>
                  </div>
                </div>

                {/* Customer (READ-ONLY at cashier) */}
                <div>
                  <label className="block text-sm text-slate-700 mb-1">
                    Customer
                  </label>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                    {formatCustomerLabel((order as any).customer)}
                  </div>
                  {willBePartial && !hasCustomer ? (
                    <div className="mt-1 text-xs text-amber-800">
                      Balance will remain after this payment, but this order has
                      no customer attached. Customer is read-only at cashier —
                      attach a customer in the order/PAD flow first.
                    </div>
                  ) : null}{" "}
                </div>

                {/* Cash input + print toggle */}
                <div className="grid grid-cols-1 gap-3">
                  <label className="block">
                    <span className="block text-sm text-slate-700">
                      Cash received
                    </span>
                    <input
                      name="cashGiven"
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashGiven}
                      onChange={(e) => setCashGiven(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                      placeholder="0.00"
                      inputMode="decimal"
                      autoFocus
                    />
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      name="printReceipt"
                      value="1"
                      checked={printReceipt}
                      onChange={(e) => setPrintReceipt(e.target.checked)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span>Print receipt</span>
                  </label>
                </div>

                {/* Live previews */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-600">
                      Change (preview)
                    </div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(changePreview)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-[11px] text-slate-600">
                      Balance after
                    </div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-PH", {
                        style: "currency",
                        currency: "PHP",
                      }).format(balanceAfterThisPayment)}
                    </div>
                  </div>
                </div>

                {/* Advanced options */}
                <details className="rounded-xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer select-none list-none px-3 py-2 text-sm text-slate-800">
                    Advanced options
                  </summary>
                  <div className="px-3 pb-3 space-y-3">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="releaseWithBalance"
                        value="1"
                        className="h-4 w-4 accent-indigo-600"
                      />
                      <span>Release goods now (with balance)</span>
                    </label>
                    <label className="block text-xs text-slate-600">
                      Manager PIN/Name (for release)
                      <input
                        name="releaseApprovedBy"
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                        placeholder="e.g. 1234 or MGR-ANA"
                      />
                    </label>
                  </div>
                </details>

                {/* Primary submit */}
                <button
                  type="submit"
                  className="mt-1 inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-50"
                  disabled={
                    isStale ||
                    nav.state !== "idle" ||
                    (willBePartial && !hasCustomer) ||
                    missingLineTotals ||
                    !order.lockedBy || // must have lock
                    !isMineLock(order.lockedBy, meId) // must be MY lock
                  }
                  title={
                    isStale
                      ? "Lock is stale; re-open from queue"
                      : missingLineTotals
                      ? "Totals not frozen yet"
                      : willBePartial
                      ? "Record partial payment"
                      : "Submit payment"
                  }
                >
                  {nav.state !== "idle"
                    ? "Completing…"
                    : printReceipt
                    ? willBePartial
                      ? "Complete & Print Ack"
                      : "Complete & Print Receipt"
                    : "Complete Sale"}
                </button>
              </Form>
            </div>
          </aside>
        </div>
      </div>

      {/* Sticky action footer for mobile comfort */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 backdrop-blur px-5 py-3">
        <div className="mx-auto max-w-4xl">
          <button
            type="submit"
            form="settle-form"
            className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            disabled={
              isStale ||
              nav.state !== "idle" ||
              (willBePartial && !hasCustomer) ||
              missingLineTotals ||
              !order.lockedBy ||
              !isMineLock(order.lockedBy, meId)
            }
            title={
              isStale
                ? "Lock is stale; re-open from queue"
                : missingLineTotals
                ? "Totals not frozen yet"
                : willBePartial
                ? "Record partial payment"
                : "Mark as PAID"
            }
          >
            {nav.state !== "idle"
              ? "Completing…"
              : printReceipt
              ? willBePartial
                ? "Complete & Print Ack"
                : "Complete & Print Receipt"
              : "Complete Sale"}
          </button>
        </div>
      </div>
    </main>
  );
}

// Route-level Error Boundary using useRouteError()
export function ErrorBoundary() {
  const error = useRouteError();
  // Helpful console for dev; no-op in production logs.
  // eslint-disable-next-line no-console
  console.error("Cashier route error:", error);

  let title = "Unknown error";
  let message = "No additional details were provided.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    title = `HTTP ${error.status} ${error.statusText}`;
    message =
      typeof error.data === "string"
        ? error.data
        : JSON.stringify(error.data, null, 2);
  } else if (error instanceof Error) {
    title = `${error.name || "Error"}: ${error.message || "Unknown error"}`;
    message = error.message || "An unexpected error occurred.";
    stack = error.stack;
  } else if (error) {
    try {
      message = JSON.stringify(error, null, 2);
    } catch {
      message = String(error);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="rounded-2xl border border-red-200 bg-white shadow-sm">
          <div className="border-b border-red-100 bg-red-50/60 px-4 py-3">
            <h1 className="text-base font-semibold text-red-800">
              Something went wrong on this page
            </h1>
          </div>
          <div className="px-4 py-4 space-y-3">
            <p className="text-sm text-slate-700">
              If this happened after clicking a name or link, a render error may
              have been thrown. Details:
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-mono text-slate-800 whitespace-pre-wrap break-words">
                {title}
              </div>
            </div>
            {message ? (
              <details
                className="rounded-lg border border-slate-200 bg-slate-50"
                open
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-slate-700">
                  Error details
                </summary>
                <pre className="px-3 py-2 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                  {message}
                </pre>
              </details>
            ) : null}
            {stack ? (
              <details className="rounded-lg border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-slate-700">
                  Stack trace
                </summary>
                <pre className="px-3 py-2 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                  {stack}
                </pre>
              </details>
            ) : null}
            <div className="pt-2">
              <a
                href="/cashier"
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              >
                ← Back to Cashier
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
