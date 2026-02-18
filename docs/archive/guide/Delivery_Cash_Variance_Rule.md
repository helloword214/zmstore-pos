# Delivery Cash Variance Rule (Option A)

> DEPRECATED
> Superseded by:
> - `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`
> - `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
>
> This file is retained for historical context only. Do not use it as implementation authority.

> **Purpose**: Define the canonical, non-negotiable rule for handling delivery cash shortages where the **customer has already paid**, but the **cashier received less** due to rider remittance issues.

---

## 🔒 Core Principle (Ukit‑sa‑Bato)

**Customer fairness always comes first.**

> **If `riderCash == finalTotal`, the Order MUST be treated as PAID — even if the cashier physically received less cash.**

Any shortage in cash **is NEVER a customer problem**. It is resolved between the **rider, manager, and cashier** via variance and rider charges.

---

## 🧠 Source of Truth (SoT)

| Domain           | Source of Truth                            |
| ---------------- | ------------------------------------------ |
| Customer payment | `RunReceipt.cashCollected` (PARENT / ROAD) |
| Cashier drawer   | `Order.payments` (CASH only)               |
| Missing cash     | `RiderRunVariance`                         |
| Rider liability  | `RiderCharge`                              |
| Order status     | **Customer perspective**                   |

> **Order status reflects customer payment, not cashier drawer balance.**

---

## ✅ Canonical Scenario Walkthrough

### Example

- `finalTotal` = ₱300
- `riderCash` = ₱300 (customer fully paid)
- Cashier receives = ₱220
- Shortage = ₱80

### Step‑by‑Step Flow

#### 1️⃣ Cashier – Per‑Order Remit

- Cashier encodes **actual cash received** → ₱220
- Payment record reflects ₱220 (truthful drawer state)
- **Order is marked PAID** (customer already paid in full)

> The cashier does **not** fake ₱300 receipt.

---

#### 2️⃣ Run‑Level Detection

- System computes:

  - `expectedCash = sum(RunReceipt.cashCollected)`
  - `actualCash = sum(Order.payments CASH)`

- Variance detected: **−₱80**

Cashier clicks **Record Variance**.

---

#### 3️⃣ Manager Review

- Manager reviews variance
- Resolution chosen: **CHARGE_RIDER**
- `RiderCharge` ₱80 created (linked to variance)

---

#### 4️⃣ Rider Acceptance

- Rider reviews variance
- Rider accepts shortage
- RiderCharge tagged for **payroll deduction / settlement**

---

#### 5️⃣ Cashier Finalization

- Cashier finalizes run settlement
- `DeliveryRun.status → SETTLED`
- `RiderRunVariance.status → CLOSED`

---

## 🚫 Explicit Non‑Rules (Never Do These)

- ❌ Do NOT mark order as PARTIALLY_PAID when customer already paid
- ❌ Do NOT convert rider shortage into customer A/R
- ❌ Do NOT inflate cashier cash to match receipts
- ❌ Do NOT recompute prices during remit

---

## ✅ Why Option A Is Correct

- Matches real‑world delivery operations
- Preserves customer trust
- Keeps cashier drawer honest
- Clean audit trail
- Separates **customer payment** from **employee accountability**
- Prevents cascading accounting bugs

---

## 🧭 Design Intent Summary

> **Customer pays once.** > **Cashier records what they actually receive.** > **Rider shortages are handled separately.**

This rule is final and should be referenced whenever touching:

- `delivery-remit.$id.tsx`
- `cashier.delivery.$runId.tsx`
- `store.rider-variances.tsx`
- `rider/variance.$id.tsx`

---

**Status:** FINAL ✅
