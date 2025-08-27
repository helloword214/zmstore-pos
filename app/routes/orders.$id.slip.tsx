import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { useEffect, useState, useCallback } from "react";
import { toCode39Svg } from "~/utils/orderBarcode";

type ActionData = {
  ok: boolean;
  error?: string;
  didReprint?: boolean;
  printCount?: number;
};

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

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  if (!id || Number.isNaN(id))
    return json({ ok: false, error: "Invalid ID" }, { status: 400 });

  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "");

  if (actionType === "reprint") {
    const updated = await db.order.update({
      where: { id },
      data: { printCount: { increment: 1 }, printedAt: new Date() },
      select: { printCount: true },
    });
    return json<ActionData>({
      ok: true,
      didReprint: true,
      printCount: updated.printCount,
    });
  }

  return json<ActionData>(
    { ok: false, error: "Unknown action" },
    { status: 400 }
  );
}

export default function OrderSlipPage() {
  const { order, isExpired } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  // After server increments printCount, auto-open browser print dialog
  useEffect(() => {
    const didReprint = !!(
      fetcher.data &&
      "didReprint" in fetcher.data &&
      (fetcher.data as any).didReprint
    );
    if (didReprint) window.print();
  }, [fetcher.data]);

  // Copy order code (for cashier scan fallback)
  const [copied, setCopied] = useState(false);
  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(order.orderCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }, [order.orderCode]);

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <div className="mx-auto max-w-md p-4 print:p-0">
      {/* Header */}
      <div className="text-center mb-2">
        <div className="font-semibold text-white">Zaldy Merchandise</div>
        <div className="text-xs text-gray-600">
          Poblacion East, Asingan, Pangasinan • 09199391932
        </div>
      </div>

      <div className="flex justify-between items-start mt-3">
        <div>
          <div className="text-sm">
            Order Code:{" "}
            <span className="font-mono font-semibold">{order.orderCode}</span>
          </div>
          <div className="text-xs text-gray-600">
            Printed: {new Date(order.printedAt).toLocaleString()}
          </div>
          <div
            className={`text-xs ${
              isExpired ? "text-red-600" : "text-gray-600"
            }`}
          >
            Expires: {new Date(order.expiryAt).toLocaleString()}{" "}
            {isExpired && "• EXPIRED"}
          </div>
          {order.printCount > 1 && (
            <div className="text-xs mt-1">Reprint #{order.printCount}</div>
          )}
        </div>

        {/* Code39 barcode + Copy + (optional) QR */}
        <div className="flex flex-col items-end gap-2">
          <div
            className="rounded-md border border-gray-200 px-2 py-1 bg-white text-gray-900"
            dangerouslySetInnerHTML={{
              __html: toCode39Svg(order.orderCode, {
                height: 56,
                narrow: 2,
                wide: 5,
                margin: 6,
                showText: true,
              }),
            }}
          />
          <button
            type="button"
            onClick={copyCode}
            className="px-2.5 py-1 rounded-md border border-gray-300 text-xs text-gray-600"
            aria-label="Copy order code"
          >
            {copied ? "Copied" : "Copy code"}
          </button>
          {/* Keep QR for now (optional) */}
          <img
            className="w-20 h-20"
            alt="QR"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
              order.orderCode
            )}`}
          />
        </div>
      </div>

      {/* Items */}
      <div className="mt-3 border-t border-b">
        {order.items.map((it) => (
          <div key={it.id} className="flex text-sm py-1">
            <div className="flex-1">
              <div className="font-medium text-gray-400">{it.name}</div>
              <div className="text-xs text-gray-600">
                {it.qty} × {peso(it.unitPrice)}
              </div>
            </div>
            <div className="font-medium">{peso(it.lineTotal)}</div>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="mt-2 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="font-medium">{peso(order.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Total (before discounts)</span>
          <span className="font-semibold">
            {peso(order.totalBeforeDiscount)}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 text-xs text-gray-600">
        Please pay at cashier. Discounts applied only at cashier. Keep this
        slip.
      </div>

      {/* Controls (hidden on print) */}
      <div className="mt-4 flex gap-2 no-print">
        <button
          onClick={() => window.print()}
          className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300 text-sm"
        >
          Print (no counter)
        </button>

        <fetcher.Form method="post">
          <input type="hidden" name="_action" value="reprint" />
          <button
            type="submit"
            className="px-3 py-1 rounded bg-black text-white hover:opacity-90 text-sm"
          >
            Reprint & increment counter
          </button>
        </fetcher.Form>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0 }
        }
      `}</style>
    </div>
  );
}
