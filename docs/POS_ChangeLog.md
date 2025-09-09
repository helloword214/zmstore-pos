# POS Change Log

> 📌 Purpose:  
> Tracks the **timeline of features, decisions, and milestones**.  
> Serves as a quick “project diary”.
>
> 🛠 When to update:
>
> - At the end of every coding session (add 2–3 bullets).
> - When a new milestone is documented/finished.
> - When a business rule is changed.
>
> ✅ Readers:
>
> - Any dev continuing the project
> - Stakeholders checking progress
> - Future you (to remember where you left off)

## 2025-08-15

- ✅ Product CRUD finished (create, update, delete).
- ✅ Inventory search working.

## 2025-08-20

- 🚀 Started cashier/kiosk plan.
- Rule: Slip includes totals, no discounts.
- Rule: Discounts only at cashier.

## 2025-08-21

- ✅ Milestone 1 documented (Order Slip).
- Slip expires in 24h, can be reprinted.
- State: UNPAID introduced.

## 2025-08-22

- ✅ Milestone 2 documented (Cashier Queue & Scan).
- Order locking rules defined.
- Discount authority: cashier vs manager.

## 2025-08-23

- ✅ Milestone 3 documented (Payment & Receipt).
- Payment methods: Cash, GCash, Card, split.
- Receipt only on PAID.

## 2025-08-23

- ✅ Milestone 4 documented (Fulfillment).
- Pick Ticket, packing, open sack, handover rules.

## 2025-08-23

- Clarified ON_HOLD behavior: resolve within Fulfillment; only escalate to VOID (manager) if not resolvable. No return to cashier, no auto new order.

## 2025-08-23

- Docs structure ready.
- Next: Start coding Milestone 1 (Order Slip save & print).

## 2025-08-24

- **Added `Order` and `OrderItem` models** for Milestone 1 (Order Slip).
- Defined snapshot fields (`name`, `unitPrice`) to preserve slip history even if products change later.
- Added indexes on `status` and `expiryAt` to support cashier queue and cleanup jobs.
- Added back-relation `orderItems` on `Product` model for analytics and queries.

## 2025-08-24

- Implemented **POST `/orders.new`** to create `UNPAID` Order with snapshot items, `subtotal`, `totalBeforeDiscount`, and `expiryAt = printedAt + 24h`.
- Added **GET `/orders/:id/slip`** printable page (QR, expiry badge, Reprint #n).
- Added **POST `/orders/:id/slip`** with `_action=reprint` to increment `printCount` and update `printedAt` (expiry unchanged).
- Updated **POS_OrderFlow.md** (API & Actions for Milestone 1).
- Note: `printedAt` reflects most recent print; add `firstPrintedAt` later if needed.

### 2025-08-25 — Add Kiosk UI (tablet-first) spec

- New: `docs/POS_KioskUI.md` outlining layout, grid, cart, interactions, sizing, and acceptance.
- Noted current implementation deltas: single-column list, DB-driven prices, explicit pack/retail stock labels.

### 2025-08-25 — Kiosk product card refresh (UI-only)

- Switched to **single-column** list for kiosk products (tablet focus).
- **Prices from DB only**:
  - Retail price = `Product.price` (shown only if `allowPackSale = true`)
  - Pack price = `Product.srp` (shown if set; **never** computed as `price × packingSize`)
- **Stock labels** clarified:
  - Packs = `Product.packingStock` + packing unit (always shown)
  - Retail = `Product.stock` + unit (shown only if `allowPackSale = true`)
- **Container info** shown as text: `packingSize unit / packingUnit` (e.g., `22 kg / tank`).
- **Add** button is enabled only when the correct price exists:
  - Retail items need `price` > 0
  - Pack-only items need `srp` > 0

## 2025-08-26

- ✅ Fixed stock mapping in kiosk: `stock` = pack count; `packingStock` = retail units.
- ✅ Allow mixed-mode adds for products with `allowPackSale = true` (retail + pack in one order).
- UI: “Add by {unit}” and “Add {packUnit} ({packSize} {unit})” buttons with price chips.
- UI: Low/Out badges moved inline beside product name.
- Behavior: Product cards no longer dim when one mode is in cart; each mode disables independently.
- Note: Cart lines keyed by `productId:mode`; steps = 0.25 (retail) / 1 (pack).
- Next: server-side clamps (qty ≤ available stock per mode) before slip creation.

## 2025-08-27

- ✅ `/orders/new` now **server-validates** kiosk carts (mode-aware clamps).
- Kiosk posts via **fetcher** to `/orders/new?respond=json`; shows a modal for per-item errors.
- Validation rules:
  - Retail: `allowPackSale`, `price > 0`, qty multiple of **0.25**, qty ≤ `packingStock`, client `unitPrice === price`.
  - Pack: `srp > 0`, qty **integer**, qty ≤ `stock`, client `unitPrice === srp`.
- Prisma: `Order.items.create[]` now includes `lineTotal` and `product: { connect: { id } }`.
- Route naming fixed: **`orders.new.tsx` → `/orders/new`** (dot in filename maps to slash).
- Result: successful create → `UNPAID` order, slip redirect; failure → JSON `{errors:[...]}` rendered in modal.

## 2025-08-28

- ✅ **Cashier Queue & Scan (MVP) implemented**

  - Route **`/cashier`**: shows latest **UNPAID** orders; open by **Order Code** or by **ID**.
  - **Atomic locking** on open (`lockedAt`, `lockedBy`) with **TTL = 5 minutes**; stale locks auto-claimable.
  - Queue badges: **EXPIRED**, **LOCKED**, and **Slip #n**.

- ✅ **Cashier Order View**

  - Route **`/cashier/:id`**: shows items, totals, lock status + **countdown** to lock expiry.
  - Actions: **Reprint** (increments `printCount`), **Release** (clears lock).

- ✅ **Payment (MVP) & Inventory Deduction**

  - Action **`_action=settlePayment`**: validates each line against current product data and infers mode by price:
    - **Retail**: `allowPackSale` true, `unitPrice == price`, deducts **retail units** from `packingStock`.
    - **Pack**: `unitPrice == srp`, deducts **pack count** from `stock`.
  - On success: marks order **PAID** (no discounts yet); on failure: returns per-line errors.

- 🔧 **Schema already aligned**

  - `Order.lockedAt`, `Order.lockedBy` used for cashier locking.
  - Confirmed canonical mapping used across code paths:
    - `stock` = **pack count**, `packingStock` = **retail units**.

- 🧪 Notes

  - Lock claim uses `updateMany` for atomicity; separate read to fetch ID for redirect.
  - `orders/:id/slip` reprint updates `printedAt` (latest print) but leaves `expiryAt` unchanged.

  ## 2025-08-28

- ✅ Cashier Queue auto-maintenance:
  - Auto-cancel **expired UNPAID** slips (unlocked or stale lock).
  - Auto-purge **CANCELLED > 24h** (deletes Order + OrderItems [+ Payments if any]).
- ✅ Cashier locking TTL (5 min): atomic lock on open (by code or id); release on exit.
- ✅ Receipt MVP:
  - `orders.$id.receipt.tsx` page added (Official Receipt).
  - `utils/receipt.allocateReceiptNo()` + `ReceiptCounter` table (per-branch counter ready).
  - Payment row created on settle; `receiptNo` + `paidAt` set on Order.
  - Auto-print receipt via `?autoprint=1&autoback=1`; **fixed duplicate print** by consolidating to a single guarded `useEffect` with `afterprint` listener.

## 2025-08-29

- ✅ Kiosk slip behavior:
  - Button now **Create Order** (no print) or **Create & Print Slip** (optional print).
  - Client preflight keeps existing rules; server re-validates.
  - Label fix: **“Retail empty — open {packUnit} needed”** (dynamic pack unit).
- ✅ Slip page polish:
  - 57 mm ticket CSS (`.ticket` wrapper) for thermal printers.
  - Back-to-Kiosk link; optional auto-print (`autoprint=1`) + auto-return (`autoback=1`).
- 🔧 Cashier screen:

  - Cash input (₱ received) + change preview.
  - On settle, inventory deducted per mode, order marked **PAID**, optional auto-print receipt, then back to `/cashier`.

  ## 2025-08-30

- Renamed **Slip → Order Ticket**, **Kiosk → Order Pad** (docs + UI copy).
- Added **Utang (on-credit)** with due date, release with balance, partial payments.
- Introduced **Partial Payments** and `PARTIALLY_PAID` state.
- Delivery flow with **DISPATCHED** inventory deduction and **RemitBatch** settlement.
- **CatGas composite LPG**: unified stock, brand-based pricing, swap/upgrade rules, cylinder loan ledger.
- Flexible **amount-based discounts** with SKU floor guardrails and manager approval.
- 57 mm **Ticket/Receipt** patterns with single guarded **auto-print**.
- Cashier queue **auto-cancels expired** UNPAID + **purges CANCELLED** >24h.

## 2025-09-04

- UI: Unified POS look & feel (indigo theme), compact controls, and consistent inputs across Order Pad, Cashier, Tickets, and Receipts. **No logic changes.** (a3aca3e)

## 2025-08-29 — Business model refinements

**Terminology**

- Renamed **Slip → Order / Order Ticket**; **Kiosk → Order Pad** (docs + UI copy).

**Delivery & Settlement**

- Added **Delivery (COD)** model with **RemitBatch** (end-of-day settlement turns delivered UNPAID orders into PAID + prints receipt).

**Discounts**

- Simplified to **amount-based** per line / per order with **floor-price guardrails** (no sale below computed cost). Percentage discounts removed from docs/UI.

**LPG Rules**

- Documented **swap/upgrade** flows and **cylinder loan** records (borrowed empty, customer info required).

**Customers**

- Added **Customer** / **CustomerAddress** (split names, contact, optional geo). Will support discounts on file and future credit (“Utang”) tracking.

**Receipt**

- 57mm format finalized; receipt is printed on **PAID** (cashier or batch settlement).

---

## 2025-08-28 — Cashier Queue & Receipt MVP

**Cashier Queue & Scan**

- Queue lists UNPAID orders (fresh first), **TTL locking** (5 min) on open (by Code or ID).
- Auto-cancel: **expired UNPAID** (unlocked or stale-locked) → `CANCELLED`.
- Auto-purge: `CANCELLED` older than **24h** removed (items/payments cleaned).

**Payment**

- Cash input + validation; marks order **PAID**, **deducts inventory**, **unlocks order**.
- **Receipt numbering** via `ReceiptCounter`; `paidAt`, `receiptNo` stored.
- Optional **auto-print** & **auto-back** to `/cashier` via URL flags.

**Slip / Ticket**

- Order Pad can **Create Order** (no print) or **Create & Print Ticket** (57mm).
- **Single guarded auto-print** on ticket/receipt pages to prevent duplicate dialogs.

**Data Model**

- Added: `Payment` table; `ReceiptCounter`; `Order.paidAt`, `Order.receiptNo`; cashier lock fields (`lockedAt`, `lockedBy`, `lockNote`).
- Indexes for queue & cleanup: `Order(status, expiryAt)`, plus lock/expiry indices.

**APIs & Pages**

- `POST /orders/new` returns JSON on `?respond=json`; server validates mode-aware lines.
- `/orders/:id/slip` 57mm ticket + reprint counter; `/orders/:id/receipt` 57mm receipt (payments + change).

**Bug fixes**

- Guard duplicate print dialogs (React StrictMode) using a **printedOnce** ref + single effect.
- Reprint increments **printCount** and updates **printedAt** without changing `expiryAt`.

**Refs**

- Commits: a261229, 91a49c9, 304e730, 9005bf8

## 2025-09-07

- Minimal UI fixes: unified sticky headers, consistent containers, removed overlapping sub-navs.
- AR functionality: Accounts Receivable list, per-customer ledger, payment recording + auto-allocation, change handling.
- Customers: consolidated layout with tabs (Profile / Pricing / AR), moved pricing to `customers.$id.pricing._index.tsx`.
- Customer discounts: per-item discount rules groundwork wired into customer pricing view.
- Routes cleanup: deleted obsolete `customers.$id.pricing.tsx` Outlet.

## 2025-09-07 — Mobile-first Order Pad polish

### Added

- Sticky bottom action bar + full-screen Cart sheet for mobile.
- Product cards show inline “− qty +” stepper on mobile.
- Compact category pill bar (emoji icons, smart edge fades, inner padding).
- Mobile infinite scroll for product list.

### Changed

- Scanner is **mobile-only**; desktop Scan button removed from product list.
- Desktop pagination UI (count + “Load more”) hidden on mobile (auto-load instead).
- Removed redundant unit-price captions on mobile cart lines.

### Fixed

- TDZ error (“Cannot access `total` before initialization”) by using `filtered.length` in the mobile scroll effect.
- Awkward white edge fade in categories; fades now match `#f7f7fb` and auto-hide at ends.

### Notes

- Add (or keep) the global utility:
  ```css
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  ```

## [2025-09-08] Rule-aware pricing parity

### Added

- Discount lines on Official Receipt and Payment Acknowledgment (per-rule breakdown).
- Receipt/ACK recompute discounted totals using rules valid at payment time (`paidAt` or payment timestamp).

### Changed

- Server cart unit-kind inference mirrors client; unknown `unitKind` treated as wildcard for rule matching.
- AR Index & Customer Ledger balances now use **discounted totals** (not `totalBeforeDiscount`).

### Fixed

- Full payments with discounts now print **Official Receipt** (no more ACK misfire).
- AR payment allocation/status updates use effective totals; orders flip to **PAID** correctly.
- TypeScript cleanups: union narrowing for `Rule`, declared `adjustedItems`, removed unused `computeUnitPriceForCustomer` import.

### Files touched

- `app/routes/cashier.$id.tsx`
- `app/routes/orders.$id.receipt.tsx`
- `app/routes/orders.$id.ack.tsx`
- `app/routes/ar._index.tsx`
- `app/routes/ar.customers.$id.tsx`

> DB schema unchanged. No migrations required.

## [2025-09-08] Centralized rule-aware pricing parity

### Added

- services/pricing.ts: fetchActiveCustomerRules(db, customerId) for loading/mapping active item rules.
- services/pricing.ts: buildCartFromOrderItems({ items, rules }) for rule-aware cart building (unitKind inference + Decimal→number coercion).
- Discount lines on Official Receipt and Payment Acknowledgment (per-rule breakdown).

### Changed

- Cashier, Receipt, Ack, AR List, and Customer Ledger now use shared applyDiscounts + centralized rule fetcher/cart builder.
- Server cart unit-kind inference mirrors client; unknown unitKind acts as wildcard with rule-aware fallback.
- AR Index & Customer Ledger balances now use discounted totals (not totalBeforeDiscount).
- /api/customer-pricing now sources rules via shared helper (no duplicate DB→rule mapping).
- Fixed
- Full payments with discounts now print Official Receipt (no more ACK misfire).
- AR payment allocation/status updates use effective totals; orders flip to PAID correctly.
- TypeScript cleanups: Decimal coercions, union narrowing for Rule, removed duplicate/local pricing helpers.

## Files touched

- app/services/pricing.ts
- app/routes/api.customer-pricing.tsx
- app/routes/cashier.$id.tsx
- app/routes/orders.$id.receipt.tsx
- app/routes/orders.$id.ack.tsx
- app/routes/ar.\_index.tsx
- app/routes/ar.customers.$id.tsx

> DB schema unchanged. No migrations required.

## [2025-09-09] Statement of Account (SOA)

### Added

- New route: app/routes/ar.customers.$id.statement.tsx (Statement of Account).
- Period selector (Start/End) with print button.
- Optional Show items toggle (?items=1) showing per-line effective unit price and line totals using rules valid at the time.
- Opening balance computation (pre-period charges minus payments).
- Running balance per transaction (opening → each txn), displayed in the table.

### Changed

- AR Customer Ledger (ar.customers.$id.tsx): added quick action link to Statement.
- SOA totals now use the pricing engine (applyDiscounts) via fetchCustomerRulesAt and buildCartFromOrderItems to ensure parity with receipts/ACK.

### Fixed

- End-date filter off-by-one: switched to local date parsing (parseYmdLocal) and exclusive end (< endExclusive) so the chosen end day is fully included.
- Payments can no longer drive the running balance negative: each payment is capped to the current due and reported as creditApplied.
- Cleaned up unused variable warning by replacing txnsWithRunning with txnsWithApplied.

### Files touched

- app/routes/ar.customers.$id.statement.tsx (new)
- app/routes/ar.customers.$id.tsx (add Statement link)
- app/services/pricing.ts (referenced helpers: applyDiscounts, buildCartFromOrderItems, fetchCustomerRulesAt)

> DB schema unchanged. No migrations required.

## [2025-09-09] Delivery: Geo-address snapshot (Order-level)

**Added**

- Link `Order → CustomerAddress` via `deliveryAddressId` (named relation).
- Snapshot fields on `Order`: `deliverTo`, `deliverPhone`, `deliverLandmark`, `deliverGeoLat`, `deliverGeoLng`, `deliverPhotoUrl`, `deliverPhotoKey`.
- Optional landmark photo on `CustomerAddress`: `photoUrl`, `photoKey`, `photoUpdatedAt`.
- Indexes: `Order(deliveryAddressId)` and `Order(deliverGeoLat, deliverGeoLng)`.

**Behavior**

- When **Channel = Delivery**, always snapshot **address + landmark**; **coords/photo optional**.
- **Do not block** dispatch if coords are missing; Delivery Ticket uses **QR to Maps** (pin if coords, text search otherwise).
- Photos are **screen-only** (packing/dispatch/remit), **not** printed on 57 mm.

**DB**

- Migration: `order-delivery-geo-snapshot` (adds-only; no breaking changes).
