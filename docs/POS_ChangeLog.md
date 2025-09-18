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

Changelog
2025-09-11
Added

Delivery channel support across order creation.

Server (app/routes/orders.new action): accepts channel (PICKUP/DELIVERY) + delivery snapshot fields (deliverTo, deliverPhone, deliverLandmark, deliverGeoLat, deliverGeoLng, deliverPhotoUrl, deliveryAddressId), validates them when channel=DELIVERY, saves snapshots on the order.

Client (Order Pad) (app/routes/pad-order.\_index.tsx): UI to toggle Pickup vs Delivery; inputs for recipient, phone, landmark, geo, photo; posts hidden fields only for Delivery; carries customerId and deliveryAddressId.

Customer search & attach (phone-first) for Delivery orders.

Client: search box that queries /api/customers/search, shows results, selects a customer, auto-prefills deliverTo & phone, lets you choose an address, and posts customerId + deliveryAddressId.

Pricing engine reuse on receipt and cashier.

Both the cashier payment preview and the receipt use the shared pricing service (applyDiscounts, buildCartFromOrderItems, fetchCustomerRulesAt) to compute subtotals/discounts/total consistently.

Changed

Inventory deduction timing

Pickup: deducts at payment (as before).

Delivery: now deducts at Dispatch (new action) instead of at payment; dispatch still prints a Delivery Ticket.

Receipt can show tendered cash + change if provided in the URL.

Receipt route (app/routes/orders.$id.receipt.tsx): reads optional ?cash= and ?change= query params, displays “Cash Received” and “Change”. Falls back to computing change from total vs recorded payments when query params are absent.

Fixed

(Server) order creation now links customers correctly.

The handler reads customerId/deliveryAddressId from the submitted form and stores them on the order (bug was causing customer link to be dropped).

(Search API) improved phone/name matching and scoring so typing a PH mobile (e.g., 0912…) surfaces the correct customer quickly.

Notes / Behavior Clarifications

Partial payments / balance (utang) still require a customer before the server will accept releasing with balance. Manager approval is enforced when releasing with balance or when per-item price is below the allowed customer price.

Receipt totals: “Grand Total” is the rule-aware total; “Paid” lines show actual recorded payments. If cash/change are present in the query, they override the derived display.

Known Issues / Follow-ups (create issues)

Cash/Change not appearing on fully-paid receipts

Why: The cashier route still redirects to /orders/:id/receipt?autoprint=1&autoback=1 without appending cash and change.

Where: app/routes/cashier.$id.tsx (action settlePayment), the fully-paid redirect path.

Fix: Update the redirect to include cash (tendered) and change in the URL so the receipt can display them. (Partial/ACK path already passes tendered/change.)

Customer search response shape mismatch

API currently returns { items: [...] } while Order Pad UI expects data.hits. Align to one shape (hits or items) across both sides to avoid intermittent “no results” rendering.

Order creation: ensure customerId is read from the correct form variable

If customer linking is still inconsistent on Pickup, double-check the order creation action reads from the same form data name the UI posts.

Dispatch is an action, not a page

Current flow opens ticket immediately after dispatch. We want a Dispatch Page first (assign rider, vehicle, extras, capacity), then dispatch & print. (See EPIC below.)

EPIC Reference: Delivery → Dispatch Page & Runs

Use the checklist we drafted:

New route /orders/:id/dispatch to assign Rider and Vehicle, add Extras (e.g., spare LPG tanks), capacity meter, then Dispatch & Print.

Data model for DispatchRun, DispatchRunOrder, DispatchLine, vehicles, and rider roles.

Dispatch hub /dispatch and Run details /dispatch/:runId with close/reconcile, returns to warehouse, and remit.

Verification Checklist (smoke tests)

Order Pad → Pickup

Create order, pay with cash > total → Official Receipt shows Cash Received and Change correctly.

Order Pad → Delivery

Create order with delivery fields + linked customer/address → Pay any amount:

If fully paid: order becomes PAID, Delivery still not deducted until dispatch (by design).

If partial: order becomes PARTIALLY_PAID, requires customer, optional release with manager approval.

Dispatch flow

Delivery order → Dispatch action deducts stock and prints Delivery Ticket. (Will be replaced by Dispatch Page in the new EPIC.)

Pricing

Discounted customers: totals on cashier preview and receipt match; guards prevent per-item prices below allowed unless manager override provided.

## 2025-09-09 → Delivery Epic Kickoff

- Designed **Delivery Flow**:
  - Orders with `channel=DELIVERY` open Delivery Details sheet.
  - Delivery ticket prints (not OR).
  - Inventory **deducts at DISPATCH**, not at order creation.
  - Added actions: **dispatch** (ticket & deduction) and **remit** (returns).
- Drafted **POS_Delivery_GeoAddress.md**:
  - Order snapshot vs saved addresses.
  - Reusable vs one-time addresses.
  - Optional map coordinates & photo.

## 2025-09-10 → Dispatch Staging

- Added **Dispatch Staging Page** before ticket print.
  - Rider assignment.
  - Extra LPG tank load tracking.
- Differentiated **rider vs employee** roles.

## 2025-09-11 → Cashier Integration

- Extended **cashier order route**:
  - New actions: `dispatch`, `reprint`, `release`, `settlePayment`.
  - Dispatch decrements stock.
  - Release unlocks order.
- Added **discount guardrails**:
  - Rules enforced via `applyDiscounts` and `computeUnitPriceForCustomer`.
  - Manager approval required for below-allowed pricing.

## 2025-09-12 → Receipt/Remit

- Implemented **receipt printing toggles** (`printReceipt` default true).
- Added **remit link** on cashier header.
- Clarified stock deduction:
  - **PICKUP** → deduct at payment.
  - **DELIVERY** → deduct at dispatch.
- Stock delta logic updated:
  - Pack vs retail inferred from allowed customer price.
  - Rounding guardrails (epsilon checks).
- Drafted **Remit Flow**: unsold load returns to stock.

## 2025-09-13 → Search & Flicker Fix

- Centralized **Customer Search API**:
  - `q` tokenized; matches by name, alias, or phone (normalized).
  - Scoring system: phone exact > prefix > contains > name.
  - Return top 10 results.
- Began refactor to **useCustomerSearch hook** (for reuse across Cashier, CustomerPicker).
- Investigated **flicker bug** in Cashier when typing customer name.
  - Cause: uncontrolled/controlled mismatch when state resets.
  - Fix: centralize `selectedCustomer` state.

## 2025-09-14 → Discount & Pricing

- Rewired cashier preview panel:
  - Shows item-level discount badges (percent or peso override).
  - Totals panel: subtotal, discounts, before vs after discounts.
- Synced client rules with loader-fetched rules.
- Ensured **discounts apply in both preview and settlePayment action**.

## 2025-09-15 → Dispatch Summary

- Added **Dispatch Summary Page** (`orders.$id.dispatch.tsx`):
  - Shows assigned rider and extra load carried.
  - Displays dispatched items with qty/price/line totals.
  - Print-friendly summary for ticket confirmation.

## 2025-09-16 → Remit Summary

- Added **Remit Summary Page** (`remit.$id.summary.tsx`):
  - Header card: parent remit info (order code, rider, status, totals).
  - **Parent items table** for evaluation.
  - Split child orders:
    - **Cash Sales** with reprint links + “Print all” action.
    - **Credit Sales** with ACK links + “Print all” action.
  - Linked **Reprint Parent** and **Print Rider Consolidated** buttons.

## 2025-09-17 → Rider Consolidated Receipt

- Added **Rider Receipt Page** (`remit.$id.rider-receipt.tsx`):

  - Consolidated layout showing parent items and all child orders.
  - Per-child: order code, customer name, total, and paid amount.
  - Includes **grand totals** (amount vs paid).
  - Print-friendly design with a single “Print” button.

- **Customer name fallback logic** refined:

  - Prefer linked customer alias/full name.
  - Fallback to parsed `deliverTo`.
  - Last resort: “Walk-in”.

  ## 2025-09-18 → Remit & Receipts (wire-up pass)

### Added

- `app/routes/remit-summary.$id.tsx`

  - Rider Remit Summary page:
    - Header card (parent remit: order code, rider, status, totals).
    - Parent items evaluation table.
    - Child sections split into **Cash Sales** (with reprint / “Print all”) and **Credit Sales** (ACK / “Print all”).
    - “Reprint Parent” and “Print Rider Consolidated” actions.
  - Customer name resolution refined:
    - Prefer linked Customer (alias/full name).
    - Fallback to parsed `deliverTo` (“Name — Address”, “Name - Address”, or comma).
    - Final fallback: `Walk-in`.

- `app/routes/remit-receipt.$id.tsx`

  - Rider **Consolidated Receipt**:
    - Print-friendly layout and one-click **Print**.
    - Parent items (subtotal/total) + child orders list (order, customer, total, paid).
    - **Grand Total** vs **Grand Paid**.

- `app/routes/receipts._index.tsx`
  - Receipts landing/index (entry point to reprints and summaries).

### Database / Migrations

- `prisma/migrations/20250916120637_add_remit_parent_and_payment_tendered_change/`
  - Introduced remit parent link for child orders created during rider remit.
  - Updated payment “tendered” structure to support remit/child cash receipts.

### Notes

- Display shows **actual customer name** when present; only shows “Walk-in” if no linked customer and `deliverTo` can’t be parsed.
- Delivery flow (dispatch → remit → summary → rider receipt) is **functional**, with print actions wired.
