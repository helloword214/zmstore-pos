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

## current

- **Added `Order` and `OrderItem` models** for Milestone 1 (Order Slip).
- Defined snapshot fields (`name`, `unitPrice`) to preserve slip history even if products change later.
- Added indexes on `status` and `expiryAt` to support cashier queue and cleanup jobs.
- Added back-relation `orderItems` on `Product` model for analytics and queries.
