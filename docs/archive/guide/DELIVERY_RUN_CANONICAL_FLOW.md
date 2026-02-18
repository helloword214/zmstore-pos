# Delivery Run – Canonical Flow & Source of Truth

> DEPRECATED
> Superseded by:
> - `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
>
> This file is retained for historical context only. Do not use it as implementation authority.

This document is the SINGLE SOURCE OF TRUTH for how a Delivery Run behaves
from order creation until cashier settlement.

If behavior here contradicts code, the code is wrong.

---

## High-Level Timeline

    T0 Order Created (PAD)
    T1 Run DISPATCHED
    T2 Summary (pre-checkin)
    T3 Rider CHECK-IN
    T4 Summary (post-checkin)
    T5 Manager REMIT (close run)
    T6 Summary (final)
    T7 Cashier DELIVERY REMIT

Every stage below defines:

- what is frozen
- what is mutable
- what must NEVER be recomputed

---

## T0 — Order Creation (PAD)

### What happens

- Customer / Walk-in order is created
- Discounts are computed
- Prices are frozen

### Allowed

- Pricing engine
- Product table reads
- Customer rules

### Frozen Outputs (PRICE TRUTH)

- Order.totalBeforeDiscount
- Order.subtotal
- OrderItem:
  - baseUnitPrice
  - discountAmount
  - unitPrice
  - lineTotal
  - unitKind

### Forbidden after this point

❌ Re-running pricing engine  
❌ Re-reading product.price / srp for totals

> After T0, prices are HISTORY.

---

## T1 — Run DISPATCHED

### What exists

- Loadout snapshot
- Parent orders linked to run

### Truth

- Quantity truth: **Loaded only**
- Money truth: **none yet**

### Important

This stage is NOT FINAL.

---

## T2 — Summary (Pre Check-in)

### Purpose

- Visibility only

### Quantity

- Loaded = from loadout snapshot
- Sold = 0
- Returned = 0

### Money

- Cash = 0
- A/R = 0

### Rules

❌ No pricing engine  
❌ No receipt math  
❌ No cash math

> Summary here is a **preview**, not accounting.

---

## T3 — Rider CHECK-IN

### What happens

- Rider declares sold & returned quantities
- Roadside sales recorded
- Parent orders acknowledged

### Writes

- RunReceipt(kind=PARENT)
- RunReceipt(kind=ROAD)

### Truth frozen here

- Quantity truth (sold/returned)
- Roadside money snapshot

### Rules

❌ No pricing engine  
❌ No discount recompute

---

## T4 — Summary (Post Check-in)

### Quantity (TRUTH)

- Source: loadRunRecap(runId)

### Money (TRUTH)

- Source: RunReceipt + cash maps

### Order totals priority

1. RunReceipt(kind=PARENT).lineTotal
2. Order.totalBeforeDiscount
3. Sum(OrderItem.unitPrice \* qty)

❌ Pricing engine NEVER used

---

## T5 — Manager REMIT (Close Run)

### Purpose

- Validate correctness
- Finalize run

### Guards

- Loaded == Sold + Returned
- No delta allowed

### Writes

- Stock RETURN_IN
- Roadside posted orders
- Run.status = CLOSED

### Rules

❌ No pricing engine  
❌ No recompute  
✅ Freeze enforcement only

---

## T6 — Summary (Final)

### Behavior

- View-only
- Immutable
- Audit-grade

### Uses same sources as T4

Nothing new is computed here.

---

## T7 — Cashier DELIVERY REMIT

### Purpose

- Money settlement only

### Displays

- Discount ONLY if snapshot exists
- Line totals from frozen data

### Money truth

- Rider cash from receipts
- Payments from Payment table

### Guards

- Must already be frozen
- Cannot proceed if not CHECKED_IN

### Rules

❌ Must NOT freeze pricing  
❌ Must NOT infer discount  
❌ Must NOT read product table

---

## Canonical Mental Model

> Prices freeze at T0  
> Quantities freeze at T3  
> Money freezes at T5  
> Summary never computes — it only reads history

---

## Debugging Rule

When a bug appears, ALWAYS ask:

1. Which T-stage am I in?
2. Which truth should be used here?
3. Am I accidentally recomputing something frozen earlier?
