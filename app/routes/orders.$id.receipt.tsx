/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

const EPS = 0.009;

type ClearanceDecisionKindUI =
  | "APPROVE_OPEN_BALANCE"
  | "APPROVE_DISCOUNT_OVERRIDE"
  | "APPROVE_HYBRID"
  | "REJECT";

const parseDecisionKind = (raw: unknown): ClearanceDecisionKindUI | null =>
  raw === "REJECT"
    ? "REJECT"
    : raw === "APPROVE_OPEN_BALANCE"
    ? "APPROVE_OPEN_BALANCE"
    : raw === "APPROVE_DISCOUNT_OVERRIDE"
    ? "APPROVE_DISCOUNT_OVERRIDE"
    : raw === "APPROVE_HYBRID"
    ? "APPROVE_HYBRID"
    : null;

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["CASHIER", "ADMIN"]);
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const url = new URL(request.url);

  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: true,
      // Prefer latest payment first for tendered/change display
      payments: { orderBy: { id: "desc" } },
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
  const receiptKey = `PARENT:${order.id}`;
  const clearanceCase = await db.clearanceCase.findUnique({
    where: { receiptKey } as any,
    select: {
      id: true,
      status: true,
      decisions: {
        select: {
          kind: true,
          arBalance: true,
          overrideDiscountApproved: true,
          customerAr: {
            select: {
              principal: true,
              balance: true,
            },
          },
        },
        orderBy: { id: "desc" },
        take: 1,
      },
    },
  });

  const customerName = (() => {
    const c: any = order.customer;
    if (!c) return null;
    const full = [c.firstName, c.middleName, c.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const base = full || (c.alias ? String(c.alias) : "") || null;
    if (!base) return null;
    return c.alias && full ? `${full} (${c.alias})` : base;
  })();

  // Optional: highlight a specific payment (e.g., the one just created)
  const pidParam = url.searchParams.get("pid");
  const pid = pidParam ? Number(pidParam) : NaN;

  const featuredPayment = (() => {
    if (Number.isFinite(pid) && pid > 0) {
      const p = (order.payments ?? []).find((x: any) => Number(x.id) === pid);
      if (p) return p;
    }
    return (order.payments ?? [])[0] ?? null; // latest
  })();

  // Read cash/change passed by caller (optional; preferred for printing)
  const cashParam = Number(url.searchParams.get("cash"));
  const changeParam = Number(url.searchParams.get("change"));
  const tenderedParam = Number(url.searchParams.get("tendered"));
  const cash =
    Number.isFinite(cashParam) && cashParam >= 0
      ? Math.max(0, cashParam)
      : Number.isFinite(tenderedParam) && tenderedParam >= 0
      ? Math.max(0, tenderedParam)
      : null;
  const changeFromQuery =
    Number.isFinite(changeParam) && changeParam >= 0
      ? Math.max(0, changeParam)
      : null;

  // ─────────────────────────────────────────────
  // 🔒 RECEIPT SoT: show ONLY frozen snapshot fields
  // No discount engine, no recompute from product SRP/price.
  // ─────────────────────────────────────────────
  const lines: FrozenLine[] = (order.items ?? []).map((it: any) => ({
    id: Number(it.id),
    name: String(it.name ?? ""),
    qty: Number(it.qty ?? 0),
    unitPrice: Number(it.unitPrice ?? 0),
    lineTotal:
      it.lineTotal != null && Number.isFinite(Number(it.lineTotal))
        ? Number(it.lineTotal)
        : 0,
    baseUnitPrice:
      it.baseUnitPrice != null && Number(it.baseUnitPrice) > 0
        ? Number(it.baseUnitPrice)
        : null,
    discountAmount:
      it.discountAmount != null && Number(it.discountAmount) > 0
        ? Number(it.discountAmount)
        : null,
    unitKind: it.unitKind != null ? String(it.unitKind) : null,
  }));

  const hasMissingLineTotals =
    lines.length > 0 &&
    (order.items ?? []).some((it: any) => it?.lineTotal == null);

  // Display totals:
  // - totalPayable is frozen sum(lineTotal)
  // - subtotal/discount are "best effort display" from stored snapshots (if present)
  const totalPayable = lines.reduce((s, l) => s + Number(l.lineTotal || 0), 0);
  const subtotal = lines.reduce((s, l) => {
    const base =
      l.baseUnitPrice != null && Number.isFinite(l.baseUnitPrice)
        ? Number(l.baseUnitPrice)
        : Number(l.unitPrice || 0); // UI fallback only (not truth)
    return s + base * Number(l.qty || 0);
  }, 0);
  const discountTotal = lines.reduce((s, l) => {
    const perUnit = l.discountAmount != null ? Number(l.discountAmount) : 0;
    return s + perUnit * Number(l.qty || 0);
  }, 0);

  // Payments breakdown (customer-facing settled truth)
  const payments = (order.payments ?? []) as any[];
  const paidToDate = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remainingRaw = Math.max(
    0,
    Number(totalPayable || 0) - Number(paidToDate || 0),
  );
  const latestDecision = clearanceCase?.decisions?.[0];
  const decisionKind = parseDecisionKind(latestDecision?.kind);
  const decisionArAmount = Math.max(0, Number(latestDecision?.arBalance ?? 0));
  const approvedArAmount = Math.max(
    0,
    Number(
      latestDecision?.customerAr?.principal ??
        latestDecision?.customerAr?.balance ??
        decisionArAmount,
    ),
  );
  const approvedClearanceDiscount = Math.max(
    0,
    Number(latestDecision?.overrideDiscountApproved ?? 0),
  );
  const appliedClearanceDiscount =
    clearanceCase?.status === "DECIDED" && decisionKind !== "REJECT"
      ? Math.min(remainingRaw, approvedClearanceDiscount)
      : 0;
  const transferredToAr =
    clearanceCase?.status === "DECIDED" && decisionKind !== "REJECT"
      ? Math.min(Math.max(0, remainingRaw - appliedClearanceDiscount), approvedArAmount)
      : 0;
  const remaining = Math.max(
    0,
    remainingRaw - appliedClearanceDiscount - transferredToAr,
  );

  const isCash = (p: any) => String(p?.method ?? "").toUpperCase() === "CASH";
  const paidCash = payments
    .filter(isCash)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const paidNonCash = payments
    .filter((p) => !isCash(p))
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  type PrintMode =
    | "OFFICIAL_RECEIPT"
    | "PAYMENT_ACK"
    | "CREDIT_ACK"
    | "AR_PAYMENT_ACK"
    | "SETTLEMENT_SUMMARY";

  const mode: PrintMode = (() => {
    const hasFeatured = !!featuredPayment;
    const isFullySettled = remaining <= EPS;
    const hasArTransfer = transferredToAr > EPS;

    if (hasFeatured && hasArTransfer) {
      return "AR_PAYMENT_ACK";
    }

    // Official Receipt requires receiptNo + PAID (your rule)
    if (isFullySettled && order.status === "PAID" && order.receiptNo) {
      return "OFFICIAL_RECEIPT";
    }

    // Fully settled but missing receiptNo/status? (rare) show safe summary instead of 400.
    if (isFullySettled && (!order.receiptNo || order.status !== "PAID")) {
      return "SETTLEMENT_SUMMARY";
    }

    // A/R payment acknowledgment: payment exists + marked on credit (or still has balance)
    if (hasFeatured && (order.isOnCredit || remaining > EPS)) {
      return "AR_PAYMENT_ACK";
    }

    // Normal partial payment acknowledgment
    if (hasFeatured) return "PAYMENT_ACK";

    // Full utang (no payment today) / credit acknowledgment
    return "CREDIT_ACK";
  })();

  return json({
    order,
    lines,
    totals: {
      subtotal,
      discountTotal,
      totalPayable,
      paidToDate,
      remaining,
      remainingRaw,
      approvedClearanceDiscount: appliedClearanceDiscount,
      transferredToAr,
      paidCash,
      paidNonCash,
    },
    hasMissingLineTotals,
    cash,
    change: changeFromQuery,
    featuredPayment: featuredPayment
      ? {
          id: Number(featuredPayment.id),
          amount: Number(featuredPayment.amount || 0),
          method: String(featuredPayment.method || ""),
          refNo: featuredPayment.refNo ? String(featuredPayment.refNo) : null,
          createdAt: featuredPayment.createdAt,
          tendered: featuredPayment.tendered ?? null,
          change: featuredPayment.change ?? null,
        }
      : null,
    mode,
    commercial: {
      clearanceStatus:
        clearanceCase?.status === "NEEDS_CLEARANCE" ||
        clearanceCase?.status === "DECIDED"
          ? clearanceCase.status
          : null,
      decisionKind,
    },
    ui: {
      customerName,
      customerPhone: (order.customer as any)?.phone
        ? String((order.customer as any).phone)
        : null,
    },
  });
}

type FrozenLine = {
  id: number;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  baseUnitPrice: number | null;
  discountAmount: number | null;
  unitKind: string | null;
};

export default function ReceiptPage() {
  const {
    order,
    lines,
    totals,
    cash,
    change,
    hasMissingLineTotals,
    featuredPayment,
    mode,
    commercial,
    ui,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();

  // Query flags
  const qs = new URLSearchParams(location.search);
  const autoPrint = qs.get("autoprint") === "1";
  const autoBack = qs.get("autoback") === "1";
  const returnToRaw = qs.get("returnTo") || "/cashier";

  // prevent open-redirect: allow only in-app absolute paths
  const safeReturnTo =
    returnToRaw.startsWith("/") && !returnToRaw.startsWith("//")
      ? returnToRaw
      : "/cashier";

  const isRunReturn = safeReturnTo.startsWith("/cashier/delivery/");
  const backLabel = isRunReturn
    ? "Back to Delivery Run Remit"
    : "Back to Cashier";
  const backTitle = isRunReturn
    ? "Return to delivery run remit queue"
    : "Return to cashier queue";

  const customerLabel =
    ui?.customerName ||
    (order.customerId ? `Customer #${order.customerId}` : "Walk-in / Unknown");

  const title = (() => {
    switch (mode) {
      case "OFFICIAL_RECEIPT":
        return "OFFICIAL RECEIPT";
      case "AR_PAYMENT_ACK":
        return "A/R PAYMENT ACKNOWLEDGMENT";
      case "PAYMENT_ACK":
        return "PAYMENT ACKNOWLEDGMENT";
      case "CREDIT_ACK":
        return "CREDIT ACKNOWLEDGMENT";
      default:
        return "SETTLEMENT SUMMARY";
    }
  })();

  const footer = (() => {
    switch (mode) {
      case "OFFICIAL_RECEIPT":
        return "Thank you for your purchase!";
      case "SETTLEMENT_SUMMARY":
        return "This is a settlement summary. Official receipt number is not available.";
      case "CREDIT_ACK":
        return "This document acknowledges credit. No payment was received.";
      default:
        return "This is not an official receipt.";
    }
  })();

  // Ensure we only trigger print once (prevents double/triple prints in dev/StrictMode)
  const printedOnceRef = React.useRef(false);
  const navigatedBackRef = React.useRef(false);

  React.useEffect(() => {
    if (!autoPrint || printedOnceRef.current) return;
    printedOnceRef.current = true;

    const handleAfterPrint = () => {
      if (autoBack && !navigatedBackRef.current) {
        navigatedBackRef.current = true;
        navigate(safeReturnTo, { replace: true });
      }
      window.removeEventListener("afterprint", handleAfterPrint);
      window.removeEventListener("focus", handleFocusFallback);
      document.removeEventListener("visibilitychange", handleVisFallback);
    };

    // Fallbacks for browsers that don’t reliably fire `afterprint`
    const handleFocusFallback = () => {
      // When user cancels/finishes print dialog and window regains focus
      handleAfterPrint();
    };
    const handleVisFallback = () => {
      if (document.visibilityState === "visible") handleAfterPrint();
    };

    window.addEventListener("afterprint", handleAfterPrint);
    window.addEventListener("focus", handleFocusFallback);
    document.addEventListener("visibilitychange", handleVisFallback);

    // Trigger after first paint to avoid layout thrash
    const id = setTimeout(() => window.print(), 0);

    return () => {
      clearTimeout(id);
      window.removeEventListener("afterprint", handleAfterPrint);
      window.removeEventListener("focus", handleFocusFallback);
      document.removeEventListener("visibilitychange", handleVisFallback);
    };
  }, [autoPrint, autoBack, navigate, safeReturnTo]);

  const [showMore, setShowMore] = React.useState(false);

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const grandTotal = Number(totals?.totalPayable ?? 0);
  const paidToDate = Number(totals?.paidToDate ?? 0);
  const remainingRaw = Number(totals?.remainingRaw ?? 0);
  const remaining = Number(totals?.remaining ?? 0);
  const approvedClearanceDiscount = Number(
    totals?.approvedClearanceDiscount ?? 0,
  );
  const transferredToAr = Number(totals?.transferredToAr ?? 0);
  const paidCash = Number(totals?.paidCash ?? 0);
  const paidNonCash = Number(totals?.paidNonCash ?? 0);
  const hasClearanceAdjustments =
    approvedClearanceDiscount > EPS || transferredToAr > EPS;
  const balanceLabel =
    commercial?.clearanceStatus === "DECIDED" &&
    commercial?.decisionKind !== "REJECT" &&
    hasClearanceAdjustments
      ? "Balance after clearance"
      : "Balance";

  // If caller didn't pass change, compute a best-effort one.
  // NOTE: For acknowledgments, change may be irrelevant; we still show it if positive.
  const changeComputed = Math.max(0, paidToDate - grandTotal);
  const changeToShow = change ?? changeComputed;

  // CASH RECEIVED: prefer explicit query, else tendered from latest cash payment
  const cashPayments = (order.payments ?? []).filter(
    (p: any) => String(p.method).toUpperCase() === "CASH",
  );
  const latestCash = cashPayments[0] ?? null;
  const cashFromPayment =
    latestCash && latestCash.tendered != null
      ? Number(latestCash.tendered)
      : latestCash
      ? Number(latestCash.amount || 0) + Number(latestCash.change || 0)
      : null;
  const cashToShow = cash ?? cashFromPayment;

  return (
    <div className="receipt-root mx-auto p-0 md:p-6 text-slate-900 bg-[#f7f7fb] min-h-screen">
      <div className="receipt-shell mx-auto max-w-2xl">
        {/* Card (kept narrow for 57mm preview) */}
        <div className="ticket rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
          {/* Merchant header */}
          <div className="text-center mb-3">
            <div className="font-semibold text-slate-900">
              Zaldy Merchandise
            </div>
            <div className="text-xs text-slate-600">
              Poblacion East, Asingan, Pangasinan • 0919 939 1932
            </div>
            <div className="text-xs mt-1 tracking-wide text-slate-700">
              {title}
            </div>
          </div>

          {/* Receipt meta */}
          <div className="text-xs grid grid-cols-2 gap-y-1 mb-3">
            {mode === "OFFICIAL_RECEIPT" ? (
              <>
                <div className="text-slate-600">Receipt No:</div>
                <div className="text-right font-mono text-slate-900">
                  {order.receiptNo}
                </div>
              </>
            ) : (
              <>
                <div className="text-slate-600">Document:</div>
                <div className="text-right font-mono text-slate-900">
                  {mode}
                </div>
              </>
            )}

            <div className="text-slate-600">Order Code:</div>
            <div className="text-right font-mono text-slate-900">
              {order.orderCode}
            </div>

            <div className="text-slate-600">Customer:</div>
            <div className="text-right text-slate-900">
              {customerLabel}
              {ui?.customerPhone ? (
                <span className="text-slate-500"> • {ui.customerPhone}</span>
              ) : null}
            </div>

            <div className="text-slate-600">Date/Time:</div>
            <div className="text-right text-slate-900">
              {(featuredPayment?.createdAt
                ? new Date(featuredPayment.createdAt)
                : order.paidAt
                ? new Date(order.paidAt)
                : new Date()
              ).toLocaleString()}
            </div>
          </div>

          {hasMissingLineTotals ? (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 no-print">
              Warning: Missing frozen line totals on one or more items. Receipt
              should be printed only after cashier freeze/settle completed
              correctly.
            </div>
          ) : null}

          {/* Items */}
          <div className="border-y border-slate-200 py-1">
            {lines.map((it: any) => {
              const qty = Number(it.qty || 0);
              const unit = Number(it.unitPrice || 0);
              const lineTotal = Number(it.lineTotal || 0);
              const base =
                it.baseUnitPrice != null ? Number(it.baseUnitPrice) : null;
              const perUnitDisc =
                it.discountAmount != null ? Number(it.discountAmount) : 0;
              const hasDisc = perUnitDisc > 0.009;
              const unitLabel = it.unitKind
                ? ` • ${String(it.unitKind).toUpperCase()}`
                : "";
              return (
                <div key={it.id} className="flex text-sm py-1">
                  <div className="flex-1">
                    <div className="font-medium text-slate-900">{it.name}</div>
                    <div className="text-xs text-slate-600">
                      {qty} × {peso(unit)}
                      {unitLabel}
                      {/* Hide extra pricing breakdown on paper to keep it clean */}
                      {base != null ? (
                        <span className="no-print text-slate-500">
                          {" "}
                          • Base {peso(base)}
                        </span>
                      ) : null}
                      {hasDisc ? (
                        <span className="no-print text-rose-700">
                          {" "}
                          • Disc −{peso(perUnitDisc)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="font-medium text-slate-900">
                    {peso(lineTotal)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals + payments */}
          <div className="mt-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-600">Subtotal</span>
              <span className="font-medium text-slate-900">
                {peso(Number(totals?.subtotal ?? 0))}
              </span>
            </div>

            {/* Discounts */}
            {/* Discount summary (snapshot) */}
            {Number(totals?.discountTotal ?? 0) > 0.009 ? (
              <div className="flex justify-between">
                <span className="text-rose-700">Discounts</span>
                <span className="font-medium text-rose-700">
                  - {peso(Number(totals?.discountTotal ?? 0))}
                </span>
              </div>
            ) : null}

            <div className="flex justify-between">
              <span className="text-slate-700">Grand Total</span>
              <span className="font-semibold text-slate-900">
                {peso(grandTotal)}
              </span>
            </div>

            <div className="pt-2 border-t border-slate-200">
              {/* Featured payment first (for ACK modes) */}
              {featuredPayment ? (
                <div className="flex justify-between">
                  <span className="text-slate-700">
                    Payment Today (
                    {String(featuredPayment.method).toUpperCase()}
                    {featuredPayment.refNo ? ` • ${featuredPayment.refNo}` : ""}
                    )
                  </span>
                  <span className="font-semibold text-slate-900">
                    {peso(Number(featuredPayment.amount || 0))}
                  </span>
                </div>
              ) : null}

              {/* Paid breakdown (customer-settled truth) */}
              <div className="flex justify-between mt-1">
                <span className="text-slate-700">Paid to Date</span>
                <span className="text-slate-900">{peso(paidToDate)}</span>
              </div>
              {paidCash > EPS ? (
                <div className="flex justify-between">
                  <span className="text-slate-600">Paid (Cash)</span>
                  <span className="text-slate-900">{peso(paidCash)}</span>
                </div>
              ) : null}
              {paidNonCash > EPS ? (
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    Paid (Internal Settlement)
                  </span>
                  <span className="text-slate-900">{peso(paidNonCash)}</span>
                </div>
              ) : null}
              {approvedClearanceDiscount > EPS ? (
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    Approved Clearance Discount
                  </span>
                  <span className="text-slate-900">
                    - {peso(approvedClearanceDiscount)}
                  </span>
                </div>
              ) : null}
              {transferredToAr > EPS ? (
                <div className="flex justify-between">
                  <span className="text-slate-600">Transferred to A/R</span>
                  <span className="text-slate-900">
                    - {peso(transferredToAr)}
                  </span>
                </div>
              ) : null}
              {hasClearanceAdjustments ? (
                <div className="flex justify-between">
                  <span className="text-slate-600">Balance before clearance</span>
                  <span className="text-slate-900">{peso(remainingRaw)}</span>
                </div>
              ) : null}

              <div className="flex justify-between mt-1">
                <span className="text-slate-700">{balanceLabel}</span>
                <span className="font-semibold text-slate-900">
                  {peso(remaining)}
                </span>
              </div>
              {cashToShow != null && (
                <div className="flex justify-between mt-1">
                  <span className="text-slate-700">Cash Received</span>
                  <span className="font-semibold text-slate-900">
                    {peso(Number(cashToShow))}
                  </span>
                </div>
              )}
              {changeToShow > EPS ? (
                <div className="flex justify-between mt-1">
                  <span className="text-slate-700">Change</span>
                  <span className="font-semibold text-slate-900">
                    {peso(changeToShow)}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-4 text-center text-xs text-slate-600">
            {footer}
          </div>

          {/* Controls (hidden on print) */}
          <div className="mt-4 flex flex-wrap gap-2 no-print">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
            >
              {mode === "OFFICIAL_RECEIPT" ? "Print Official Receipt" : "Print"}
            </button>
            <button
              onClick={() => navigate(safeReturnTo)}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              title={backTitle}
            >
              {backLabel}
            </button>

            <label className="ml-2 inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={showMore}
                onChange={(e) => setShowMore(e.target.checked)}
                className="h-4 w-4 accent-indigo-600"
              />
              More options
            </label>
          </div>

          {showMore && (
            <div className="mt-3 no-print flex gap-2">
              {/* CREATE: start a new sale (order pad) */}
              <button
                onClick={() => navigate("/kiosk")}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                title="Start a new order"
              >
                New Sale
              </button>

              {/* DELETE/VOID: placeholder */}
              <form
                method="post"
                onSubmit={(e) => {
                  if (!confirm("Void this sale? Stock will be restored."))
                    e.preventDefault();
                }}
              >
                <input type="hidden" name="_action" value="void" />
                <button
                  type="submit"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 shadow-sm disabled:opacity-60"
                  title="Void this sale (manager approval)"
                  disabled
                >
                  Void Sale (Soon)
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* 57mm ticket & print styles */}
      <style>{`
  /* SCREEN MODE (pretty UI) */
  .ticket { width: 100%; }

  /* PRINT MODE (thermal) */
  @media print {
    /* hide all UI controls */
    .no-print { display: none !important; }

    /* kill app background + spacing */
    .receipt-root {
      background: #fff !important;
      padding: 0 !important;
      margin: 0 !important;
      min-height: auto !important;
    }
    .receipt-shell {
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 58mm !important;
      background: #fff !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* Paper size */
    @page { size: 58mm auto; margin: 0; }

    /* Thermal content width (safe for most 58mm printers) */
    .ticket {
      width: 52mm !important;
      max-width: 52mm !important;
      margin: 0 !important;
      padding: 3mm !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }
  }
`}</style>
    </div>
  );
}
