import * as React from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { db } from "~/utils/db.server";
import {
  applyDiscounts,
  buildCartFromOrderItems,
  fetchCustomerRulesAt,
} from "~/services/pricing";

import type { Order } from "@prisma/client";

type AckDiscount = { ruleId: string; name: string; amount: number };
type AckPricing = {
  subtotal: number;
  total: number;
  discountTotal: number;
  discounts: AckDiscount[];
};
type LoaderData = {
  order: {
    id: number;
    orderCode: string;
    total: number;
    paidSoFar: number;
    remaining: number;
    createdAt: string | Date;
    isOnCredit: boolean;
    releaseWithBalance: boolean;
    releasedApprovedBy: string | null;
    releasedAt: string | Date | null;
  };
  featured: {
    id: number;
    amount: number;
    method: string;
    refNo: string | null;
    createdAt: string | Date;
  } | null;
  tendered: number;
  change: number;
  pricing: AckPricing;
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const url = new URL(request.url);
  const pidParam = url.searchParams.get("pid");
  const pid = pidParam ? Number(pidParam) : 0;

  const tenderedParam = url.searchParams.get("tendered");
  const changeParam = url.searchParams.get("change");
  const tendered =
    tenderedParam && !Number.isNaN(Number(tenderedParam))
      ? Math.max(0, Number(tenderedParam))
      : 0;
  const change =
    changeParam && !Number.isNaN(Number(changeParam))
      ? Math.max(0, Number(changeParam))
      : 0;
  // Pull order with products for unit-kind inference; payments sorted (newest first)
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: { select: { price: true, srp: true, allowPackSale: true } },
        },
      },
      payments: { orderBy: { createdAt: "desc" } },
      customer: { select: { id: true } },
    },
  });
  if (!order) throw new Response("Not found", { status: 404 });

  // Optionally fetch a specific payment
  let featured: {
    id: number;
    amount: number;
    method: string;
    refNo: string | null;
    createdAt: Date;
  } | null = null;

  if (Number.isFinite(pid) && pid > 0) {
    const p = await db.payment.findUnique({
      where: { id: pid },
      select: {
        id: true,
        amount: true,
        method: true,
        refNo: true,
        createdAt: true,
        orderId: true,
      },
    });
    // Only use it if it belongs to this order
    if (p && p.orderId === order.id) {
      featured = {
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        refNo: p.refNo ?? null,
        createdAt: p.createdAt,
      };
    }
  }

  // Fallback to latest payment if pid not valid or mismatched
  if (!featured) {
    const latest = order.payments[0] || null;
    if (latest) {
      featured = {
        id: latest.id,
        amount: Number(latest.amount),
        method: latest.method,
        refNo: latest.refNo ?? null,
        createdAt: latest.createdAt,
      };
    }
  }

  // Pick the reference instant: the featured payment time, otherwise now
  const at = featured?.createdAt ?? new Date();

  // Load customer rules valid at `at`
  // Load customer rules valid at `at` (centralized)
  const rules = await fetchCustomerRulesAt(db, order.customer?.id ?? null, at);

  // Build a rule-aware cart (same inference/wildcard as on server)
  // Build a rule-aware cart (centralized) – coerce Decimal → number
  const cart = buildCartFromOrderItems({
    items: order.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      name: it.name,
      qty: Number(it.qty),
      unitPrice: Number(it.unitPrice),
      product: {
        price: it.product?.price == null ? null : Number(it.product.price),
        srp: it.product?.srp == null ? null : Number(it.product.srp),
        allowPackSale: it.product?.allowPackSale ?? null,
      },
    })),
    rules,
  });
  const computed = applyDiscounts(cart, rules, {
    id: order.customer?.id ?? null,
  });
  const pricing: AckPricing = {
    subtotal: computed.subtotal,
    total: computed.total,
    discountTotal: computed.discountTotal,
    discounts: computed.discounts.map((d) => ({
      ruleId: d.ruleId,
      name: d.name,
      amount: d.amount,
    })),
  };

  const total = pricing.total || 0;
  const paidSoFar = (order.payments ?? []).reduce(
    (s, p) => s + Number(p.amount || 0),
    0
  );
  const remaining = Math.max(0, total - paidSoFar);
  const o: Order = order; // <— SAFE CAST (no any)

  const payload: LoaderData = {
    order: {
      id: order.id,
      orderCode: order.orderCode,
      total,
      paidSoFar,
      remaining,
      createdAt: order.createdAt,
      isOnCredit: o.isOnCredit,
      releaseWithBalance: o.releaseWithBalance,
      releasedApprovedBy: o.releasedApprovedBy,
      releasedAt: o.releasedAt,
    },
    featured, // may be null if no payments yet
    tendered,
    change,
    pricing,
  };
  return json<LoaderData>(payload);
}

export default function PaymentAckPage() {
  const { order, featured, tendered, change, pricing } =
    useLoaderData<LoaderData>();
  const navigate = useNavigate();
  const location = useLocation();

  // May utang ba / A/R? (kahit partial, kahit roadside, etc.)
  const hasBalance = order.remaining > 0.009;
  const isCredit = order.releaseWithBalance || order.isOnCredit || hasBalance;

  const qs = new URLSearchParams(location.search);
  const autoPrint = qs.get("autoprint") === "1";
  const autoBack = qs.get("autoback") === "1";

  const printedOnceRef = React.useRef(false);
  const navigatedBackRef = React.useRef(false);

  React.useEffect(() => {
    if (!autoPrint || printedOnceRef.current) return;
    printedOnceRef.current = true;

    const done = () => {
      if (autoBack && !navigatedBackRef.current) {
        navigatedBackRef.current = true;
        navigate("/cashier", { replace: true });
      }
      window.removeEventListener("afterprint", done);
      window.removeEventListener("focus", done);
      document.removeEventListener("visibilitychange", vis);
    };
    const vis = () => document.visibilityState === "visible" && done();

    window.addEventListener("afterprint", done);
    window.addEventListener("focus", done);
    document.addEventListener("visibilitychange", vis);

    const id = setTimeout(() => window.print(), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("afterprint", done);
      window.removeEventListener("focus", done);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [autoPrint, autoBack, navigate]);

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <div className="mx-auto p-0 md:p-6 print:p-0 text-slate-900 bg-[#f7f7fb] min-h-screen">
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 print:p-0">
          {/* Merchant header */}
          <div className="text-center mb-3">
            <div className="font-semibold text-slate-900">
              Zaldy Merchandise
            </div>
            <div className="text-xs text-slate-600">
              Poblacion East, Asingan, Pangasinan • 0919 939 1932
            </div>
            <div className="text-xs mt-1 tracking-wide text-slate-700">
              {isCredit ? "Credit Acknowledgment" : "Payment Acknowledgment"}
            </div>
          </div>

          {/* Meta */}
          <div className="text-xs grid grid-cols-2 gap-y-1 mb-3">
            <div className="text-slate-600">Order Code:</div>
            <div className="text-right font-mono text-slate-900">
              {order.orderCode}
            </div>

            <div className="text-slate-600">Date/Time:</div>
            <div className="text-right text-slate-900">
              {new Date().toLocaleString()}
            </div>
          </div>

          {/* Featured payment (this transaction) */}
          {/* Payment details */}
          <div className="border-y border-slate-200 py-2 text-sm space-y-1">
            {tendered > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-700">Cash Received</span>
                <span className="font-semibold">{peso(tendered)}</span>
              </div>
            )}
            {featured ? (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-700">
                    Applied to this order ({featured.method}
                    {featured.refNo ? ` • ${featured.refNo}` : ""})
                  </span>
                  <span className="font-semibold">{peso(featured.amount)}</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {new Date(featured.createdAt).toLocaleString()}
                </div>
              </>
            ) : (
              <div className="text-slate-600">
                Credit acknowledgment (no payment captured on this order).
              </div>
            )}
            {change > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-700">Change Given</span>
                <span className="font-semibold">{peso(change)}</span>
              </div>
            )}
          </div>
          {/* Totals */}
          <div className="mt-3 text-sm space-y-1">
            {/* Subtotal (before discounts) */}
            <div className="flex justify-between">
              <span className="text-slate-600">Subtotal</span>
              <span className="font-medium text-slate-900">
                {peso(pricing?.subtotal ?? order.total)}
              </span>
            </div>

            {/* Discounts */}
            {pricing.discounts.length ? (
              <>
                {pricing.discounts.map((d) => (
                  <div key={d.ruleId} className="flex justify-between">
                    <span className="text-rose-700">Less: {d.name}</span>
                    <span className="text-rose-700">- {peso(d.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span className="text-slate-600">Total Discount</span>
                  <span className="font-medium text-slate-900">
                    - {peso(pricing.discountTotal)}
                  </span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between">
              <span className="text-slate-600">Grand Total</span>
              <span className="font-semibold text-slate-900">
                {peso(pricing?.total ?? order.total)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Paid to Date</span>
              <span className="text-slate-900">{peso(order.paidSoFar)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-700">Remaining Balance</span>
              <span className="font-semibold text-slate-900">
                {peso(order.remaining)}
              </span>
            </div>
            {change > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-700">Change Given</span>
                <span className="font-semibold text-slate-900">
                  {peso(change)}
                </span>
              </div>
            )}

            {/* A/R approval imprint (manager-side release with balance) */}
            {order.releaseWithBalance && (
              <div className="mt-2 border-t border-dashed border-slate-200 pt-2 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Approved as A/R by</span>
                  <span className="font-medium text-slate-900">
                    {order.releasedApprovedBy || "Manager"}
                  </span>
                </div>
                {order.releasedAt && (
                  <div className="flex justify-between">
                    <span>Approval Date/Time</span>
                    <span className="text-slate-900">
                      {new Date(order.releasedAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-4 text-center text-[11px] text-slate-600">
            {isCredit
              ? "This is a credit/payment acknowledgment (may remaining balance / A/R), not an official receipt."
              : "This is a payment acknowledgment, not an official receipt."}
          </div>

          {/* Controls (hidden on print) */}
          <div className="mt-4 flex flex-wrap gap-2 no-print">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
            >
              {featured ? "Print Payment Ack" : "Print Credit Ack"}
            </button>
            <button
              onClick={() => navigate("/cashier")}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Back to Cashier
            </button>
          </div>
        </div>
      </div>

      {/* 57mm ticket & print styles */}
      <style>{`
        .ticket { width: 57mm; max-width: 100%; }
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          @page { size: 57mm auto; margin: 4mm; }
        }
      `}</style>
    </div>
  );
}
