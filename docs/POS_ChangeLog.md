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
