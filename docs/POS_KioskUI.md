# POS Kiosk UI (Tablet-First)

> This doc describes kiosk UX behavior, availability rules, error handling, and accessibility.

## Goals

- Let customers quickly build carts from a tablet.
- Support mixed mode for eligible products (Retail + Pack in the same order).
- Prevent bad submissions via clear UI and preflight validation.
- Keep the kiosk view reasonably fresh without full real-time complexity.

---

## Key Concepts

- **Retail** (by unit): uses `price`, stock source is `packingStock` (e.g., kg/pcs).
- **Pack** (by pack): uses `srp`, stock source is `stock` (e.g., sacks/tanks).
- **allowPackSale**: if true, product can be sold by Retail and Pack. If false, pack-only.

> DB semantics:
>
> - `stock` → pack count on hand
> - `packingStock` → retail units on hand

---

## Product Card

- **Name + badges** (inline):
  - `Low` (small amber) when:
    - packs available but `stock <= 1`, or
    - retail allowed and `packingStock <= minStock` (and > 0).
  - `Out` (small red) when **both modes** are unavailable.
- **Brand** (muted, line-2).
- **Stock row** (line-2/3):
  - `Stock: {stock} {packUnit}(s)`
  - If retail allowed: `Retail Stock: {packingStock} {unit}`
  - If both units present and packSize > 0: `Container: {packSize} {unit} / {packUnit}`
  - Partial empties:
    - Retail empty + Pack available → badge: “Retail empty — open sack needed”
    - Pack empty + Retail available → badge: “Pack stock empty”
- **Actions (right)**:
  - If `allowPackSale`:
    - **Add by {unit}** (Retail) + price chip (uses `price`)
    - **Add {packUnit} ({packSize} {unit})** (Pack) + price chip (uses `srp`)
  - Else (pack-only): single **Add {packUnit}**.
  - Buttons disabled per mode when price/stock invalid or that mode is already in cart.

---

## Cart

- Lines are keyed by `productId:mode` to allow both Retail and Pack for the same product.
- Quantity steps:
  - Retail → **0.25**
  - Pack → **1**
- Line shows: `name [MODE]`, `qty × unitPrice`, computed line total.

---

## Create Slip (Submit)

- Kiosk posts to `/orders/new?respond=json` with:
  - `items`: `[{ id, name, qty, unitPrice, mode }]`
  - `terminalId`: string (optional, e.g., `KIOSK-01`)
- On success `{ ok: true, id }` → navigate `/orders/:id/slip`.
- On failure `{ ok: false, errors[] }` → show modal with reasons.

---

## Availability & Disable Rules (Per Mode)

- **Retail enabled** when:
  - `allowPackSale === true`
  - `packingStock > 0`
  - `price > 0`
- **Pack enabled** when:
  - `stock > 0`
  - `srp > 0`
- Entire card is dimmed only when **both** modes are unavailable.

---

## Client-Side Preflight Validation

Before submit, kiosk validates the cart against **current loader data**:

### Retail (mode = `retail`)

- `allowPackSale === true`
- `price > 0`
- `qty` is a **multiple of 0.25**
- `qty > 0`
- `qty <= packingStock`
- `unitPrice === price` (tolerance 1e-6)

### Pack (mode = `pack`)

- `srp > 0`
- `qty` is an **integer**
- `qty > 0`
- `qty <= stock`
- `unitPrice === srp` (tolerance 1e-6)

If any rule fails, kiosk prevents submit and opens an **Error Modal** listing:

- product id
- mode
- reason (e.g., “Pack qty must be an integer”).

> Server runs the same validations again to cover race conditions.

---

## Refresh Strategy

- Revalidate on **tab focus**.
- Light polling every **15s** when visible.
- No heavy real-time; good enough for kiosk accuracy.

---

## Accessibility

- Error modal uses a **focusable backdrop button** with `aria-label="Close modal"`, allowing ESC/keyboard interaction.
- Buttons have descriptive `title` attributes explaining why they’re disabled (already in cart, no stock/price, etc.).
- Number inputs have `min`, `max`, and correct `step` for mode.

---

## Out of Scope (Kiosk v1)

- Discounts/promos
- Customer data
- Barcode scanning at kiosk (reserved for cashier)
- Cashier queue/locking
