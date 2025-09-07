import * as React from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { db } from "~/utils/db.server";
import type { Cart, Rule } from "~/services/pricing";

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

  // ── Compute discounted total at the time of this payment (or now) ──────────
  // Small local engine mirroring server logic
  const r2 = (n: number) => +Number(n).toFixed(2);
  const applyDiscountsLocal = (cart: Cart, rules: Rule[]) => {
    let subtotal = 0;
    let total = 0;
    const perRule = new Map<string, AckDiscount>();
    for (const it of cart.items) {
      const qty = Number(it.qty);
      const unit = Number(it.unitPrice);
      subtotal = r2(subtotal + qty * unit);
      let eff = unit;
      // tolerant matching: unknown unitKind acts as wildcard
      const matches = rules.filter((r) => {
        const byPid = r.selector?.productIds?.includes(it.productId) ?? false;
        if (!byPid) return false;
        if (r.selector?.unitKind)
          return !it.unitKind || r.selector.unitKind === it.unitKind;
        return true;
      });
      const override = matches.find((m) => m.kind === "PRICE_OVERRIDE");
      const percents = matches.filter((m) => m.kind === "PERCENT_OFF");
      if (override && override.kind === "PRICE_OVERRIDE") {
        const next = r2(override.priceOverride);
        const delta = Math.max(0, r2((eff - next) * qty));
        if (delta > 0) {
          const e = perRule.get(override.id) ?? {
            ruleId: override.id,
            name: override.name,
            amount: 0,
          };
          e.amount = r2(e.amount + delta);
          perRule.set(override.id, e);
        }
        eff = next;
      }
      for (const p of percents) {
        if (p.kind !== "PERCENT_OFF") continue;
        const pct = Math.max(0, Number(p.percentOff ?? 0));
        if (pct <= 0) continue;
        const next = r2(eff * (1 - pct / 100));
        const delta = Math.max(0, r2((eff - next) * qty));
        if (delta > 0) {
          const e = perRule.get(p.id) ?? {
            ruleId: p.id,
            name: p.name,
            amount: 0,
          };
          e.amount = r2(e.amount + delta);
          perRule.set(p.id, e);
        }
        eff = next;
      }
      total = r2(total + qty * eff);
    }
    const discounts = Array.from(perRule.values());
    const discountTotal = r2(subtotal - total);
    return {
      subtotal: r2(subtotal),
      total: r2(total),
      discountTotal,
      discounts,
    };
  };

  // Pick the reference instant: the featured payment time, otherwise now
  const at = featured?.createdAt ?? new Date();

  // Load customer rules valid at `at`
  let rules: Rule[] = [];
  if (order.customer?.id) {
    const rows = await db.customerItemPrice.findMany({
      where: {
        customerId: order.customer.id,
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: at } }] },
        ],
      },
      select: {
        id: true,
        productId: true,
        unitKind: true,
        mode: true,
        value: true,
        product: { select: { price: true, srp: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    rules = rows.map((r) => {
      const selector = {
        productIds: [r.productId],
        unitKind: r.unitKind as "RETAIL" | "PACK",
      };
      const v = Number(r.value ?? 0);
      if (r.mode === "FIXED_PRICE") {
        return {
          id: `CIP:${r.id}`,
          name: "Customer Price",
          scope: "ITEM",
          kind: "PRICE_OVERRIDE",
          priceOverride: v,
          selector,
          priority: 10,
          enabled: true,
          stackable: false,
          notes: `unit=${r.unitKind}`,
        } as Rule;
      }
      if (r.mode === "PERCENT_DISCOUNT") {
        return {
          id: `CIP:${r.id}`,
          name: "Customer % Off",
          scope: "ITEM",
          kind: "PERCENT_OFF",
          percentOff: v,
          selector,
          priority: 10,
          enabled: true,
          stackable: true,
          notes: `unit=${r.unitKind}`,
        } as Rule;
      }
      const base =
        r.unitKind === "RETAIL"
          ? Number(r.product.price ?? 0)
          : Number(r.product.srp ?? 0);
      const override = Math.max(0, +(base - v).toFixed(2));
      return {
        id: `CIP:${r.id}`,
        name: "Customer Fixed Off",
        scope: "ITEM",
        kind: "PRICE_OVERRIDE",
        priceOverride: override,
        selector,
        priority: 10,
        enabled: true,
        stackable: false,
        notes: `unit=${r.unitKind}`,
      } as Rule;
    });
  }

  // Build a rule-aware cart (same inference/wildcard as on server)
  const eq = (a: number, b: number, eps = 0.25) => Math.abs(a - b) <= eps;
  const cart: Cart = {
    items: order.items.map((it) => {
      const baseRetail = Number(it.product?.price ?? 0);
      const basePack = Number(it.product?.srp ?? 0);
      const u = Number(it.unitPrice);
      let unitKind: "RETAIL" | "PACK" | undefined;
      const retailClose = baseRetail > 0 && eq(u, baseRetail);
      const packClose = basePack > 0 && eq(u, basePack);
      if (retailClose && !packClose) unitKind = "RETAIL";
      else if (packClose && !retailClose) unitKind = "PACK";
      else if (retailClose && packClose)
        unitKind = baseRetail <= basePack ? "RETAIL" : "PACK";
      if (!unitKind) {
        const hasPackRule = rules.some(
          (r) =>
            r.selector?.unitKind === "PACK" &&
            r.selector?.productIds?.includes(it.productId)
        );
        const hasRetailRule = rules.some(
          (r) =>
            r.selector?.unitKind === "RETAIL" &&
            r.selector?.productIds?.includes(it.productId)
        );
        if (hasPackRule && !hasRetailRule) unitKind = "PACK";
        else if (hasRetailRule && !hasPackRule) unitKind = "RETAIL";
      }
      return {
        id: it.id,
        productId: it.productId,
        name: it.name,
        qty: Number(it.qty),
        unitPrice: u,
        unitKind,
      };
    }),
  };
  const pricing = applyDiscountsLocal(cart, rules);

  const total = pricing.total || 0;
  const paidSoFar = (order.payments ?? []).reduce(
    (s, p) => s + Number(p.amount || 0),
    0
  );
  const remaining = Math.max(0, total - paidSoFar);

  const payload: LoaderData = {
    order: {
      id: order.id,
      orderCode: order.orderCode,
      total,
      paidSoFar,
      remaining,
      createdAt: order.createdAt,
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
              {featured ? "Payment Acknowledgment" : "Credit Acknowledgment"}
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
          </div>

          {/* Footer */}
          <div className="mt-4 text-center text-[11px] text-slate-600">
            {featured
              ? "This is a payment acknowledgment, not an official receipt."
              : "This is a credit acknowledgment (no payment recorded), not an official receipt."}
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
