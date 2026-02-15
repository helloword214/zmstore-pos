# 🔒 Pricing, Collection & Unit Freeze — Source of Truth Guide

**Decision log:** We explicitly chose **Option B (Order → originRunReceipt)**  
**Date:** _(fill later if needed)_

---

## ✅ Core Principles (Non-negotiable)

**One truth per business concept. No duplication. No inference.**

- **Order pricing truth** → `Order` + `OrderItem`
- **Run / roadside pricing truth** → `RunReceipt` + `RunReceiptLine`
- **Cash collection truth (rider side)** → `RunReceipt.cashCollected`
- **Roadside unit rule** → **PACK-ONLY (whole units only)**

---

## 🧱 Final Architecture (Ukit sa Bato)

### 1️⃣ Parent Flow (PAD / POS Orders)

**Source of truth:**  
👉 `Order` + `OrderItem` (frozen)

**When pricing runs:**

- Once only (PAD / POS time)
- Before or during manager check-in (never after)

**Frozen fields:**

- `OrderItem.unitKind`
- `OrderItem.unitPrice`
- `OrderItem.lineTotal`
- _(ideal)_ `OrderItem.baseUnitPrice`
- _(ideal)_ `OrderItem.discountAmount`

**After freeze (READ-ONLY forever):**

- Manager review
- Cashier remit
- Receipt printing
- Audit / AR

❌ No recompute  
❌ No SRP lookup  
❌ No pricing rules engine re-run  
❌ No unitKind inference

---

### 2️⃣ Road / Adhoc Flow (Sold From Load)

**Source of truth:**  
👉 `RunReceipt` + `RunReceiptLine` (frozen)

**Key rules:**

- Road sales **do NOT originate as Orders**
- Road sales are **PACK-ONLY (whole units only)**  
  _No retail / tingi / fractional selling_

> Business reality:  
> Hindi magbubukas ng sako o maghihiwa ng pack sa kalsada.

**Frozen fields:**

- `RunReceiptLine.unitKind` → **always `PACK`**
- `RunReceiptLine.unitPrice`
- `RunReceiptLine.baseUnitPrice`
- `RunReceiptLine.discountAmount`
- `RunReceiptLine.lineTotal`
- `RunReceipt.cashCollected`

❌ No retail pricing  
❌ No fractional qty  
❌ No unitKind switching downstream

---

## 🔗 Why We Chose “Option B” (Order → RunReceipt)

### Problem We Solved

When roadside sales are converted into Orders (for cashier / printing / AR):

- Cashier UI is **Order-based**
- Rider collection data lives in **RunReceipt**

Without a DB link, cashier is forced to:

- recompute expected cash ❌
- rely on query params ❌
- duplicate pricing logic ❌

---

## ✅ Final Decision: Link Order to Origin RunReceipt

**Design choice:**  
Orders created from roadside sales are **representations only**,  
not new pricing or collection truths.

**Implementation rules:**

- Each roadside-generated Order **must reference its origin RunReceipt**
- Pricing truth stays in `RunReceiptLine`
- Collection truth stays in `RunReceipt.cashCollected`
- `OrderItem.unitKind` for roadside orders is **always `PACK`**

---

## 📌 Canonical Rules (Memory Lock)

1. **PAD / POS Order exists**  
   👉 `OrderItem` is the pricing truth
2. **Roadside / Sold-from-Load**  
   👉 `RunReceiptLine` is the pricing truth (PACK-only)
3. **Roadside Order shown in cashier**  
   👉 Follow `originRunReceipt`, not the Order header

> Even if an Order exists,  
> **if it came from roadside → RunReceipt is still the source of truth**

---

## 🧭 How Each Role Uses This

### 👷 Rider

- Encodes roadside sales → `RunReceipt` (DRAFT)
- Sells **PACK-only**
- Saves `cashCollected`
- Pricing & collection are **draft** until manager approval

---

### 🧑‍💼 Store Manager (`runs.$id.remit.tsx`)

- Reviews stock recap  
  `Loaded = Sold + Returned`
- Reviews pricing (**READ-ONLY**)
- On **Post Remit**:
  - Finalizes run
  - Creates roadside (RS) Orders
  - Links each RS Order → **origin RunReceipt**
  - Marks run as `CLOSED`
- After this: **irreversible** (VOID / CANCEL only)

---

### 💰 Cashier (`delivery-remit.$id.tsx`)

- NEVER recomputes price
- NEVER infers unitKind
- NEVER recomputes rider expected cash
- Reads:
  - `OrderItem` for PAD pricing
  - `originRunReceipt.cashCollected` for roadside expectation
- Records payments only

---

## 🧠 Simple Rule to Remember Forever

- **PAD = OrderItem**
- **Road = RunReceiptLine**
- **Road = PACK-only**
- **Cash truth = RunReceipt**

**If you follow this:**

- ✔ walang “nawala ang discount”
- ✔ walang double freeze
- ✔ walang unitKind bugs
- ✔ walang tingi sa kalsada
- ✔ audit-safe (BIR / variance / AR)
