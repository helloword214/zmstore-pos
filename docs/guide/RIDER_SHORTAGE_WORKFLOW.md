# Rider Shortage / Cash Variance

Workflow & Business Rules

## Scope

Delivery runs (parent + roadside), cashier settlement, manager decision,
and rider acknowledgement.

## Goal

Kapag may kulang, hindi pwedeng ma-settle ang run hangga’t
hindi ina-acknowledge ng rider.

> Policy: **“Kulang ay kulang.”**

---

## Core Policy (Non-Negotiable)

- Cashier records **facts only**
- Manager decides **resolution**
- Rider **acknowledges responsibility** (if charged)
- Settlement is **blocked** until variance is cleared

No shortcuts. No silent losses.

---

## Key Definitions

### Expected Cash

Cash na dapat i-remit ni rider for the run  
**Source of truth:** `RunReceipt.cashCollected`

### Collected (This Run)

Payments recorded by cashier (capped by riderCash)

### Cash Short / Over

- `cashShort > 0` → SHORTAGE
- `cashShort < 0` → OVERAGE
- `abs(cashShort) < 0.01` → BALANCED

---

## When Is a Variance Considered CLEARED?

A variance is **cleared** if ANY is true:

1. `status = WAIVED` or `status = CLOSED`
2. `resolution = CHARGE_RIDER` **AND** `riderAcceptedAt` is set
3. `resolution = INFO_ONLY` or `WAIVE` **AND** `managerApprovedAt` is set
4. Legacy support: `status = RIDER_ACCEPTED`

If **not cleared** → cashier **CANNOT finalize settlement**.

---

## Full Workflow

### Step 1 — Cashier Remits Orders

**Route:** `delivery-remit.$id.tsx`

- Cashier records payments per order
- Payments affect run totals

---

### Step 2 — Cashier Run Summary

**Route:** `cashier.delivery.$runId.tsx`

System computes:

- `expectedCash`
- `totalPaid`
- `cashShort`

If balanced → can finalize  
If not balanced → variance required

---

### Step 3 — Record Variance

**Action:** `record-variance`

Creates `RiderRunVariance`:

- expected
- actual
- variance
- status = `OPEN`

---

### Step 4 — Manager Review

**Route:** `/store/rider-variances`

Manager selects resolution:

- `CHARGE_RIDER`
- `WAIVE`
- `INFO_ONLY`

Effects:

- `WAIVE` / `INFO_ONLY` → cleared immediately
- `CHARGE_RIDER` → **rider acknowledgement required**

---

### Step 5 — Rider Pending Acceptance List

**Route file:** `app/routes/rider.variances.tsx`

Shows ONLY:

- `status = MANAGER_APPROVED`
- `resolution = CHARGE_RIDER`
- `riderAcceptedAt = null`
- `variance < 0` (shortage only)

---

### Step 6 — Rider Accepts Shortage

**Route:** `/rider/variance/:id`

System sets:

- `riderAcceptedAt`
- `riderAcceptedById`

Variance is now **CLEARED**.

---

### Step 7 — Cashier Finalizes Settlement

**Route:** `cashier.delivery.$runId.tsx`

Requirements:

- All per-order remits done
- Balanced **OR** variance cleared

Actions:

- `deliveryRun.status = SETTLED`
- `riderRunVariance.status = CLOSED`

---

## Important Business Rules

- Rider cannot ignore shortage
- Settlement cannot bypass rider acceptance
- Overages do **NOT** require rider acceptance
- Manager decides if rider will be charged
- Rider only **acknowledges**, never decides

---

## Why This Design

### Pros

- Forces rider to check dala niyang pera
- Prevents silent losses
- Clear accountability chain
- Audit-safe (cashier → manager → rider)

### Cons

- More steps when may shortage
- Settlement can be delayed if rider unavailable

Business decision: **acceptable trade-off**.

---

## Route Map (Quick Reference)

### Cashier

- `delivery-remit.$id.tsx`
- `cashier.delivery.$runId.tsx`

### Manager

- `/store/rider-variances`

### Rider

- `rider.variances.tsx` (list)
- `/rider/variance/:id` (acceptance)

---

## Mental Model (Memory Lock)

- PAD pricing → `OrderItem`
- Road pricing → `RunReceiptLine`
- Cash truth → `RunReceipt.cashCollected`

**Shortage is real money, not a system bug.**
