import * as React from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { db } from "~/utils/db.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    include: { items: true, payments: true },
  });
  if (!order) throw new Response("Not found", { status: 404 });

  if (order.status !== "PAID" || !order.receiptNo) {
    throw new Response("Receipt not available for this order", { status: 400 });
  }

  // future-proof flag (not used yet)
  const isVoid = order.status === "VOIDED";
  return json({ order, isVoid });
}

export default function ReceiptPage() {
  const { order } = useLoaderData<typeof loader>();
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
  const grandTotal = Number(order.totalBeforeDiscount); // discounts later
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
                {peso(Number(order.subtotal))}
              </span>
            </div>

            {/* Discounts (coming soon)
        <div className="flex justify-between">
          <span className="text-slate-600">Discounts</span>
          <span className="text-slate-900">- {peso(discountsTotal)}</span>
        </div> */}

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
