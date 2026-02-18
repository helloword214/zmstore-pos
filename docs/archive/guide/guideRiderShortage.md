# Rider Shortage / Variance / Settlement

> DEPRECATED
> Superseded by:
> - `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`
> - `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
> - `docs/guide/Accounts Receivable — Canonical Source of Truth (SoT)`
>
> This file is retained for historical context only. Do not use it as implementation authority.

## Option A — Historical Implementation Guide

This document defines how **rider shortages**, **cash variances**, and **run settlement**
are handled in the POS system.

This is the **single source of truth** for the next implementation phase.

---

## 1. Core Principle

> **Customer payments are never altered to fix rider shortages.**  
> Any missing cash after per-order remittance is a **rider liability**, not A/R.

No ghost money.  
No silent adjustments.

---

## 2. Scope

Covers:

- Delivery runs (parent + roadside)
- Cashier settlement
- Manager variance decisions
- Rider acknowledgment
- Rider shortage repayment (manual, no HR yet)

Out of scope:

- Payroll / auto salary deduction
- HR integration

---

## 3. Entities & Tables (Current + New)

### 3.1 Customer Payment (existing)

**Table:** `payment`

Purpose:

- Records cash collected per order
- Source of truth for customer payment

Key fields:

- `orderId`
- `amount`
- `createdAt`
- `createdById`
- `shiftId` (optional but recommended)

---

### 3.2 Rider Run Variance

**Table:** `riderRunVariance`

Purpose:

- Audit trail of run-level shortages / overages

Key fields:

- `runId`
- `riderId`
- `shiftId` ✅ (cashier who recorded variance)
- `expected`
- `actual`
- `variance`
- `status`
- `resolution`
- `managerApprovedAt`
- `riderAcceptedAt`
- `resolvedAt`

#### Status meanings

- `OPEN`  
  → created by cashier (run not balanced)

- `MANAGER_APPROVED`  
  → manager decided (CHARGE_RIDER / INFO_ONLY)  
  → may still wait for rider acceptance

- `RIDER_ACCEPTED`  
  → rider acknowledged shortage (CHARGE_RIDER only)

- `WAIVED`  
  → manager waived variance

- `CLOSED`  
  → run settled, variance finalized

---

### 3.3 Rider Charge (existing)

**Table:** `riderCharge`

Purpose:

- Ledger header for rider liability

Key fields:

- `varianceId` (unique)
- `runId`
- `riderId`
- `amount`
- `status` (OPEN / PARTIALLY_SETTLED / SETTLED / WAIVED)
- `settledAt`

---

### 3.4 Rider Charge Payment (NEW)

**Table:** `riderChargePayment`

Purpose:

- Actual payments made by rider to cover shortages

Key fields:

- `id`
- `riderChargeId`
- `amount`
- `method` (CASH | GCASH | OTHER)
- `note`
- `createdAt`
- `createdById`
- `shiftId` (optional)

Rules:

- Does NOT touch customer orders
- Does NOT affect A/R
- Updates `riderCharge.status`

---

## 4. Run Settlement Rules (Cashier)

### A. Per-order remittance

- Cashier records payment per order
- Orders are marked PAID based on payments

### B. Run computation

- `expectedCash` = sum of rider cash per receipt
- `actualCash` = sum of payments recorded
- `cashShort = expectedCash - actualCash`

### C. Auto-settle

Run auto-settles **only if**:

- All orders are fully remitted
- `abs(cashShort) < EPS`

---

## 5. Variance Flow

### Step 1 — Cashier records variance

Triggered when:

- All orders remitted
- Run not balanced

Action:

- Create `riderRunVariance`
- Attach `shiftId`
- Status = `OPEN`

---

### Step 2 — Manager decision

Route: `/store/rider-variances`

Options:

- `WAIVE`  
  → variance cleared immediately

- `INFO_ONLY`  
  → cleared once manager approves

- `CHARGE_RIDER`  
  → creates / upserts `riderCharge`  
  → waits for rider acceptance

---

### Step 3 — Rider acceptance

Route: `/rider/variances` → `/rider/variance/:id`

Rules:

- Only for shortages (negative variance)
- Rider only **acknowledges**, never decides

Result:

- variance → `RIDER_ACCEPTED`

---

### Step 4 — Cashier finalizes run

Route: `/cashier/delivery/:runId`

Allowed if:

- All orders remitted
- `(balanced) OR (variance cleared)`

Effect:

- `deliveryRun.status = SETTLED`
- `riderRunVariance.status = CLOSED`

---

## 6. Important Clarifications

### ❓ Do we re-enter the missing cash as customer payment?

**NO.**

Customer payments remain as encoded.  
The shortage is handled separately via rider charge.

---

### ❓ Are customers shown as paid even if rider was short?

**YES**, as long as:

- Per-order remits are complete
- Run settlement passed variance rules

Customer ≠ Rider liability.

---

### ❓ Where does cashier audit see the shortage?

Via:

- `riderRunVariance.shiftId`
- Future shift summary:
  - Variances created in shift
  - RiderChargePayments recorded in shift

---

## 7. Rider Charge Repayment Flow (Manual)

### Scenario

- Rider shortage = ₱90
- Manager chose CHARGE_RIDER
- Rider accepted
- Run settled

### Later…

- Rider pays ₱90 in cash / GCASH

### Action

Route: `/store/rider-charges`

- Manager clicks **Record Payment**
- Creates `riderChargePayment`
- Updates `riderCharge.status`

No effect on:

- Customer orders
- A/R
- Run settlement

---

## 8. Manager Routes Summary

### Existing

- `/store/rider-variances`

### New (to implement)

- `/store/rider-charges`
  - list open / partial charges
  - record payments
  - view history

---

## 9. Design Rationale

### Why Option A

- Clean audit trail
- No ghost money
- No customer data corruption
- Matches real-world ERP practice
- Scales later to payroll / HR

### Trade-off

- Extra step for shortages  
  → **Accepted business decision**

---

## 10. TL;DR

- Customers pay per order
- Runs settle with balance or cleared variance
- Shortage becomes rider liability
- Rider payments are tracked separately
- Nothing is silently adjusted

**Cash is cash. Responsibility is explicit.**

DELIVERY RUN (CLOSED)
|
| Cashier remits per ORDER/RECEIPT (Payments)
v
Compute run expectedCash vs totalPaidRun
|
+-- Balanced? (abs(cashShort) < EPS)
| |
| +-- YES -> Cashier can Finalize -> Run SETTLED -> Variance CLOSED(if exists)
|
+-- NO (short/over)
|
+-- Cashier Record Variance -> riderRunVariance: OPEN (shiftId attached)
|
v
Manager review (/store/rider-variances)
|
+-- WAIVE -> variance WAIVED -> Cashier can Finalize -> Run SETTLED
|
+-- INFO_ONLY -> variance MANAGER_APPROVED -> Cashier can Finalize -> Run SETTLED
|
+-- CHARGE_RIDER (shortage-only)
|
+-- create/upsert riderCharge(OPEN)
v
Rider accepts (/rider/variances -> /rider/variance/:id)
|
+-- variance RIDER_ACCEPTED
v
Cashier Finalize run settlement -> Run SETTLED + variance CLOSED
|
v
Manager collects shortage later:
/store/rider-charges -> Record payment -> riderChargePayment
