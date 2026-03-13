# Canonical Product List Shape + Selling Modes SoT

Status: LOCKED  
Owner: POS Platform  
Last Reviewed: 2026-03-08

## Purpose

Define the current, binding behavior of Product List encoding and product item shape so future refactors and context resets can re-anchor quickly without re-deriving assumptions.

This is an as-is behavioral snapshot of current implementation.

## Scope Boundary

In scope:

1. `app/routes/products._index.tsx` (product list/filter + product-level inventory operations)
2. `app/routes/products.new.tsx` (product creation flow and payload shape)
3. `app/routes/products.$productId.edit.tsx` (product update flow and payload shape)
4. `app/routes/products.$productId.tsx` (product detail deep-link/read route)
5. `app/routes/pad-order._index.tsx` (cart mode + client preflight)
6. `app/routes/orders.new.tsx` (authoritative order-create validation)
7. stock deduction callers that consume the same shape (cashier/dispatch/credit)
8. `Product`, `Unit`, `PackingUnit` model semantics

Out of scope:

1. pricing policy engine internals (see `CANONICAL_ORDER_PRICING_SOT.md`)
2. CSS settlement decisions
3. product detail-page IA/UX redesign

## Product Item Shape (Current DB Meaning)

Primary model: `Product` in `prisma/schema.prisma`.

Core identity:

1. `id`, `name`, `categoryId`, `brandId`, `barcode`, `sku`, `isActive`

Dual-unit shape:

1. `unitId` = retail/base measurement unit (examples: `kg`, `ml`, `pc`)
2. `packingUnitId` = whole/container unit (examples: `sack`, `bottle`, `box`)
3. `packingSize` = quantity of `unit` inside one `packingUnit`
4. `allowPackSale` = retail-selling enablement flag (legacy name; operational meaning is "allow retail")

Price fields:

1. `srp` = whole/pack unit price
2. `price` = retail/base-unit price
3. `dealerPrice` = cost basis (inventory/business use)

## Price Input Behavior (Current)

From shared product upsert flow (`ProductUpsertForm` in
`products.new.tsx` and `products.$productId.edit.tsx`):

1. If `allowPackSale = true`, UI auto-suggests retail `price` from `srp / packingSize` (rounded to 2 decimals) when source values are valid.
2. Admin can manually override retail `price` after auto-suggest.
3. Backend validation enforces only positive required values (`price > 0` when retail is enabled).
4. Backend does not enforce a hard minimum floor against computed `srp / packingSize`.
5. Refactor guard agreed in discussion: if a floor check/warning is added later, keep it warning-only (non-blocking).

Stock fields:

1. `stock` = whole/pack stock
2. `packingStock` = retail/loose stock
3. `minStock` = alert threshold

Auxiliary:

1. `locationId`, `description`, `expirationDate`, `replenishAt`, `imageTag`
2. optional gallery photos: `ProductPhoto` (`slot` 1..4, metadata-first)
3. tagging/relations: `ProductIndication`, `ProductTarget`

## Product List Master-Data Boundary (Current)

1. `app/routes/products._index.tsx` treats `Brand`, `Location`, `Target`, and `Indication` as selection/filter data only.
2. Product list route does not expose destructive mutation actions for brand/location/target/indication.
3. Brand/location/target/indication master-data lifecycle changes should be handled from dedicated admin master-data workspace routes.
4. Category lifecycle is managed in `app/routes/creation._index.tsx` via create/rename/archive/unarchive.
5. Category hard delete is disabled in admin creation endpoints; policy is archive-only.
6. Archive action preserves product/brand/indication/target links and hides archived categories from default operator choices.

## Selling Modes (Current Runtime Contract)

Two selling modes exist at order time:

1. `PACK`
2. `RETAIL`

Mode selection and guards are evaluated from fresh product rows in `orders.new.tsx`.

### PACK Mode

1. Uses `srp` (fallback behavior handled in order-create path)
2. Quantity must be whole number
3. Deducts from `stock`
4. Represents whole/container sale

### RETAIL Mode

1. Requires `allowPackSale = true`
2. Uses `price`
3. Quantity must be a multiple of `0.25`
4. Deducts from `packingStock`
5. Represents loose/fractional sale from the base unit

## Canonical Examples (Current Encoding Style)

### Example A: Rice (retail-capable)

1. `unit = kg`
2. `packingUnit = sack`
3. `packingSize = 25`
4. `allowPackSale = true`
5. `srp = price per sack`
6. `price = price per kg`

### Example B: Shampoo bottle (whole-only)

1. `allowPackSale = false`
2. `unit = ml`
3. `packingUnit = bottle`
4. `packingSize = 135` (example: 135ml per bottle)
5. Sold by whole container only (pack mode)
6. Keep `srp` as sellable whole price
7. `price` is not used for order retail path when retail is disabled

### Example C: Accessories / cage (whole-only)

1. `allowPackSale = false`
2. Whole-only quantity behavior
3. Recommended unit pairing is explicit and non-ambiguous (for example `unit = pc`, `packingUnit = cage`, `packingSize = 1`)

### Example D: LPG 11kg cylinder (whole-only)

1. `allowPackSale = false`
2. `unit = kg`
3. `packingUnit = cylinder`
4. `packingSize = 11`
5. `srp` = sell price per full cylinder
6. `stock` = count of full cylinders

## LPG Hooks in Schema (Current Status)

1. `OrderItem` includes optional LPG-specific fields: `isLpg`, `lpgSwapKind`, `lpgEmptyReturned`, `lpgLoaned`.
2. No dedicated cylinder-loan ledger remains in the active schema.
3. Current `products._index.tsx`, `pad-order._index.tsx`, and `orders.new.tsx` flows are still driven by generic `PACK`/`RETAIL` logic.
4. Dedicated swap/loan runtime lifecycle is not a required/default behavior in active order-create path.
5. Treat current LPG fields as specialized hooks to be generalized in future refactor.

## Content vs Dimension Rule

Use `unit + packingSize` for product content quantity or quantity conversion only.

1. `packingSize` is for net content quantity (for example `135 ml`, `11 kg`, `25 kg`)
2. `packingSize` is not physical dimensions
3. Physical dimensions (for example `24x18x18`) are currently captured in product metadata text fields (name/description/SKU conventions), not in dedicated schema columns

## Expiration Semantics (Current)

1. `expirationDate` exists in `Product` and is optional.
2. Product create/edit validation does not globally require expiration for all items.
3. Catalog currently mixes consumables and non-consumables, so expiration applicability is product-dependent.

## SKU / Barcode / QR Behavior (Current)

1. `sku` and `barcode` are optional in schema (`String?`) and unique when present.
2. If SKU input is blank on save, SKU is auto-generated from category/brand/name pattern.
3. Admin can still manually provide SKU and override auto-suggested value.
4. Barcode is not required by product action validation.
5. Product form provides a manual "Generate barcode" button that creates local EAN-13.
6. Barcode generator is client-triggered helper, not guaranteed collision-free pre-check.
7. If generated/manual barcode conflicts with existing product barcode, save fails due to DB unique constraint; operator should generate again or provide another code.
8. QR behavior found in order/ticket/slip/receipt routes is document/navigation QR, not the product barcode field.
9. Products without barcode are valid; scanner-dependent fast lookup in order pad will not match those items.

## Product Form Behavior (Current)

From `/products` action validation (used by dedicated create/edit routes):

1. Always required: `name`, `categoryId`, `unitId`, `packingSize`, `dealerPrice`, `packingUnitId`, `srp`
2. `price` required only when `allowPackSale = true`
3. non-negative numeric guard is enforced
4. `packingStock` decimal precision is validated up to 2 decimals in form/action logic
5. Product list route does not host create/edit modal; create/edit happens on dedicated routes.
6. Product create form exposes active categories only.
7. Product edit form includes current archived category (if already linked) to preserve edit compatibility without forcing immediate remap.
8. New product assignment to archived category is blocked at action validation.

### Product Photo Slots (Current)

1. Product supports up to 4 optional photos (`slot` 1..4).
2. Any slot may remain empty.
3. New upload to an occupied slot replaces that slot metadata/object reference.
4. Product cover preview is derived from the lowest occupied photo slot.
5. Product detail route is view-only for photos; upload/replace happens in product create/edit forms.

## Stock Movement Semantics (Current)

1. `open-pack` action converts whole to retail:
2. `stock -= packs`
3. `packingStock += packs * packingSize`
4. order/cashier/dispatch deduction paths consume `unitKind` (`PACK` vs `RETAIL`) and decrement corresponding stock field
5. `open-pack` is manual-only (triggered from product list row actions), not an automatic checkout fallback

## Watchpoints During Refactor

1. Precision mismatch risk: runtime logic allows fractional retail (`0.25` multiples), but `packingStock` currently remains an integer DB field.
2. Any shape refactor must preserve `unitKind`-driven stock deduction consistency across order-create, cashier release, run dispatch, and credit release paths.
3. Do not conflate pricing SoT changes with product-shape cleanup; pricing authority remains `CANONICAL_ORDER_PRICING_SOT.md`.
4. Dedicated edit route (`products.$productId.edit.tsx`) is authoritative for product update UI behavior.
5. Avoid hard-coding LPG-only rules when the same behavior is container-return semantics that can apply to other categories.
6. Keep retail floor guidance non-blocking (`warning-only`) unless business policy explicitly changes.
7. Preserve optional barcode path for products that have no supplier barcode, while keeping duplicate handling explicit and operator-friendly.

## Context Reset Recovery (Quick Re-anchor)

If a new session loses context, re-read in this order:

1. `docs/guide/CANONICAL_PRODUCTLIST_SHAPE_SOT.md`
2. `docs/guide/CANONICAL_ORDER_PRICING_SOT.md`
3. `app/routes/products._index.tsx`
4. `app/routes/pad-order._index.tsx`
5. `app/routes/orders.new.tsx`

Then confirm these facts before coding:

1. retail qty increment is `0.25`
2. `stock` means pack stock
3. `packingStock` means retail stock
4. `allowPackSale=false` means whole-only selling path
5. `open-pack` remains manual-only
6. retail `price` may be admin-overridden from computed `srp / packingSize` reference
7. barcode is optional; duplicate barcode conflict is resolved by entering/regenerating another code
