# Kiosk UI — Tablet First (v1)

Target devices: iPad 10.2/10.9, Android 10–11" tablets (768–900px min width, portrait/landscape).

## Layout (tablet)

- **Header (56–64px):** Branch • Terminal ID • Clock • “New Cart/Clear” (right).
- **Top row:**
  - **Category chips** (horiz. scroll) → “All, Rice, Feeds, Pet, LPG, …”
  - **Search bar** (full width under chips on portrait; right of chips on landscape).
- **Main content:** 2 columns
  - **Left (≈60–65%)**: Product grid.
  - **Right (≈35–40%)**: Sticky Cart.
- **Footer (optional):** tips/shortcuts, version.

## Product grid

- **Columns:** 2 cols (portrait), 3 cols (landscape).
- **Card content:** Name (2-line clamp), price per unit (e.g., “₱48 / kg”), small badges:
  - `Pack-only` if `allowPackSale = false` (show “25kg sack” if packingSize available).
  - `Low stock` if `stock <= minStock`.
- **Controls:** `−  qty  +` (tap targets ≥ 44px), quick “Add” if not yet in cart.
- **Qty rules:** step **0.25** if retail allowed; step **1** if pack-only.

## Cart (sticky panel)

- **List item:** name (1-line), `qty × unitPrice`, line total (right).
- **Controls:** `−` `+` and numeric input (step 0.25/1 as above), 🗑 remove.
- **Totals:** Subtotal only (no discounts in kiosk).
- **Actions:** `Print Order Slip` (primary), `Clear` (secondary).
- **Empty state:** subtle “Cart is empty.”

## Interactions

- **Search:** debounce 200–300ms; `/` focuses search (optional later).
- **Category chips:** single-select; “Feeds” reveals **target chips** (Dog/Cat/Hog/Fish…) inline below.
- **Feedback:** toast/snack when item added/removed; disabled states respected.
- **Error states:** show inline message if product is inactive or out of stock (future).

## Sizing & accessibility

- Tap targets **≥ 44×44 px**.
- Body text 14–16px; headings 16–18px.
- Contrast ≥ 4.5:1 for text on buttons/cards.
- Avoid hover-only cues (touch first).

## Performance (v1 budget)

- Initial product query ≤ 100 items; lazy load on scroll if needed.
- Avoid layout shift when cart updates.

## Acceptance criteria (v1)

- I can filter by category chips and see grid update instantly.
- I can type in search and see filtered results on tablet.
- I can add an item, adjust qty with −/+/input, and see the cart subtotal update.
- `Pack-only` items increment by 1; retail-allowed by 0.25.
- `Print Order Slip` posts the current cart snapshot and opens the slip page.

┌──────────────────────────────────────────────────────────────┐
│ Header: Branch • Terminal ID • Clock • “New Cart / Clear” │
├──────────────┬───────────────────────────────┬───────────────┤
│ Categories │ Search bar │ Cart (sticky) │
│ (sticky) │ │ ┌───────────┐ │
│ • All │ [ Search products… (⏎) ] │ │ Line item │ │
│ • Rice │ │ │ Qty Price│ │
│ • Feeds │ Product grid (big tappable) │ │ … │ │
│ • Pet │ ▢ Card ▢ Card ▢ Card ▢ Card │ └───────────┘ │
│ • LPG │ ▢ Card ▢ Card ▢ Card ▢ Card │ Subtotal ₱… │
│ • … │ … │ [Print Slip] │
│ │ │ [Clear Cart] │
├──────────────┴───────────────────────────────┴───────────────┤
│ Footer: tips/shortcuts (/, +, −), low-stock legend, version │
└──────────────────────────────────────────────────────────────┘

# Kiosk UI — Tablet First (v1)

**Target devices:** iPad 10.2/10.9, Android 10–11 tablets (768–900px min width, portrait/landscape).

---

## Layout (tablet)

- **Header (56–64px):** Branch • Terminal ID • Clock • “New Cart/Clear” (right).
- **Top row:**
  - **Category chips** (horiz. scroll) → “All, Rice, Feeds, Pet, LPG, …”
  - **Search bar** (full width under chips on portrait; right of chips on landscape).
- **Main content:** 2 columns
  - **Left (≈60–65%)**: Product grid.
  - **Right (≈35–40%)**: Sticky Cart.
- **Footer (optional):** tips/shortcuts, version.

## Product grid

- **Columns:** 2 cols (portrait), 3 cols (landscape).
- **Card content:** Name (2-line clamp), price per unit (e.g., “₱48 / kg”), small badges:
  - `Pack-only` if `allowPackSale = false` (show “25 kg / sack” if `packingSize` available).
  - `Low stock` if `stock <= minStock`.
- **Controls:** `−  qty  +` (tap targets ≥ 44px), quick “Add” if not yet in cart.
- **Qty rules:** step **0.25** if retail allowed; step **1** if pack-only.

## Cart (sticky panel)

- **List item:** name (1-line), `qty × unitPrice`, line total (right).
- **Controls:** `−` `+` and numeric input (step 0.25/1 as above), 🗑 remove.
- **Totals:** Subtotal only (no discounts in kiosk).
- **Actions:** `Print Order Slip` (primary), `Clear` (secondary).
- **Empty state:** subtle “Cart is empty.”

## Interactions

- **Search:** debounce 200–300ms; `/` focuses search (optional later).
- **Category chips:** single-select; “Feeds” reveals **target chips** (Dog/Cat/Hog/Fish…) inline below.
- **Feedback:** toast/snack when item added/removed; disabled states respected.
- **Error states:** inline message if product is inactive or out of stock (future).

## Sizing & accessibility

- Tap targets **≥ 44×44 px**.
- Body text 14–16px; headings 16–18px.
- Contrast ≥ 4.5:1 for text on buttons/cards.
- Avoid hover-only cues (touch first).

## Performance (v1 budget)

- Initial product query ≤ 100 items; lazy load on scroll if needed.
- Avoid layout shift when cart updates.

## Acceptance criteria (v1)

- [x] I can type in search and see filtered results on tablet.
- [x] I can add an item, adjust qty with −/+/input, and see the cart subtotal update.
- [x] `Pack-only` items increment by 1; retail-allowed by 0.25.
- [x] `Print Order Slip` posts the current cart snapshot and opens the slip page.
- [ ] Category chips filter product list.
- [ ] Landscape grid switches to 3 columns.

---

## Implementation notes (2025-08-25)

> Temporary divergences we chose while finalizing logic:

- **Center panel uses a single-column list** (thumb • details • controls) for readability.
- **Prices come 100% from DB**:
  - Retail price = `Product.price` (shown only if `allowPackSale = true`)
  - Pack price = `Product.srp` (no computed `price × packingSize`)
- **Stock labels**:
  - Packs = `Product.packingStock` + packing unit (always shown)
  - Retail = `Product.stock` + unit (only if `allowPackSale = true`)
- **Container info:** `packingSize unit / packingUnit` (e.g., `22 kg / tank`).
- **Add button** enabled only if the relevant price exists (`price` for retail, `srp` for pack-only).

These will be reconciled with the 2–3 column grid once behavior is finalized.
