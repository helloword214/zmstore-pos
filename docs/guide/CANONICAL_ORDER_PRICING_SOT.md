# Canonical Order Pricing Engine + Freeze SoT

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-21
Supersedes: `docs/archive/guide/PRICING_SOURCE_OF_TRUTH.md` (historical)

## Purpose

Defines the binding source of truth for:

- Order Pad order creation pricing
- policy/system discount application
- frozen pricing snapshot fields used by all downstream flows

This document covers policy discounts at order creation and explicitly excludes manager clearance override discount at settlement stage.

## Scope Boundary

In scope:

- `app/routes/pad-order._index.tsx` (UI payload + preflight only)
- `app/routes/orders.new.tsx` (authoritative server create + freeze point)
- `app/services/pricing.ts` (canonical discount engine + rule mapping)
- `app/routes/customers.$id_.pricing.tsx`
- `app/routes/customers.$id_.pricing_.$ruleId.tsx`
- `CustomerItemPrice` rule model
- `Order` and `OrderItem` frozen pricing fields

Out of scope:

- Manager clearance override discount (`approvedDiscount`) in `app/routes/store.clearance_.$caseId.tsx`
- CSS settlement decision logic and AR classification

## Non-Negotiable SoT Rules

1. Pricing engine runs once at order creation (`/orders/new`).
2. Frozen pricing lives in `OrderItem` snapshots, not in live product prices.
3. Downstream routes must read frozen values; no repricing after order creation.
4. `pad-order._index.tsx` is view/preflight only; it is not pricing authority.
5. Manager clearance override discount does not mutate frozen `OrderItem` values.

## Canonical Base Price Rules

For a product:

1. `baseRetail = product.price`
2. `basePack = product.srp` when `srp > 0`, else `product.price`

Unit use:

1. `RETAIL` uses `baseRetail`
2. `PACK` uses `basePack`

Notes:

1. `packingSize` is not part of canonical base price computation.
2. Retail enablement still requires business guards (`allowPackSale`, retail stock, valid base price).

## Customer Rule Model (`CustomerItemPrice`)

Supported modes:

1. `FIXED_PRICE`
2. `FIXED_DISCOUNT`
3. `PERCENT_DISCOUNT`

Engine mapping (`app/services/pricing.ts`):

1. `FIXED_PRICE` -> `PRICE_OVERRIDE` to exact unit price
2. `FIXED_DISCOUNT` -> converted to `PRICE_OVERRIDE` where `override = max(0, base - value)`
3. `PERCENT_DISCOUNT` -> `PERCENT_OFF`

Rule validity gate:

1. `active = true`
2. `startsAt <= now` (or null)
3. `endsAt >= now` (or null)
4. selector match by `productId` + `unitKind`

## Order Creation Flow (Authoritative)

At `app/routes/orders.new.tsx`:

1. Validate cart payload, mode, qty, price freshness, stock, and delivery constraints.
2. Resolve canonical base per line from fresh product rows.
3. Build pricing cart using base unit prices.
4. Load active customer rules only when `customerId` exists.
5. Apply `applyDiscounts()` to derive effective unit prices.
6. Clamp `finalEffectiveUnit <= baseUnit` (engine can reduce only, never increase).
7. Compute totals and enforce invariant checks before save.
8. Persist frozen snapshot fields to `Order` and `OrderItem`.

## Frozen Snapshot Fields (DB Authority)

`OrderItem`:

1. `unitKind`
2. `baseUnitPrice`
3. `unitPrice` (effective/payable)
4. `discountAmount` (`baseUnitPrice - unitPrice`, per unit)
5. `lineTotal` (`qty * unitPrice`)

`Order` header:

1. `totalBeforeDiscount` (sum of `qty * baseUnitPrice`)
2. `subtotal` (sum of `lineTotal`)

## Engine Semantics (`applyDiscounts`)

Per item:

1. Sort active rules by priority desc, then stable by id.
2. Apply at most one override (`PRICE_OVERRIDE`) first.
3. Apply all matching percentage discounts multiplicatively.
4. Aggregate per-rule applied amounts for discount breakdown.

## Downstream Read Rules

After order creation:

1. Receipt/ticket/remit/check-in/cashier views must read frozen pricing from `OrderItem` (or frozen mirror lines where applicable).
2. Do not pull live `Product.price`/`Product.srp` to recalculate payable totals for existing orders.
3. Do not rerun pricing engine to redefine order payable totals.

## Boundary: Policy Discount vs Clearance Override Discount

Policy/system discount:

1. Computed at order creation by pricing engine.
2. Frozen into `OrderItem.baseUnitPrice`, `OrderItem.discountAmount`, `OrderItem.lineTotal`.

Manager clearance override discount:

1. Decided later via CSS (`approvedDiscount`).
2. Affects settlement split (`AR` vs waived shortage), not frozen order pricing snapshot.
3. Must remain traceable in clearance decision records.

## Explicit Anti-Rules

1. Do not treat `pad-order` client subtotal as pricing authority.
2. Do not mutate `OrderItem.unitPrice`, `lineTotal`, `baseUnitPrice`, or `discountAmount` after creation.
3. Do not infer customer AR principal from policy discount fields.
4. Do not mix manager clearance override discount into pricing engine recomputation.

## Quick Audit Checklist

1. New order has frozen fields populated on each `OrderItem`.
2. `Order.totalBeforeDiscount` equals sum of base line totals.
3. `Order.subtotal` equals sum of frozen `lineTotal`.
4. No downstream route recomputes payable totals from live product prices.
5. Clearance decisions reference shortage settlement only, without editing frozen pricing.
