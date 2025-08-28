# POS Business Plan

> 📌 Purpose:  
> This document describes the **big picture business logic** of the POS system.  
> It explains _why_ the system behaves this way, not just _how to code it_.
>
> 🛠 When to update:
>
> - When a **new rule** is added (e.g., discount policy changes).
> - When a **milestone** is completed (add summary under "Milestones Applied").
> - When a **business decision** is reversed (cross out old rule, add new one with date).
>
> ✅ Readers:
>
> - Self-taught devs (like us now).
> - Future devs joining the project.
> - Non-technical stakeholders who want to understand the workflow.

---

## Vision

Fast-food style **Kiosk → Cashier → Fulfillment** flow adapted to retail (rice, feeds, pet supplies, LPG).

## Core Principles

- **Kiosk**: Customer builds order, prints Order Slip (**no discounts**).
- **Cashier**: Verifies order, applies discounts, collects payment.
- **Receipt**: Only issued when order is `PAID`.
- **Inventory**: Deducted only when `PAID`.
- **Fulfillment**: Picking/Packing starts after payment.

---

## Data Terms (Kiosk/Inventory semantics)

- `price` — **retail/unit price** (e.g., per kg / pc)
- `srp` — **pack price** (e.g., per sack / tank)
- `stock` — **pack count** on hand (sacks/tanks)
- `packingStock` — **retail units** on hand (kg/pcs)
- `allowPackSale` — retail is allowed (can sell by unit **and** by pack)

---

## Milestones Applied

### Milestone K1 — Kiosk UI (Tablet-First)

**Scope (UI only, no discounts/payment yet)**

- Tablet-first kiosk for item selection and cart building.
- Category chips + search, product grid, sticky cart.
- Qty rules: retail-allowed → step **0.25**; pack-only → step **1**.
- **Mixed-mode orders** for eligible products: customer can add **Retail** and **Pack** for the **same product** in one slip.
  - Cart lines are keyed by **product + mode**; slip uses snapshot `{id, name, qty, unitPrice}` per line.
- **Unit-aware Add buttons**:
  - Retail → **“Add by {unit}”** (uses `price`, step **0.25**)
  - Pack → **“Add {packUnit} ({packSize} {unit})”** (uses `srp`, step **1**)
- **Availability is per mode** (independent disable rules):
  - Retail requires `packingStock > 0` **and** `price > 0`
  - Pack requires `stock > 0` **and** `srp > 0`
- **Low / Out** badges shown **inline beside the product name** for quick scanning.
- “Print Order Slip” posts the cart to **`POST /orders/new`** (fetcher; JSON).

**Out of scope (moved to later milestones)**

- Discounts, promos, customer data, barcode scan, cashier lock/queue.

**Why (business)**

- Faster iteration: visualize flow before wiring deeper backend.
- Reduces kiosk training time (big buttons, clear totals).
- Aligns with “Slip first, cashier later” principle.

**Acceptance (K1 v1)**

- [x] Filter by category/search and add items.
- [x] Add **Retail and Pack** for the same product in one cart.
- [x] Retail steps by **0.25**; Pack by **1**.
- [x] Add buttons have **unit-aware labels**; disable per-mode when unavailable or already in cart.
- [x] **Low/Out** badges appear beside product name.
- [x] Can print an Order Slip from the cart.

**Spec**

- See `docs/POS_KioskUI.md` for layout, behaviors, accessibility.

---

### Milestone 1 — Order Slip

- Slip shows **totals before discounts**.
- Discounts are **not** applied at kiosk.
- Expiry: **24h** by default.
- Reprint allowed (`Reprint #n` footer).
- **Note:** `items[]` may include **multiple lines with the same product `id`** when the customer buys both modes (Retail + Pack). Each line’s `unitPrice` reflects its mode.

---

### Milestone 1.1 — Server-side Slip Validation (mode-aware)

**Why**  
Kiosk data can go stale; server must clamp by **current DB** to keep slips valid.

**What the server enforces (at `POST /orders/new`)**

- Canonical mapping:
  - `stock` = **pack count**, `packingStock` = **retail units**
  - `price` = retail price, `srp` = pack price
- **Retail line**
  - `allowPackSale === true`
  - `price > 0`
  - `qty` multiple of **0.25**, and `qty ≤ packingStock`
  - `unitPrice === price` (prevents stale/edited client price)
- **Pack line**
  - `srp > 0`
  - `qty` is **integer**, and `qty ≤ stock`
  - `unitPrice === srp`

**Responses**

- **Success** → creates `UNPAID` **Order** with `items` snapshots `{ name, unitPrice, qty, lineTotal, productId }`;  
  returns JSON `{ ok: true, id }` to the kiosk fetcher (UI then navigates to `/orders/:id/slip`).
- **Failure** → `400 { errors: [ { id, mode?, reason } ] }` and the kiosk shows a small modal.  
  _No order is created when any line fails._

---

### Milestone 2 — Cashier Queue & Scan

- Cashier sees all `UNPAID` orders in queue.
- Orders lock when cashier opens (to prevent double handling).
- Cashier can apply discounts (senior, PWD, promo).
- Manager PIN required for manual/override discounts.

---

### Milestone 3 — Payment & Receipt

- Payment methods: Cash, GCash, Card.
- Split payments supported.
- Change always returned in cash.
- Official Receipt printed only when `PAID`.

---

### Milestone 4 — Fulfillment

- Fulfillment states: `NEW → PICKING → PACKING → READY_FOR_PICKUP → HANDED_OVER`.
- Pick Ticket prints after `PAID`.
- Open Sack allowed during packing (convert sack → retail stock).
- Abandoned orders marked `UNCLAIMED` after timeout.

## 2025-08-28 — Cashier Flow (MVP) now live

### Cashier Responsibilities

- Open slip from queue (scan/type **Order Code** or click in list).
- Order is **exclusively locked** to the cashier for **5 minutes** (TTL).
- Verify items with customer; reprint slip if needed.
- **Mark Paid (Cash)** — triggers inventory deduction (see below).
- Release lock when stepping away (returns order to queue).

### Locking (Why & How)

- **Why**: Prevents two cashiers from handling the same order.
- **How**: Claim lock by setting `lockedAt` + `lockedBy`.  
  TTL = **5 minutes**; stale locks can be reclaimed from the queue.  
  Releasing clears both fields.

### Payment (MVP scope)

- Current scope: **Cash** only; no discounts/split yet.
- Server validates each line against **fresh product data**:
  - **Retail line**: requires `allowPackSale`, `unitPrice === price`; deduct **retail units** from `packingStock`.
  - **Pack line**: requires `unitPrice === srp`; deduct **pack count** from `stock`.
- All deductions happen **inside a transaction** and the order becomes **PAID**.
- On validation failure (price changed / insufficient stock): **no changes**; show per-line errors.

### Inventory Timing (unchanged principle)

- **Only deduct on `PAID`** (never on slip creation).
- Slip reprints increment `printCount` and update `printedAt` (expiry unchanged).

### Out of Scope (to be added next)

- Discounts (senior/PWD/promo/manual + manager PIN).
- Payment methods: **GCash**, **Card**, **Split**.
- Receipt printing (official receipt) and numbering.
