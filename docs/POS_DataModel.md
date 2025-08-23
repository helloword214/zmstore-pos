# POS Data Model

> 📌 Purpose:  
> Defines the **database schema and key fields** for orders, payments, fulfillment, etc.
>
> 🛠 When to update:
>
> - If schema changes (add/remove columns).
> - If retention/archive rules change.
> - If derived fields logic changes (e.g., how grandTotal is calculated).
>
> ✅ Readers:
>
> - Backend developers (Prisma, DB)
> - DevOps (indexing, backups)
> - Auditors (to understand data retention)

---

# POS Data Model

## Core Entities

- Order
- OrderItem
- Payment
- Discount
- Fulfillment
- ReceiptCounter
- AuditLog

## Milestone 1 — Order Slip

- Snapshot items: productId, name, qty, unitPrice, lineTotal
- Save totals: subtotal, totalBeforeDiscount
- Slip metadata: terminalId, printedAt, printCount, expiryAt

## Milestone 2 — Cashier Queue

- Lock fields: lockedById, lockedAt
- editedByCashier boolean

## Milestone 3 — Payment & Receipt

- Payment table (method, amount, refNo)
- ReceiptCounter for auto-increment numbers

## Milestone 4 — Fulfillment

- Fulfillment table with state (NEW → HANDOVER)
- Staff IDs: pickedBy, packedBy, releasedBy
- openSack logic logged separately
