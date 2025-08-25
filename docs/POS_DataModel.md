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

### Order / OrderItem (added 2025‑08‑23)

**Entities**

- `Order` — snapshot of a kiosk slip (status=`UNPAID`).
- `OrderItem` — line items linked to `Order`.

**Order fields**

- `orderCode` (string, unique) — human‑friendly code printed on slip.
- `status` (enum) — `UNPAID` at creation.
- `subtotal` (float) — sum of item `qty * unitPrice`.
- `totalBeforeDiscount` (float) — equals `subtotal` in M1 (no discounts yet).
- `printCount` (int, default 1) — increments on reprint.
- `printedAt` (datetime) — when slip was first printed.
- `expiryAt` (datetime) — default +24h from `printedAt`.
- `terminalId` (string, optional) — kiosk/counter identifier.
- `createdAt`, `updatedAt`.

**OrderItem fields**

- `productId` (int) — reference for analytics.
- `name` (string) — snapshot of product name (immutable).
- `qty` (float) — supports retail weights (e.g., 0.5).
- `unitPrice` (float) — snapshot at time of slip.
- `lineTotal` (float) — `qty * unitPrice`.

**Invariants**

- `subtotal = sum(lineTotal)`.
- `totalBeforeDiscount = subtotal` (Milestone 1).
- `qty > 0`, `unitPrice ≥ 0`, `lineTotal = round(qty * unitPrice, 2)`.

**Indexes**

- `Order(status)`, `Order(expiryAt)` — for cashier queue & cleanup.

**Retention**

- Keep `UNPAID` orders for 30 days (TBD).  
  Auto‑purge expired slips older than N days (configurable).

**Example**

```json
{
  "orderCode": "8K3J5Q",
  "status": "UNPAID",
  "subtotal": 168,
  "totalBeforeDiscount": 168,
  "printCount": 1,
  "printedAt": "2025-08-23T11:30:00+08:00",
  "expiryAt": "2025-08-24T11:30:00+08:00",
  "terminalId": "KIOSK-01",
  "items": [
    { "productId": 123, "name": "Rice", "qty": 1, "unitPrice": 48, "lineTotal": 48 },
    { "productId": 456, "name": "Cat Food", "qty": 1, "unitPrice": 120, "lineTotal": 120 }
  ]
}


#### Product pricing & stock semantics (UI integration)

- `price Float?` — **retail per-unit** price (e.g., per kg or per pc).
- `srp Float?` — **per-pack** price (e.g., per sack/tank). Used when selling packs.
- `allowPackSale Boolean` — if `true`, kiosk shows retail price/stock and allows fractional quantities.
- `unitId` / `packingUnitId` — display labels for retail unit vs pack unit (e.g., `kg` vs `tank`).
- `packingSize Float?` — container size in retail units (e.g., `22` means 22 kg per tank). Shown as text only (`{packingSize} {unit} / {packingUnit}`); **not** used to compute a price in UI.
- `stock Float?` — **retail stock** (loose) available (e.g., kg/pcs), shown only if `allowPackSale = true`.
- `packingStock Int?` — **pack stock** (whole sacks/tanks), always shown.

**Kiosk display rules**
- Retail price shown only if `allowPackSale = true` and `price > 0`.
- Pack price shown only if `srp > 0`.
- Never compute a pack price from retail (no `price × packingSize`).
- Stock row shows packs always; retail only when retail is allowed.
- “Add” enables only when the corresponding price exists:
  - Retail flow → requires `price`.
  - Pack-only flow → requires `srp`.



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
```
