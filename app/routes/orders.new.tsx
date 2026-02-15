/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { UnitKind, Prisma } from "@prisma/client";
import {
  applyDiscounts,
  fetchActiveCustomerRules,
  type Cart,
  type CartItem,
} from "~/services/pricing";

// Small helpers
const toNum = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const isInt = (n: number) => Number.isInteger(n);
const isMultipleOf = (n: number, step: number) =>
  // tolerant modulo for floats (e.g., 0.1 + 0.2)
  Math.abs(n / step - Math.round(n / step)) < 1e-8;

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp0 = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
const almostEq = (a: number, b: number, eps = 1e-8) => Math.abs(a - b) < eps;

type Mode = "retail" | "pack";

type IncomingItem = {
  id: number;
  name?: string; // snapshot from client; server won't trust it for validation
  qty: number;
  unitPrice?: number; // optional: freshness check only (if provided)
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

  // ✅ Duplication-safe: FormData.get() returns the FIRST value.
  // If there are duplicate inputs, we want the LAST non-empty value.
  const customerIdRaw = form
    .getAll("customerId")
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(-1)[0];
  const customerIdNum = customerIdRaw ? Number(customerIdRaw) : NaN;
  const customerId =
    Number.isFinite(customerIdNum) && customerIdNum > 0 ? customerIdNum : null;
  const deliverTo = (form.get("deliverTo") ?? "").toString().trim();
  const deliverPhone =
    (form.get("deliverPhone") ?? "").toString().trim() || null;
  const deliverLandmark =
    (form.get("deliverLandmark") ?? "").toString().trim() || null;
  const deliverGeoLatRaw = (form.get("deliverGeoLat") ?? "").toString().trim();
  const deliverGeoLngRaw = (form.get("deliverGeoLng") ?? "").toString().trim();
  const deliverPhotoUrl =
    (form.get("deliverPhotoUrl") ?? "").toString().trim() || null;

  // ✅ Duplication-safe for deliveryAddressId too (same FormData.get() issue)
  const deliveryAddressIdRaw = form
    .getAll("deliveryAddressId")
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(-1)[0];
  const deliveryAddressIdVal = deliveryAddressIdRaw
    ? Number(deliveryAddressIdRaw)
    : NaN;
  const deliveryAddressId =
    Number.isFinite(deliveryAddressIdVal) && deliveryAddressIdVal > 0
      ? deliveryAddressIdVal
      : null;

  // Validate delivery rules only when channel is DELIVERY
  if (channel === "DELIVERY") {
    if (!deliverTo) {
      return json(
        { error: "deliverTo is required for delivery orders." },
        { status: 400 },
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
        { status: 400 },
      );
    }
    // If both provided, they must be valid numbers
    if (latGiven && lngGiven) {
      const lat = Number(deliverGeoLatRaw);
      const lng = Number(deliverGeoLngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json(
          { error: "deliverGeoLat and deliverGeoLng must be valid numbers." },
          { status: 400 },
        );
      }
    }
  }

  // ✅ SoT safety: if deliveryAddressId is provided, it must belong to the selected customer.
  if (deliveryAddressId && customerId) {
    const addr = await db.customerAddress.findFirst({
      where: { id: deliveryAddressId, customerId },
      select: { id: true },
    });
    if (!addr) {
      return json(
        {
          error: "deliveryAddressId does not belong to the selected customer.",
        },
        { status: 400 },
      );
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
        { status: 400 },
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
    // unitPrice is OPTIONAL now (freshness check only)
    if ((it as any).unitPrice != null) {
      if (
        !Number.isFinite((it as any).unitPrice) ||
        toNum((it as any).unitPrice) <= 0
      ) {
        return json(
          { error: `items[${i}].unitPrice must be > 0 when provided` },
          { status: 400 },
        );
      }
    }
    if (
      (it as any).mode &&
      (it as any).mode !== "retail" &&
      (it as any).mode !== "pack"
    ) {
      return json(
        { error: `items[${i}].mode must be "retail" or "pack"` },
        { status: 400 },
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
      allowPackSale: true, // legacy flag name; currently used as "allow retail" in this file
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
    unitPrice: number; // ✅ effective/payable unit price (after pricing engine)
    baseUnitPrice: number; // SRP/base (unit-aware)
    discountAmount: number; // base - effective (>=0)
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

    const clientUnitPrice =
      it.unitPrice != null ? toNum(it.unitPrice, 0) : null;

    // Normalize numbers (Decimal -> number)
    const packStock = toNum(row.stock, 0); // whole packs
    const retailStock = toNum(row.packingStock, 0); // loose units
    const price = toNum(row.price, 0); // retail price
    const srp = toNum(row.srp, 0); // pack price

    // ✅ NEW RULE: base prices come directly from DB fields
    // - baseRetail = product.price (explicit; may be higher than derived)
    // - basePack = product.srp (fallback to price)
    const baseRetail = clamp0(price);
    const basePack = clamp0(srp > 0 ? srp : price);

    // Retail enabled if:
    // - allow retail flag
    // - retail has a base price
    // - has retail stock
    // packingSize can be optional now (only needed for certain validation if you want)
    const retailEnabled =
      Boolean(row.allowPackSale) && baseRetail > 0 && retailStock > 0;

    // Determine mode (prefer client-provided; else infer from price)
    let mode: Mode | null = (it.mode as Mode) ?? null;
    if (!mode) {
      // If client provided a unitPrice, we can infer mode from it.
      if (clientUnitPrice != null) {
        if (
          row.allowPackSale &&
          retailEnabled &&
          almostEq(clientUnitPrice, baseRetail)
        ) {
          mode = "retail";
        } else if (almostEq(clientUnitPrice, basePack)) {
          mode = "pack";
        } else {
          mode = null;
        }
      } else {
        // No clientUnitPrice: prefer retail if explicitly enabled; else pack.
        mode = retailEnabled ? "retail" : "pack";
      }
    }
    if (!mode) {
      errors.push({
        id: it.id,
        reason:
          "Ambiguous mode: provide mode or refresh prices (unitPrice mismatch)",
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
      if (!retailEnabled) {
        errors.push({
          id: it.id,
          mode,
          reason: "Retail not enabled (not allowed / no stock / no price)",
        });
        continue;
      }
      if (baseRetail <= 0) {
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
      // Freshness guard only if client sent a unitPrice
      if (clientUnitPrice != null && !almostEq(clientUnitPrice, baseRetail)) {
        errors.push({
          id: it.id,
          mode,
          reason: `Retail price changed (client ${clientUnitPrice}, current ${baseRetail})`,
        });
        continue;
      }
      // For now, effective == baseRetail (later: pricing engine can lower this)
      const effective = baseRetail;
      const disc = r2(Math.max(0, baseRetail - effective));
      ok.push({
        id: it.id,
        name: row.name,
        mode,
        qty: it.qty,
        unitPrice: effective,
        baseUnitPrice: baseRetail,
        discountAmount: disc,
        unitLabel: row.unit?.name ?? null,
      });
    } else {
      // mode === "pack"
      if (basePack <= 0) {
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
      // Freshness guard only if client sent a unitPrice
      if (clientUnitPrice != null && !almostEq(clientUnitPrice, basePack)) {
        errors.push({
          id: it.id,
          mode,
          reason: `Pack price changed (client ${clientUnitPrice}, current ${basePack})`,
        });
        continue;
      }
      // For now, effective == basePack (later: pricing engine can lower this)
      const effective = basePack;
      const disc = r2(Math.max(0, basePack - effective));
      ok.push({
        id: it.id,
        name: row.name,
        mode,
        qty: it.qty,
        unitPrice: effective,
        baseUnitPrice: basePack,
        discountAmount: disc,
        unitLabel: row.packingUnit?.name ?? null,
      });
    }
  }

  if (errors.length > 0) {
    // Match the pad's expected shape: { ok:false, errors:[...] }
    return json({ ok: false, errors }, { status: 400 });
  }

  // ✅ Apply pricing engine ONCE at order creation (PAD view-only; DB becomes source of truth)
  // Build cart using BASE prices (not client prices), so the rule engine reduces from base.
  // ✅ If no customer, do not fetch rules (avoids null-id Prisma issues, and enforces SoT)
  const rules = customerId
    ? await fetchActiveCustomerRules(db, customerId)
    : [];
  const cart: Cart = {
    items: ok.map(
      (l, idx): CartItem => ({
        id: idx + 1,
        productId: l.id,
        name: l.name,
        qty: l.qty,
        unitPrice: l.baseUnitPrice, // base goes into engine
        unitKind: l.mode === "retail" ? "RETAIL" : "PACK",
      }),
    ),
  };

  const priced = applyDiscounts(
    cart,
    rules,
    customerId ? { id: customerId } : undefined,
  );
  const effByCartId = new Map<number, number>();
  for (const adj of priced.adjustedItems ?? []) {
    if (!Number.isFinite(adj.id)) continue;
    effByCartId.set(adj.id, Number(adj.effectiveUnitPrice ?? 0));
  }

  // Mutate ok[] to carry effective + discount audit
  for (let i = 0; i < ok.length; i++) {
    const cartId = i + 1;
    const base = clamp0(ok[i].baseUnitPrice);
    const effRaw = effByCartId.get(cartId);
    const eff = Number.isFinite(effRaw) && effRaw! > 0 ? r2(effRaw!) : base;

    // Never allow engine to increase price above base
    const finalEff = Math.min(base, eff);
    ok[i].unitPrice = finalEff;
    ok[i].discountAmount = r2(Math.max(0, base - finalEff));
  }

  // Compute totals: base vs effective
  const totalBeforeDiscount = r2(
    ok.reduce((s, l) => s + clamp0(l.qty) * clamp0(l.baseUnitPrice), 0),
  );
  const subtotal = r2(
    ok.reduce((s, l) => s + clamp0(l.qty) * clamp0(l.unitPrice), 0),
  );

  // ✅ Invariant: recompute line totals and ensure totals match what we'll store
  const lineTotals = ok.map((l) => r2(clamp0(l.qty) * clamp0(l.unitPrice)));
  const baseLineTotals = ok.map((l) =>
    r2(clamp0(l.qty) * clamp0(l.baseUnitPrice)),
  );
  const subtotal2 = r2(lineTotals.reduce((s, x) => s + x, 0));
  const totalBefore2 = r2(baseLineTotals.reduce((s, x) => s + x, 0));
  if (
    !almostEq(subtotal, subtotal2) ||
    !almostEq(totalBeforeDiscount, totalBefore2)
  ) {
    return json(
      {
        ok: false,
        errors: [
          {
            id: 0,
            reason:
              "Pricing invariant failed (totals mismatch). Please refresh and try again.",
          },
        ],
      },
      { status: 400 },
    );
  }

  // Create order (+ items). Inventory is NOT deducted here (that happens at payment).
  const now = new Date();
  const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const created = await db.order.create({
    data: {
      status: "UNPAID",
      channel: channel as any, // ok as-is; replace with OrderChannel if you prefer
      subtotal,
      totalBeforeDiscount,
      printedAt: now,
      expiryAt: expiry,
      printCount: 1,
      terminalId,
      customerId, // ← link customer (optional even for pickup)
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
        "0",
      )}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      items: {
        create: ok.map((l) => ({
          name: l.name, // snapshot
          unitPrice: new Prisma.Decimal(r2(l.unitPrice).toFixed(2)),
          qty: new Prisma.Decimal(clamp0(l.qty).toFixed(2)),
          lineTotal: new Prisma.Decimal(r2(l.qty * l.unitPrice).toFixed(2)),
          product: { connect: { id: l.id } }, // satisfy required relation
          // ✅ Source of truth: store unit kind at creation (never infer using live prices later)
          unitKind: (l.mode === "retail"
            ? UnitKind.RETAIL
            : UnitKind.PACK) as any,
          // ✅ discount audit freeze (view-only in PAD; used later everywhere)
          baseUnitPrice: new Prisma.Decimal(
            r2(clamp0(l.baseUnitPrice)).toFixed(2),
          ),
          discountAmount: new Prisma.Decimal(
            r2(clamp0(l.discountAmount)).toFixed(2),
          ),
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
