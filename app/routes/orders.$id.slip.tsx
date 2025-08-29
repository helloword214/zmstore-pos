import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  Form,
} from "@remix-run/react";
import { useEffect, useRef, useCallback } from "react";
import { db } from "~/utils/db.server";
import { toCode39Svg } from "~/utils/orderBarcode";

// ─────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────
export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!id || Number.isNaN(id))
    throw new Response("Invalid ID", { status: 400 });

  const order = await db.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) throw new Response("Not found", { status: 404 });

  const isExpired = order.expiryAt.getTime() < Date.now();
  return json({ order, isExpired });
}

// ─────────────────────────────────────────────────────────────
// Action
//  - Reprint increments printCount then redirects back to this page
//    with ?autoprint=1 (& keeps ?autoback=1 if present).
// ─────────────────────────────────────────────────────────────
export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  if (!id || Number.isNaN(id)) {
    return json({ ok: false, error: "Invalid ID" }, { status: 400 });
  }
  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "");

  const url = new URL(request.url);
  const keepAutoBack = url.searchParams.get("autoback") === "1";

  if (actionType === "reprint") {
    await db.order.update({
      where: { id },
      data: { printCount: { increment: 1 }, printedAt: new Date() },
      select: { id: true },
    });

    const qs = new URLSearchParams();
    qs.set("autoprint", "1");
    if (keepAutoBack) qs.set("autoback", "1");

    return redirect(`/orders/${id}/slip?${qs.toString()}`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

// ─────────────────────────────────────────────────────────────
// Component
//  - Single autoprint source: ?autoprint=1
//  - Optional auto-return after print: ?autoback=1 → /kiosk
//  - Printable area wrapped in `.ticket` (57/58mm receipt)
// ─────────────────────────────────────────────────────────────
export default function OrderSlipPage() {
  const { order, isExpired } = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();

  const params = new URLSearchParams(location.search);
  const autoPrint = params.get("autoprint") === "1";
  const autoBack = params.get("autoback") === "1";

  // StrictMode-safe guards
  const printedRef = useRef(false);
  const backedRef = useRef(false);

  // Single autoprint path
  useEffect(() => {
    if (!autoPrint || printedRef.current) return;
    printedRef.current = true;
    setTimeout(() => window.print(), 0);
  }, [autoPrint]);

  // Optional: auto-back to kiosk after print dialog closes (OK or Cancel)
  useEffect(() => {
    if (!autoBack) return;
    const handleAfterPrint = () => {
      if (backedRef.current) return;
      backedRef.current = true;
      navigate("/kiosk");
    };
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, [autoBack, navigate]);

  // Copy code helper
  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(order.orderCode);
      // optional: toast
    } catch {}
  }, [order.orderCode]);

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <div className="mx-auto p-4 print:p-0">
      {/* PRINTABLE AREA */}
      <div className="ticket mx-auto">
        {/* Header */}
        <div className="text-center mb-2">
          <div className="font-semibold text-gray-900">Zaldy Merchandise</div>
          <div className="text-[10px] text-gray-600">
            Poblacion East, Asingan, Pangasinan • 0919 939 1932
          </div>
          <div className="text-[10px] mt-1 text-gray-700">Order Slip</div>
        </div>

        {/* Code + Meta */}
        <div className="flex justify-between items-start mt-1">
          <div className="text-[11px]">
            <div>
              Code:{" "}
              <span className="font-mono font-semibold">{order.orderCode}</span>
            </div>
            <div className="text-[10px] text-gray-600">
              Printed: {new Date(order.printedAt).toLocaleString()}
            </div>
            <div
              className={`text-[10px] ${
                isExpired ? "text-red-600" : "text-gray-600"
              }`}
            >
              Expires: {new Date(order.expiryAt).toLocaleString()}{" "}
              {isExpired && "• EXPIRED"}
            </div>
            {order.printCount > 1 && (
              <div className="text-[10px] mt-0.5">
                Reprint #{order.printCount}
              </div>
            )}
          </div>

          {/* Barcode + QR (small) */}
          <div className="flex flex-col items-end gap-1">
            <div
              className="rounded border border-gray-200 px-1 py-0.5 bg-white text-gray-900"
              dangerouslySetInnerHTML={{
                __html: toCode39Svg(order.orderCode, {
                  height: 42,
                  narrow: 2,
                  wide: 5,
                  margin: 4,
                  showText: true,
                }),
              }}
            />
            <img
              className="w-14 h-14"
              alt="QR"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
                order.orderCode
              )}`}
            />
          </div>
        </div>

        {/* Items */}
        <div className="mt-2 border-t border-b border-gray-200">
          {order.items.map((it) => (
            <div key={it.id} className="flex py-1">
              <div className="flex-1">
                <div className="text-[12px] font-medium text-gray-900">
                  {it.name}
                </div>
                <div className="text-[10px] text-gray-600">
                  {it.qty} × {peso(Number(it.unitPrice))}
                </div>
              </div>
              <div className="text-[12px] font-medium">
                {peso(Number(it.lineTotal))}
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="mt-1 text-[12px]">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="font-medium">{peso(Number(order.subtotal))}</span>
          </div>
          <div className="flex justify-between">
            <span>Total (before discounts)</span>
            <span className="font-semibold">
              {peso(Number(order.totalBeforeDiscount))}
            </span>
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-2 text-[10px] text-gray-600">
          Please pay at cashier. Discounts applied only at cashier. Keep this
          slip.
        </div>
      </div>

      {/* NON-PRINT CONTROLS */}
      <div className="mt-3 flex gap-2 justify-center no-print">
        <button
          onClick={() => window.print()}
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm"
        >
          Print
        </button>

        <button
          onClick={copyCode}
          className="px-3 py-1 rounded border border-gray-300 text-sm text-gray-700"
        >
          Copy code
        </button>

        {/* Reprint & increment: server will redirect back with ?autoprint=1 */}
        <Form method="post" action={location.pathname + location.search}>
          <input type="hidden" name="_action" value="reprint" />
          <button
            type="submit"
            className="px-3 py-1 rounded bg-black text-white hover:opacity-90 text-sm"
          >
            Reprint & increment
          </button>
        </Form>

        <a href="/kiosk" className="px-3 py-1 rounded border text-sm">
          Back to Kiosk
        </a>
      </div>

      {/* Print styles */}
      <style>{`
        /* 57/58mm ticket width */
        .ticket {
          width: 56mm;
          background: white;
          padding: 4mm 3mm;
        }
        .ticket * { line-height: 1.25; }
        .ticket svg { max-width: 100% !important; height: auto !important; }

        @media print {
          .no-print { display: none !important; }
          html, body { background: white; }
          body { margin: 0; }
        }
        @page {
          size: 58mm auto;
          margin: 0;
        }
      `}</style>
    </div>
  );
}
