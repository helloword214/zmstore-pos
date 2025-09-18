import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  // helper: normalize possible string/Decimal/null to finite number or null
  const toNum = (v: unknown): number | null => {
    const n =
      typeof v === "string"
        ? parseFloat(v)
        : typeof v === "number"
        ? v
        : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: {
        select: {
          id: true,
          name: true,
          qty: true,
          unitPrice: true,
          lineTotal: true,
        },
      },
    },
  });
  if (!order) throw new Response("Not found", { status: 404 });
  if (order.channel !== "DELIVERY") {
    // Not a delivery order—nothing to print here
    throw new Response("Not a delivery order", { status: 400 });
  }

  // Build map link: coords → exact; else → text search (robust to string/Decimal/null)
  const lat = toNum(order.deliverGeoLat);
  const lng = toNum(order.deliverGeoLng);
  const hasCoords = lat != null && lng != null;

  const mapUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        [order.deliverTo || "", order.deliverLandmark || ""]
          .filter(Boolean)
          .join(" ")
          .trim()
      )}`;

  return json({
    order: {
      id: order.id,
      orderCode: order.orderCode,
      printedAt: order.printedAt,
      dispatchedAt: order.dispatchedAt,
      riderName: order.riderName,
      deliverTo: order.deliverTo,
      deliverPhone: order.deliverPhone,
      deliverLandmark: order.deliverLandmark,
      deliverGeoLat: lat, // normalized number or null
      deliverGeoLng: lng, // normalized number or null
      channel: order.channel,
      items: order.items ?? [],
      subtotal: order.subtotal,
      totalBeforeDiscount: order.totalBeforeDiscount,
    },
    mapUrl,
    hasCoords,
  });
}

export default function DeliveryTicket() {
  const { order, mapUrl, hasCoords } = useLoaderData<typeof loader>();
  const [sp] = useSearchParams();

  React.useEffect(() => {
    const autoprint = sp.get("autoprint") === "1";
    const autoback = sp.get("autoback") === "1";
    if (!autoprint) return;
    // Give images (QR) a moment to load, then print. Track both timers and clean up correctly.
    let t2: number | undefined;
    const t = window.setTimeout(() => {
      window.print();
      if (autoback) {
        // after print, go back to previous page (e.g., cashier)
        t2 = window.setTimeout(() => {
          if (window.history.length > 1) {
            window.history.back();
          } else {
            window.location.href = "/cashier";
          }
        }, 200);
      }
    }, 300);
    return () => {
      window.clearTimeout(t);
      if (t2) window.clearTimeout(t2);
    };
  }, [sp]);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const when = order.dispatchedAt ?? order.printedAt ?? new Date();

  // Simple QR via public API (no new deps). You can swap to a local lib later.
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
    mapUrl
  )}`;

  return (
    <div className="ticket">
      <h1>DELIVERY TICKET</h1>
      <div className="muted">Not an Official Receipt</div>

      <div className="row">
        <div>Order:</div>
        <div className="mono">{order.orderCode}</div>
      </div>
      <div className="row">
        <div>Date/Time:</div>
        <div className="mono">{new Date(when).toLocaleString()}</div>
      </div>
      {order.riderName ? (
        <div className="row">
          <div>Rider:</div>
          <div className="mono">{order.riderName}</div>
        </div>
      ) : null}

      <hr />

      <div className="section">
        <div className="label">Deliver To</div>
        <div className="block">{order.deliverTo || "—"}</div>
        {order.deliverPhone ? (
          <div className="block">📞 {order.deliverPhone}</div>
        ) : null}
        {order.deliverLandmark ? (
          <div className="block">🧭 Landmark: {order.deliverLandmark}</div>
        ) : null}
      </div>

      <div className="section">
        <div className="label">Maps</div>
        <div className="block">
          {hasCoords ? "Exact pin" : "Search fallback"}
        </div>
        <div className="qr">
          <img src={qrSrc} alt="Map QR" />
        </div>
        <div className="tiny mono wrap">{mapUrl}</div>
      </div>

      <hr />

      <div className="section">
        <div className="label">Items</div>
        <table className="items">
          <tbody>
            {order.items.map((it) => {
              const qty = Number(it.qty);
              const unit = Number(it.unitPrice);
              const line = Number(it.lineTotal ?? qty * unit);
              return (
                <tr key={it.id}>
                  <td className="name">{it.name}</td>
                  <td className="qty mono">{qty}</td>
                  <td className="unit mono">{fmt(unit)}</td>
                  <td className="line mono">{fmt(line)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row total">
          <div>Items Total:</div>
          <div className="mono">{fmt(order.totalBeforeDiscount)}</div>
        </div>
      </div>

      <hr />

      <div className="section tiny">
        <div>
          Doorstep collection (cash / ack notes): ___________________________
        </div>
        <div style={{ height: 4 }} />
        <div>LPG Check (if applicable): ______________________</div>
      </div>

      <div className="footer muted tiny">
        Inventory deducts at <strong>DISPATCHED</strong>. Receipt (OR/ACK)
        prints at <strong>Remit</strong>.
      </div>

      {/* Print styles */}
      <style>{`
        * { box-sizing: border-box; }
        body, html, #root { background: #fff; }
        .ticket {
          width: 58mm; /* 57/58mm thermal */
          padding: 8px 10px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;
          font-size: 11.5px;
          color: #111;
        }
        h1 {
          text-align: center;
          font-size: 14px;
          margin: 0 0 2px;
          letter-spacing: 0.5px;
        }
        .muted { color: #666; text-align: center; }
        .tiny { font-size: 10px; }
        .mono { font-variant-numeric: tabular-nums; }
        .wrap { word-break: break-word; }
        .row { display: flex; justify-content: space-between; margin: 3px 0; }
        .section { margin: 6px 0; }
        .label { font-weight: 700; margin-bottom: 2px; }
        .block { margin: 1px 0; }
        .qr { display: flex; justify-content: center; margin: 6px 0; }
        .qr img { width: 140px; height: 140px; }
        .items { width: 100%; border-collapse: collapse; }
        .items td { padding: 2px 0; vertical-align: top; }
        .items .name { width: 48%; padding-right: 6px; }
        .items .qty { width: 12%; text-align: right; }
        .items .unit { width: 20%; text-align: right; }
        .items .line { width: 20%; text-align: right; }
        .total { margin-top: 4px; font-weight: 700; }
        hr { border: none; border-top: 1px dashed #bbb; margin: 6px 0; }
        .footer { text-align: center; margin-top: 8px; }
        @media print {
          .ticket { margin: 0; padding: 0 6px; }
          body { margin: 0; }
        }
      `}</style>
    </div>
  );
}
