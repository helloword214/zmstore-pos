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

## ✅ Implemented (2025-08-28) — Cashier Locking + Stock Canonicalization

### Order (updates)

- **Locking fields** (used by Cashier Queue & Order view):
  - `lockedAt DateTime?`
  - `lockedBy String?` // cashier code/name
  - `lockNote String?` // optional reason
- **Indexes** (support queue + locking lookups):
  - `@@index([status, expiryAt])`
  - `@@index([lockedAt])`
  - `@@index([status])`
  - `@@index([expiryAt])`

**Semantics**

- Opening an order in `/cashier` **claims a lock** by setting `lockedAt` & `lockedBy`.
- Locks are **time-based** in app logic (TTL = **5 minutes**) — no extra DB column needed; staleness is computed as `now - lockedAt > TTL`.
- Reprinting updates **`printedAt`** and increments **`printCount`**; does **not** change `expiryAt`.

---

### Product pricing & stock semantics — **Canonical Mapping (corrected)**

> This replaces the earlier wording to match the code paths now in use.

- `price Float?` — **retail per-unit** price (kg/pc).
- `srp Float?` — **per-pack** price (sack/tank).
- `allowPackSale Boolean` — enables retail selling (fractional qty).
- `stock Float?` — **pack count on hand** (whole sacks/tanks).  
  _Used when deducting **pack** sales._
- `packingStock Int?` — **retail units on hand** (kg/pcs).  
  _Used when deducting **retail** sales._
- `unitId` / `packingUnitId` — display labels (e.g., `kg` vs `tank`).
- `packingSize Float?` — container size in retail units (text only; never compute `srp = price × packingSize`).

**Why this matters**

- In **kiosk** and **cashier** flows, validation & deduction now rely on:
  - **Retail lines** → compare against `price`, cap by `packingStock`, deduct from `packingStock`.
  - **Pack lines** → compare against `srp`, cap by `stock`, deduct from `stock`.

---

### Inventory Deduction (Payment)

- On `_action=settlePayment` (cashier page):
  - Server **re-reads products**, infers each line’s mode by price equality, and validates stock.
  - Consolidates line deltas **per product** and **deducts inside a transaction**:
    - `stock = stock - packQty`
    - `packingStock = packingStock - retailQty`
  - Sets `Order.status = PAID`.
  - If any line fails (price changed or insufficient stock) → **no changes**; returns per-line errors.

---

### OrderItem (reminder)

- Snapshot fields remain the source of truth for the slip:
  - `productId`, `name`, `qty`, `unitPrice`, `lineTotal`.
- We **do not** yet persist a line `mode` column; mode is **inferred** by matching `unitPrice` to `price/srp`.  
  _Optional future fields:_ `mode ENUM('RETAIL','PACK')`, `unitLabel TEXT`.

---

### Retention (no change)

- Keep `UNPAID` orders ~30 days (TBD).  
  Expired slips may be auto-cancelled and purged by a maintenance job.

---

### Prisma (current shape excerpt)

```prisma
model Order {
  id        Int         @id @default(autoincrement())
  orderCode String      @unique
  status    OrderStatus @default(UNPAID)

  subtotal            Float
  totalBeforeDiscount Float

  printCount Int      @default(1)
  printedAt  DateTime
  expiryAt   DateTime
  terminalId String?

  items     OrderItem[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Cashier locking
  lockedAt  DateTime?
  lockedBy  String?
  lockNote  String?

  @@index([status, expiryAt])
  @@index([lockedAt])
  @@index([status])
  @@index([expiryAt])
}
```
