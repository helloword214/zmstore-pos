/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { db } from "~/utils/db.server";

// Small helpers
const toNum = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const isInt = (n: number) => Number.isInteger(n);
const isMultipleOf = (n: number, step: number) =>
  // tolerant modulo for floats (e.g., 0.1 + 0.2)
  Math.abs(n / step - Math.round(n / step)) < 1e-8;

type Mode = "retail" | "pack";

type IncomingItem = {
  id: number;
  name?: string; // snapshot from client; server won't trust it for validation
  qty: number;
  unitPrice: number;
  mode?: Mode; // optional; we infer if missing
};

export const action: ActionFunction = async ({ request }) => {
  const url = new URL(request.url);
  const wantsJson = url.searchParams.get("respond") === "json";

  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  const form = await request.formData();
  const itemsRaw = form.get("items");
  const terminalId = String(form.get("terminalId") ?? "KIOSK-UNKNOWN");

  // ── NEW: channel + delivery snapshot fields (all optional unless channel=DELIVERY)
  const channelRaw = String(form.get("channel") ?? "PICKUP").toUpperCase();
  const channel = channelRaw === "DELIVERY" ? "DELIVERY" : "PICKUP";
  const deliverTo = (form.get("deliverTo") ?? "").toString().trim();
  const deliverPhone =
    (form.get("deliverPhone") ?? "").toString().trim() || null;
  const deliverLandmark =
    (form.get("deliverLandmark") ?? "").toString().trim() || null;
  const deliverGeoLatRaw = (form.get("deliverGeoLat") ?? "").toString().trim();
  const deliverGeoLngRaw = (form.get("deliverGeoLng") ?? "").toString().trim();
  const deliverPhotoUrl =
    (form.get("deliverPhotoUrl") ?? "").toString().trim() || null;
  const deliveryAddressIdVal = Number(form.get("deliveryAddressId") ?? 0);
  const deliveryAddressId =
    Number.isFinite(deliveryAddressIdVal) && deliveryAddressIdVal > 0
      ? deliveryAddressIdVal
      : null;

  // Validate delivery rules only when channel is DELIVERY
  if (channel === "DELIVERY") {
    if (!deliverTo) {
      return json(
        { error: "deliverTo is required for delivery orders." },
        { status: 400 }
      );
    }
    const latGiven = deliverGeoLatRaw !== "";
    const lngGiven = deliverGeoLngRaw !== "";
    if ((latGiven && !lngGiven) || (!latGiven && lngGiven)) {
      return json(
        {
          error:
            "Both deliverGeoLat and deliverGeoLng must be set, or both left blank.",
        },
        { status: 400 }
      );
    }
    // If both provided, they must be valid numbers
    if (latGiven && lngGiven) {
      const lat = Number(deliverGeoLatRaw);
      const lng = Number(deliverGeoLngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json(
          { error: "deliverGeoLat and deliverGeoLng must be valid numbers." },
          { status: 400 }
        );
      }
    }
  }

  if (!itemsRaw || typeof itemsRaw !== "string") {
    return json({ error: "`items` missing" }, { status: 400 });
  }

  let items: IncomingItem[];
  try {
    items = JSON.parse(itemsRaw);
    if (!Array.isArray(items) || items.length === 0) {
      return json(
        { error: "`items` must be a non-empty array" },
        { status: 400 }
      );
    }
  } catch {
    return json({ error: "`items` is not valid JSON" }, { status: 400 });
  }

  // Basic shape check
  for (const [i, it] of items.entries()) {
    if (typeof it !== "object" || it == null) {
      return json({ error: `items[${i}] invalid` }, { status: 400 });
    }
    if (!Number.isFinite((it as any).id)) {
      return json({ error: `items[${i}].id missing/invalid` }, { status: 400 });
    }
    if (!Number.isFinite((it as any).qty) || toNum((it as any).qty) <= 0) {
      return json({ error: `items[${i}].qty must be > 0` }, { status: 400 });
    }
    if (
      !Number.isFinite((it as any).unitPrice) ||
      toNum((it as any).unitPrice) <= 0
    ) {
      return json(
        { error: `items[${i}].unitPrice must be > 0` },
        { status: 400 }
      );
    }
    if (
      (it as any).mode &&
      (it as any).mode !== "retail" &&
      (it as any).mode !== "pack"
    ) {
      return json(
        { error: `items[${i}].mode must be "retail" or "pack"` },
        { status: 400 }
      );
    }
  }

  // Fetch fresh product rows for validation
  const ids = Array.from(new Set(items.map((it) => it.id)));
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      allowPackSale: true,
      // canonical mapping:
      // - stock        = pack count
      // - packingStock = retail units
      stock: true,
      packingStock: true,
      price: true, // retail price
      srp: true, // pack price
      unit: { select: { name: true } },
      packingUnit: { select: { name: true } },
      packingSize: true,
      isActive: true,
    },
  });

  const byId = new Map(products.map((p) => [p.id, p]));

  type LineOk = {
    id: number;
    name: string;
    mode: Mode;
    qty: number;
    unitPrice: number;
    unitLabel?: string | null;
  };

  const errors: Array<{ id: number; mode?: Mode; reason: string }> = [];
  const ok: LineOk[] = [];

  for (const it of items) {
    const row = byId.get(it.id);
    if (!row || !row.isActive) {
      errors.push({ id: it.id, reason: "Product not found or inactive" });
      continue;
    }

    // Normalize numbers (Decimal -> number)
    const packStock = toNum(row.stock, 0); // whole packs
    const retailStock = toNum(row.packingStock, 0); // loose units
    const price = toNum(row.price, 0); // retail price
    const srp = toNum(row.srp, 0); // pack price

    // Determine mode (prefer client-provided; else infer from price)
    let mode: Mode | null = (it.mode as Mode) ?? null;
    if (!mode) {
      if (row.allowPackSale && Math.abs(it.unitPrice - price) < 1e-8)
        mode = "retail";
      else if (Math.abs(it.unitPrice - srp) < 1e-8) mode = "pack";
      else mode = null;
    }
    if (!mode) {
      errors.push({
        id: it.id,
        reason:
          "Ambiguous mode: unitPrice doesn't match current retail or pack price",
      });
      continue;
    }

    // Per-mode validation
    if (mode === "retail") {
      if (!row.allowPackSale) {
        errors.push({
          id: it.id,
          mode,
          reason: "Retail not allowed for this product",
        });
        continue;
      }
      if (price <= 0) {
        errors.push({ id: it.id, mode, reason: "Retail price is not set" });
        continue;
      }
      if (!isMultipleOf(it.qty, 0.25)) {
        errors.push({
          id: it.id,
          mode,
          reason: "Retail qty must be a multiple of 0.25",
        });
        continue;
      }
      if (it.qty > retailStock) {
        errors.push({
          id: it.id,
          mode,
          reason: `Retail stock insufficient (need ${it.qty}, have ${retailStock})`,
        });
        continue;
      }
      if (Math.abs(it.unitPrice - price) > 1e-8) {
        errors.push({
          id: it.id,
          mode,
          reason: `Retail price changed (client ${it.unitPrice}, current ${price})`,
        });
        continue;
      }
      ok.push({
        id: it.id,
        name: row.name,
        mode,
        qty: it.qty,
        unitPrice: price,
        unitLabel: row.unit?.name ?? null,
      });
    } else {
      // mode === "pack"
      if (srp <= 0) {
        errors.push({ id: it.id, mode, reason: "Pack price (SRP) is not set" });
        continue;
      }
      if (!isInt(it.qty)) {
        errors.push({
          id: it.id,
          mode,
          reason: "Pack qty must be a whole number",
        });
        continue;
      }
      if (it.qty > packStock) {
        errors.push({
          id: it.id,
          mode,
          reason: `Pack stock insufficient (need ${it.qty}, have ${packStock})`,
        });
        continue;
      }
      if (Math.abs(it.unitPrice - srp) > 1e-8) {
        errors.push({
          id: it.id,
          mode,
          reason: `Pack price changed (client ${it.unitPrice}, current ${srp})`,
        });
        continue;
      }
      ok.push({
        id: it.id,
        name: row.name,
        mode,
        qty: it.qty,
        unitPrice: srp,
        unitLabel: row.packingUnit?.name ?? null,
      });
    }
  }

  if (errors.length > 0) {
    return json({ errors }, { status: 400 });
  }

  // Compute totals
  const subtotal = ok.reduce((s, l) => s + l.qty * l.unitPrice, 0);

  // Create order (+ items). Inventory is NOT deducted here (that happens at payment).
  const now = new Date();
  const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const created = await db.order.create({
    data: {
      status: "UNPAID",
      channel: channel as any, // ok as-is; replace with OrderChannel if you prefer
      subtotal,
      totalBeforeDiscount: subtotal,
      printedAt: now,
      expiryAt: expiry,
      printCount: 1,
      terminalId,
      // Snapshot delivery fields only for DELIVERY channel
      ...(channel === "DELIVERY"
        ? {
            deliverTo,
            deliverPhone,
            deliverLandmark,
            deliverGeoLat: deliverGeoLatRaw ? Number(deliverGeoLatRaw) : null,
            deliverGeoLng: deliverGeoLngRaw ? Number(deliverGeoLngRaw) : null,
            deliverPhotoUrl,
            deliveryAddressId,
            // fulfillmentStatus will default to NEW per schema; no need to set explicitly.
          }
        : {}),
      // If you have orderCode helper, use it here instead of this simple code:
      orderCode: `OS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(
        2,
        "0"
      )}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      items: {
        create: ok.map((l) => ({
          name: l.name, // snapshot
          unitPrice: l.unitPrice, // snapshot (Decimal column accepts number)
          qty: l.qty, // snapshot (Decimal column accepts number)
          lineTotal: Number((l.qty * l.unitPrice).toFixed(2)),
          product: { connect: { id: l.id } }, // satisfy required relation
          // If your schema has these columns, uncomment:
          // mode: l.mode.toUpperCase() as any, // "RETAIL" | "PACK"
          // unitLabel: l.unitLabel ?? null,
        })),
      },
    },

    select: { id: true, orderCode: true },
  });

  // Either JSON (for order-pad fetcher) or normal redirect (other flows)
  if (wantsJson) {
    return json({
      ok: true,
      id: created.id,
      orderCode: created.orderCode,
      channel,
    });
  }
  // For DELIVERY, print Delivery Ticket stub; for PICKUP, show the usual slip
  if (channel === "DELIVERY") {
    return redirect(`/orders/${created.id}/ticket?autoprint=1&autoback=1`);
  }
  return redirect(`/orders/${created.id}/slip`);
};
