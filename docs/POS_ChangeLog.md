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
