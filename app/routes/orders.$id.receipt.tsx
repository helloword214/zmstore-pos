import * as React from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { db } from "~/utils/db.server";
import type { Cart, Rule } from "~/services/pricing";

// If you already have a shared helper, you can import it instead of duplicating:
// import { applyDiscounts } from "~/services/pricing";

// Lightweight, in-receipt discount engine to match cashier logic
function applyDiscountsLocal(cart: Cart, rules: Rule[]) {
  const r2 = (n: number) => +n.toFixed(2);
  const perRuleTotals = new Map<
    string,
    { ruleId: string; name: string; amount: number }
  >();
  let subtotal = 0;
  let total = 0;

  for (const it of cart.items) {
    const qty = Number(it.qty);
    const unit = Number(it.unitPrice);
    subtotal = r2(subtotal + qty * unit);
    let eff = unit;

    // match rules (tolerate unknown unitKind = wildcard)
    const matches = rules.filter((r) => {
      const byPid = r.selector?.productIds?.includes(it.productId) ?? false;
      if (!byPid) return false;
      if (r.selector?.unitKind) {
        return !it.unitKind || r.selector.unitKind === it.unitKind;
      }
      return true;
    });
    // choose a single override + collect stackable percents
    const override = matches.find((m) => m.kind === "PRICE_OVERRIDE");
    const percents = matches.filter((m) => m.kind === "PERCENT_OFF");

    if (override && override.kind === "PRICE_OVERRIDE") {
      const next = r2(override.priceOverride);
      const delta = Math.max(0, r2((eff - next) * qty));
      if (delta > 0) {
        const entry = perRuleTotals.get(override.id) ?? {
          ruleId: override.id,
          name: override.name,
          amount: 0,
        };
        entry.amount = r2(entry.amount + delta);
        perRuleTotals.set(override.id, entry);
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
        const entry = perRuleTotals.get(p.id) ?? {
          ruleId: p.id,
          name: p.name,
          amount: 0,
        };
        entry.amount = r2(entry.amount + delta);
        perRuleTotals.set(p.id, entry);
      }
      eff = next;
    }
    total = r2(total + qty * eff);
  }

  return {
    subtotal: r2(subtotal),
    total: r2(total),
    discountTotal: r2(subtotal - total),
    discounts: Array.from(perRuleTotals.values()),
  };
}

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: { select: { price: true, srp: true, allowPackSale: true } },
        },
      },
      payments: true,
      customer: { select: { id: true } },
    },
  });
  if (!order) throw new Response("Not found", { status: 404 });

  if (order.status !== "PAID" || !order.receiptNo) {
    throw new Response("Receipt not available for this order", { status: 400 });
  }

  // future-proof flag (not used yet)
  const isVoid = order.status === "VOIDED";
  // ── Recompute pricing snapshot at time of payment (paidAt) ─────────────
  // 1) Active rules for this customer that were valid at paidAt
  const at = order.paidAt ?? new Date();
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

  // 2) Build a rule-aware cart (tolerate unknown unitKind like server action)
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
        unitPrice: Number(it.unitPrice),
        unitKind,
      };
    }),
  };

  // 3) Compute receipt pricing (matches cashier server action)
  const pricing = applyDiscountsLocal(cart, rules);

  return json({ order, isVoid, pricing });
}

export default function ReceiptPage() {
  const { order, pricing } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();

  // Query flags
  const qs = new URLSearchParams(location.search);
  const autoPrint = qs.get("autoprint") === "1";
  const autoBack = qs.get("autoback") === "1";

  // Ensure we only trigger print once (prevents double/triple prints in dev/StrictMode)
  const printedOnceRef = React.useRef(false);
  const navigatedBackRef = React.useRef(false);

  React.useEffect(() => {
    if (!autoPrint || printedOnceRef.current) return;
    printedOnceRef.current = true;

    const handleAfterPrint = () => {
      if (autoBack && !navigatedBackRef.current) {
        navigatedBackRef.current = true;
        // Prefer going back to cashier
        navigate("/cashier", { replace: true });
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
  }, [autoPrint, autoBack, navigate]);

  const [showMore, setShowMore] = React.useState(false);

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const totalPaid = order.payments.reduce((s, p) => s + Number(p.amount), 0);
  const grandTotal = pricing?.total ?? Number(order.totalBeforeDiscount);
  const change = Math.max(0, totalPaid - grandTotal);

  return (
    <div className="mx-auto p-0 md:p-6 print:p-0 text-slate-900 bg-[#f7f7fb] min-h-screen">
      <div className="mx-auto max-w-xl">
        {/* Card (kept narrow for 57mm preview) */}
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
              Official Receipt
            </div>
          </div>

          {/* Receipt meta */}
          <div className="text-xs grid grid-cols-2 gap-y-1 mb-3">
            <div className="text-slate-600">Receipt No:</div>
            <div className="text-right font-mono text-slate-900">
              {order.receiptNo}
            </div>

            <div className="text-slate-600">Order Code:</div>
            <div className="text-right font-mono text-slate-900">
              {order.orderCode}
            </div>

            <div className="text-slate-600">Date/Time:</div>
            <div className="text-right text-slate-900">
              {order.paidAt ? new Date(order.paidAt).toLocaleString() : ""}
            </div>
          </div>

          {/* Items */}
          <div className="border-y border-slate-200 py-1">
            {order.items.map((it) => (
              <div key={it.id} className="flex text-sm py-1">
                <div className="flex-1">
                  <div className="font-medium text-slate-900">{it.name}</div>
                  <div className="text-xs text-slate-600">
                    {it.qty} × {peso(Number(it.unitPrice))}
                  </div>
                </div>
                <div className="font-medium text-slate-900">
                  {peso(Number(it.lineTotal))}
                </div>
              </div>
            ))}
          </div>

          {/* Totals + payments */}
          <div className="mt-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-600">Subtotal</span>
              <span className="font-medium text-slate-900">
                {peso(pricing?.subtotal ?? Number(order.subtotal ?? 0))}
              </span>
            </div>

            {/* Discounts */}
            {pricing?.discounts?.length ? (
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
              <span className="text-slate-700">Grand Total</span>
              <span className="font-semibold text-slate-900">
                {peso(grandTotal)}
              </span>
            </div>

            <div className="pt-2 border-t border-slate-200">
              {order.payments.map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span className="text-slate-700">
                    Paid ({p.method}
                    {p.refNo ? ` • ${p.refNo}` : ""})
                  </span>
                  <span className="text-slate-900">
                    {peso(Number(p.amount))}
                  </span>
                </div>
              ))}
              <div className="flex justify-between mt-1">
                <span className="text-slate-700">Change</span>
                <span className="font-semibold text-slate-900">
                  {peso(change)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-4 text-center text-xs text-slate-600">
            Thank you for your purchase!
          </div>

          {/* Controls (hidden on print) */}
          <div className="mt-4 flex flex-wrap gap-2 no-print">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
            >
              Print Official Receipt
            </button>
            <button
              onClick={() => navigate("/cashier")}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
              title="Return to cashier queue"
            >
              Back to Cashier
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
