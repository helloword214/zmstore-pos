# POS Change Log

> **Purpose**
>
> - Tracks the **timeline of features, decisions, and milestones**
> - Serves as a quick “project diary”
>
> **When to update**
>
> - At the end of every coding session (add 2–3 bullets)
> - When a new milestone is documented/finished
> - When a business rule is changed
>
> **Readers**
>
> - Any dev continuing the project
> - Stakeholders checking progress
> - Future you (to remember where you left off)

---

## 2025-08-15

- ✅ Product CRUD finished (create, update, delete)
- ✅ Inventory search working

## 2025-08-20

- 🚀 Started cashier/kiosk plan
- Rule: Slip includes totals, **no discounts**
- Rule: **Discounts only at cashier**

## 2025-08-21

- ✅ Milestone 1 documented (Order Slip)
- Slip expires in **24h**, can be reprinted
- State: **UNPAID** introduced

## 2025-08-22

- ✅ Milestone 2 documented (Cashier Queue & Scan)
- Order locking rules defined
- Discount authority: cashier vs manager

## 2025-08-23

- ✅ Milestone 3 documented (Payment & Receipt)
  - Payment methods: Cash, GCash, Card, split
  - Receipt only on **PAID**
- ✅ Milestone 4 documented (Fulfillment)
  - Pick Ticket, packing, open sack, handover rules
- Clarified **ON_HOLD** behavior: resolve within Fulfillment; escalate to **VOID (manager)** only if not resolvable  
  (No return to cashier, no auto new order)
- Docs structure ready → Next: start coding Milestone 1 (Order Slip save & print)

## 2025-08-24

- **Added `Order` and `OrderItem` models** (Milestone 1)
  - Snapshot fields (`name`, `unitPrice`) to preserve slip history if products change later
  - Indexes on `status` and `expiryAt` for queue + cleanup
  - Back-relation `product.orderItems` for analytics/queries
- Implemented **POST `/orders/new`** (UNPAID + snapshot items)
  - Fields: `subtotal`, `totalBeforeDiscount`, `expiryAt = printedAt + 24h`
- Added **GET `/orders/:id/slip`** printable (QR, expiry badge, Reprint #n)
- Added **POST `/orders/:id/slip`** with `_action=reprint`
  - Increments `printCount`, updates `printedAt` (expiry unchanged)
- Updated **POS_OrderFlow.md**  
  Note: `printedAt` reflects most recent print (consider `firstPrintedAt` later)

### 2025-08-25 — Add Kiosk UI (tablet-first) spec

- New: `docs/POS_KioskUI.md` (layout, grid, cart, interactions, sizing, acceptance)
- Current implementation deltas: single-column list, DB-driven prices, explicit pack/retail stock labels

### 2025-08-25 — Kiosk product card refresh (UI-only)

- Switched to **single-column** list (tablet focus)
- **Prices from DB only**
  - Retail = `Product.price` (shown only if `allowPackSale = true`)
  - Pack = `Product.srp` (shown if set; **never** computed as `price × packingSize`)
- **Stock labels** clarified
  - Packs = `Product.packingStock` + packing unit (always shown)
  - Retail = `Product.stock` + unit (shown only if `allowPackSale = true`)
- Container info: `packingSize unit / packingUnit` (e.g., `22 kg / tank`)
- **Add** button enabled only when the correct price exists
  - Retail needs `price > 0`; pack-only needs `srp > 0`

## 2025-08-26

- ✅ Fixed stock mapping in kiosk: `stock` = pack count; `packingStock` = retail units
- ✅ Allow mixed-mode adds for `allowPackSale = true` (retail + pack in one order)
- UI: “Add by {unit}” and “Add {packUnit} ({packSize} {unit})” buttons with price chips
- UI: Low/Out badges inline beside product name
- Behavior: Each mode disables **independently**; cart lines keyed by `productId:mode`
- Steps: **0.25** (retail) / **1** (pack)  
  Next: **server-side clamps** (qty ≤ available per mode) before slip creation

## 2025-08-27

- ✅ `/orders/new` now **server-validates** kiosk carts (mode-aware clamps)
- Kiosk posts via **fetcher** to `/orders/new?respond=json`; modal shows per-item errors
- Validation rules:
  - Retail: `allowPackSale`, `price > 0`, qty multiple of **0.25**, qty ≤ `packingStock`, `unitPrice === price`
  - Pack: `srp > 0`, qty **integer**, qty ≤ `stock`, `unitPrice === srp`
- Prisma: `Order.items.create[]` includes `lineTotal` + `{ product: { connect: { id } } }`
- Route naming: `orders.new.tsx` → `/orders/new`  
  Result: success → **UNPAID** + slip redirect; failure → JSON `{errors:[...]}`

## 2025-08-28

- ✅ **Cashier Queue & Scan (MVP)**
  - Route **`/cashier`**: latest **UNPAID** orders; open by **Code** or **ID**
  - **Atomic locking** (`lockedAt`, `lockedBy`) with **TTL = 5 min**; stale locks auto-claimable
  - Queue badges: **EXPIRED**, **LOCKED**, **Slip #n**
- ✅ **Cashier Order View**
  - Route **`/cashier/:id`**: items, totals, lock status + **countdown** to lock expiry
  - Actions: **Reprint** (increments `printCount`), **Release** (clears lock)
- ✅ **Payment (MVP) & Inventory Deduction**
  - Action `_action=settlePayment`: validates lines and infers mode by price
  - **Retail**: `allowPackSale` & `unitPrice == price` → deduct **retail units** from `packingStock`
  - **Pack**: `unitPrice == srp` → deduct **pack count** from `stock`
  - Success: mark **PAID**; failure: per-line errors
- 🔧 Schema aligned: lock fields in use; mapping confirmed (stock = packs, packingStock = retail units)
- 🧪 Notes: Lock claim uses `updateMany` for atomicity; slip reprint updates `printedAt` (expiry unchanged)

### 2025-08-28 — Queue auto-maintenance & Receipt MVP

- Auto-cancel **expired UNPAID** slips (unlocked / stale-locked)
- Auto-purge **CANCELLED > 24h** (Order + Items [+ Payments])
- **Receipt MVP**
  - `orders.$id.receipt.tsx` added (Official Receipt)
  - `utils/receipt.allocateReceiptNo()` + `ReceiptCounter` table
  - Payment row created on settle; `receiptNo` + `paidAt` stored on Order
  - Auto-print via `?autoprint=1&autoback=1`; **duplicate print fixed** with single guarded `useEffect` + `afterprint` listener

## 2025-08-29

- ✅ Kiosk slip behavior
  - Buttons: **Create Order** (no print) or **Create & Print Slip** (optional print)
  - Client preflight retained; server re-validates
  - Label fix: “Retail empty — open {packUnit} needed”
- ✅ Slip page polish
  - 57 mm ticket CSS (`.ticket`) for thermal printers
  - Back-to-Kiosk link; optional auto-print/auto-return
- 🔧 Cashier screen
  - Cash input (₱ received) + change preview
  - On settle: deduct per mode, mark **PAID**, optional auto-print, back to `/cashier`

### 2025-08-29 — Business model refinements

- **Terminology**: Slip → **Order / Order Ticket**; Kiosk → **Order Pad**
- **Delivery & Settlement**: Delivery (COD) model with **RemitBatch** (EOD: delivered UNPAID → PAID + print receipt)
- **Discounts**: amount-based (per line / per order) with **floor-price guardrails**; percentages removed from docs/UI
- **LPG Rules**: swap/upgrade flows; cylinder loan records
- **Customers**: `Customer` / `CustomerAddress` (split names, contact, optional geo)
- **Receipt**: 57 mm format finalized; print only on **PAID**

## 2025-08-30

- Renamed **Slip → Order Ticket**, **Kiosk → Order Pad** (docs + UI copy)
- Added **Utang (on-credit)** with due date, release-with-balance, partial payments
- Introduced **PARTIALLY_PAID** state
- Delivery flow with **DISPATCHED** deduction and **RemitBatch** settlement
- Amount-based discounts + guardrails (no sale below computed cost)
- 57 mm ticket/receipt patterns with single guarded auto-print
- Queue: **auto-cancel UNPAID** expired + **purge CANCELLED** >24h

## 2025-09-04

- UI: Unified POS look & feel (indigo theme), compact controls, consistent inputs across Order Pad, Cashier, Tickets, Receipts  
  **No logic changes.** (`a3aca3e`)

## 2025-09-07

- Minimal UI fixes: sticky headers, consistent containers, removed overlapping sub-navs
- AR: list, per-customer ledger, payment recording + auto-allocation, change handling
- Customers: consolidated layout with tabs (Profile / Pricing / AR); moved pricing to `customers.$id.pricing._index.tsx`
- Pricing groundwork: per-item discount rules in customer pricing view
- Routes cleanup: deleted obsolete `customers.$id.pricing.tsx` outlet

### 2025-09-07 — Mobile-first Order Pad polish

**Added**

- Sticky bottom action bar + full-screen Cart sheet (mobile)
- Product cards show inline “− qty +” stepper (mobile)
- Category pill bar (emoji icons, edge fades, padding)
- Mobile infinite scroll

**Changed**

- Scanner is **mobile-only**; desktop Scan removed from list
- Desktop pagination hidden on mobile (auto-load)
- Removed redundant unit-price captions on mobile cart lines

**Fixed**

- TDZ error (“Cannot access `total` before initialization”) by using `filtered.length`
- Category white edge fades now match `#f7f7fb` and auto-hide at ends

**Notes**

```css
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
```

## 2025-09-08 — Rule-aware pricing parity

**Added**

- Discount lines on **Official Receipt** and **Payment Acknowledgment** (per-rule breakdown).
- Receipts/ACK recompute discounted totals using rules valid at payment time (`paidAt` or payment timestamp).

**Changed**

- Server cart unit-kind inference mirrors client; unknown `unitKind` treated as wildcard for rule matching.
- AR Index & Customer Ledger balances now use **discounted totals** (not `totalBeforeDiscount`).

**Fixed**

- Full payments with discounts now print **Official Receipt** (no more ACK misfire).
- AR payment allocation/status updates use effective totals; orders flip to **PAID** correctly.
- TypeScript cleanups: union narrowing for `Rule`, declared `adjustedItems`, removed unused `computeUnitPriceForCustomer` import.

**Files touched**

- `app/routes/cashier.$id.tsx`
- `app/routes/orders.$id.receipt.tsx`
- `app/routes/orders.$id.ack.tsx`
- `app/routes/ar._index.tsx`
- `app/routes/ar.customers.$id.tsx`

_DB schema unchanged. No migrations required._

## 2025-09-08 — Centralized rule-aware pricing parity

**Added**

- `services/pricing.ts`: `fetchActiveCustomerRules(db, customerId)` to load/map active item rules.
- `services/pricing.ts`: `buildCartFromOrderItems({ items, rules })` for rule-aware cart building (unitKind inference + Decimal→number coercion).
- Discount lines on Official Receipt and Payment Acknowledgment (per-rule breakdown).

**Changed**

- Cashier, Receipt, Ack, AR List, and Customer Ledger now use shared `applyDiscounts` + centralized rule fetcher/cart builder.
- Server cart unit-kind inference mirrors client; unknown `unitKind` acts as wildcard with rule-aware fallback.
- AR Index & Customer Ledger balances now use **discounted totals** (not `totalBeforeDiscount`).
- `/api/customer-pricing` now sources rules via shared helper (no duplicate DB→rule mapping).

**Fixed**

- Full payments with discounts now print Official Receipt (no ACK misfire).
- AR payment allocation/status updates use effective totals; orders flip to **PAID** correctly.
- TypeScript cleanups: Decimal coercions, union narrowing for `Rule`, removed duplicate/local pricing helpers.

**Files touched**

- `app/services/pricing.ts`
- `app/routes/api.customer-pricing.tsx`
- `app/routes/cashier.$id.tsx`
- `app/routes/orders.$id.receipt.tsx`
- `app/routes/orders.$id.ack.tsx`
- `app/routes/ar._index.tsx`
- `app/routes/ar.customers.$id.tsx`

_DB schema unchanged. No migrations required._

## 2025-09-09 — Statement of Account (SOA)

**Added**

- New route: `app/routes/ar.customers.$id.statement.tsx` (Statement of Account).
- Period selector (Start/End) with print button.
- Optional `?items=1` toggle to show per-line effective unit price and line totals using rules valid at the time.
- Opening balance computation (pre-period charges minus payments).
- Running balance per transaction (opening → each txn), displayed in the table.

**Changed**

- AR Customer Ledger (`ar.customers.$id.tsx`): added quick action link to Statement.
- SOA totals now use the pricing engine (`applyDiscounts`) via `fetchCustomerRulesAt` and `buildCartFromOrderItems` to ensure parity with receipts/ACK.

**Fixed**

- End-date filter off-by-one: switched to local date parsing and **exclusive end** (so the chosen end day is fully included).
- Payments can no longer drive the running balance negative (each payment capped to current due and reported as `creditApplied`).
- Cleaned up unused variable warning by replacing `txnsWithRunning` with `txnsWithApplied`.

**Files touched**

- `app/routes/ar.customers.$id.statement.tsx` (new)
- `app/routes/ar.customers.$id.tsx` (add Statement link)
- `app/services/pricing.ts` (helpers referenced: `applyDiscounts`, `buildCartFromOrderItems`, `fetchCustomerRulesAt`)

_DB schema unchanged. No migrations required._

## 2025-09-09 — Delivery: Geo-address snapshot (Order-level)

**Added**

- Link `Order → CustomerAddress` via `deliveryAddressId` (named relation).
- Snapshot fields on `Order`: `deliverTo`, `deliverPhone`, `deliverLandmark`, `deliverGeoLat`, `deliverGeoLng`, `deliverPhotoUrl`, `deliverPhotoKey`.
- Optional landmark photo on `CustomerAddress`: `photoUrl`, `photoKey`, `photoUpdatedAt`.
- Indexes: `Order(deliveryAddressId)` and `Order(deliverGeoLat, deliverGeoLng)`.

**Behavior**

- For **Delivery**, always snapshot **address + landmark**; **coords/photo optional**.
- Do **not** block dispatch if coords are missing; Delivery Ticket uses **QR to Maps** (pin if coords, text search otherwise).
- Photos are **screen-only** (packing/dispatch/remit), **not** printed on 57 mm.

**DB**

- Migration: `order-delivery-geo-snapshot` (adds-only; no breaking changes).

## 2025-09-11 — Delivery channel support & receipts

**Added**

- Delivery channel support across order creation.
  - **Server** (`/orders/new` action): accepts `channel=PICKUP|DELIVERY` + delivery snapshot fields (`deliverTo`, `deliverPhone`, `deliverLandmark`, `deliverGeoLat`, `deliverGeoLng`, `deliverPhotoUrl`, `deliveryAddressId`); validates when `DELIVERY`, saves snapshots on the order.
  - **Client (Order Pad)**: toggle Pickup vs Delivery; inputs for recipient, phone, landmark, geo, photo; posts hidden fields only for Delivery; carries `customerId` and `deliveryAddressId`.
  - Customer search & attach (phone-first) for Delivery orders (queries `/api/customers/search`), selects a customer, auto-prefills `deliverTo` & phone, lets you choose an address, and posts `customerId + deliveryAddressId`.
- Pricing engine reuse on **cashier preview** and **receipt**: both use `applyDiscounts`, `buildCartFromOrderItems`, `fetchCustomerRulesAt` for consistent totals.

**Changed**

- Inventory deduction timing:
  - **Pickup**: deduct at payment (as before).
  - **Delivery**: deduct at **Dispatch** (new action) instead of at payment; dispatch still prints a Delivery Ticket.
- Receipt can show **tendered cash** + **change** if provided in the URL (`?cash=` and `?change=`). Falls back to computing change from total vs recorded payments when params are absent.

**Fixed**

- Server: order creation now links customers correctly (`customerId`/`deliveryAddressId` read from submitted form).
- Search API: improved phone/name matching and scoring so typing a PH mobile (e.g., `0912…`) surfaces the correct customer quickly.

**Notes / Behavior Clarifications**

- Partial payments / balance (utang) **require a customer** before the server will accept releasing with balance.
- Manager approval is enforced when releasing with balance or when per-item price is below the allowed customer price.
- Receipt totals: “Grand Total” is the **rule-aware** total; “Paid” lines show actual recorded payments. If `cash`/`change` are present in the query, they **override** the derived display.

**Known Issues / Follow-ups**

- Cash/Change not appearing on fully-paid receipts  
  **Why**: cashier redirect to `/orders/:id/receipt?autoprint=1&autoback=1` doesn’t append `cash` & `change`.  
  **Where**: `app/routes/cashier.$id.tsx` (action `settlePayment`).  
  **Fix**: Include tendered/change in the redirect.
- Customer search response shape mismatch (`{ items: [...] }` vs `{ hits: [...] }`) — **standardize** one shape.
- Order creation (Pickup): ensure `customerId` field name matches what UI posts.
- Dispatch is an **action**, not a page — plan **Dispatch Page & Runs** (hub, run details, reconcile).

**Verification Checklist (smoke tests)**

- **Pickup**: create order, pay with cash > total → Official Receipt shows Cash Received and Change correctly.
- **Delivery**: create order with delivery fields + linked customer/address → pay any amount:
  - Fully paid: order becomes **PAID**; inventory deducted at dispatch (by design).
  - Partial: order becomes **PARTIALLY_PAID**; requires customer; optional release with manager approval.
- **Dispatch flow**: Delivery order → Dispatch action deducts stock and prints Delivery Ticket.
- **Pricing**: discounted customers — totals match on cashier preview & receipt; below-allowed prices require manager override.

## 2025-09-12 — Receipt & Remit wiring

- Implemented **receipt printing toggles** (`printReceipt` default **true**).
- Added **remit link** on cashier header.
- Clarified stock deduction:
  - **PICKUP** → deduct at payment.
  - **DELIVERY** → deduct at dispatch.
- Stock delta logic updated:
  - Pack vs retail inferred from allowed customer price.
  - Rounding guardrails (epsilon checks).
- Drafted **Remit Flow**: unsold load returns to stock.

## 2025-09-13 — Search & UI flicker fixes

- Centralized **Customer Search API**:
  - `q` tokenized; matches by name, alias, or phone (normalized).
  - Scoring: phone exact > prefix > contains > name; returns top 10.
- Began refactor to `useCustomerSearch` hook (reuse across Cashier, CustomerPicker).
- Fixed cashier name-field flicker (controlled vs uncontrolled) by centralizing `selectedCustomer` state.

## 2025-09-14 — Discount & pricing polish

- Cashier preview panel:
  - Shows item-level discount badges (percent or peso override).
  - Totals: subtotal, discounts, before vs after discounts.
- Synced client rules with loader-fetched rules.
- Ensured discounts apply in both preview and `settlePayment` action.

## 2025-09-15 — Dispatch Summary

- Added **Dispatch Summary Page** (`orders.$id.dispatch.tsx`):
  - Shows assigned rider and extra load carried.
  - Displays dispatched items with qty/price/line totals.
  - Print-friendly summary for ticket confirmation.

## 2025-09-16 — Remit Summary

- Added **Remit Summary Page** (`remit.$id.summary.tsx`):
  - Header card: parent remit info (order code, rider, status, totals).
  - **Parent items** table for evaluation.
  - Child orders split:
    - **Cash Sales** (reprint links + “Print all”).
    - **Credit Sales** (ACK links + “Print all”).
  - Actions: “Reprint Parent” and “Print Rider Consolidated”.

## 2025-09-17 — Rider Consolidated Receipt

- Added **Rider Receipt Page** (`remit.$id.rider-receipt.tsx`):
  - Consolidated layout showing parent items and all child orders.
  - Per-child: order code, customer name, total, and paid amount.
  - **Grand Totals**: amount vs paid.
  - Print-friendly with single **Print** button.
- **Customer name fallback logic**:
  - Prefer linked customer alias/full name → parsed `deliverTo` → “Walk-in”.

## 2025-09-18 — Remit & Receipts (wire-up pass)

**Added**

- `app/routes/remit-summary.$id.tsx` — Rider Remit Summary page.
- `app/routes/remit-receipt.$id.tsx` — Rider Consolidated Receipt.
- `app/routes/receipts._index.tsx` — Receipts index.

**Database / Migrations**

- `prisma/migrations/20250916120637_add_remit_parent_and_payment_tendered_change/`
  - Remit parent link for child orders created during rider remit.
  - Updated payment “tendered” structure to support remit/child cash receipts.

**Notes**

- Display shows **actual customer name** when present; only shows “Walk-in” if no linked customer and `deliverTo` can’t be parsed.
- Delivery flow (dispatch → remit → summary → rider receipt) is **functional**, with print actions wired.

## 2025-09-24 — Remit discounts snapshot + parity (latest)

**Added**

- **Persist discounted snapshot at remit posting**
  - `order.subtotal` = **original subtotal** (pre-discount).
  - `order.totalBeforeDiscount` = **final total** (post-discount).
  - `order_items.lineTotal` = **final discounted** line amount.

**Changed**

- **Summary & Rider Receipt** now show: **Original subtotal**, **Discounts**, **Total after discounts**.
  - Pure **read from DB** (no pricing recompute).

**Remit page (Sold from Rider Load)**

- Uses **PACK** pricing; pre-fills to **allowed** when a customer is linked and price wasn’t manually edited.
- Guards:
  - Cash/no-customer **below-allowed** is **blocked**.
  - **On-credit requires a customer**.

**New endpoint**

- `/resources/pricing/allowed` — returns `{ ok, allowed }` for `pid` (+ optional `cid`, `unit=PACK|RETAIL`) to preview/prefill allowed unit price.

**Fixes & cleanup**

- De-duped final-total recompute; removed duplicate `$transaction` snapshot blocks.
- Replaced stray `var` with `const/let`; fixed hook deps (`refreshRowAllowed` ← `defaultPriceFor`).
- Kept `pid` in reprint URLs so **Cash Received** shows correctly.

**Files**

- `app/routes/remit.$id.tsx`
- `app/routes/remit-summary.$id.tsx`
- `app/routes/remit-receipt.$id.tsx`
- `app/services/pricing.ts`
- `app/routes/resources.pricing.allowed.ts` _(new)_
