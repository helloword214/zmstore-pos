# 🔒 Pricing & Collection Architecture — Why This Exists

## Purpose of This Document

This document exists to answer ONE question in the future:

👉 **“Bakit natin hiniwalay ang cashier flow ng Parent Delivery at Roadside Sales?”**

Short answer: **to protect the source of truth and eliminate recompute / double-freeze bugs.**

---

## The Core Problem We Were Solving

Before this change, the cashier flow tried to handle **two different business concepts** in one route:

1. **Parent Delivery Orders (PAD / POS)**
2. **Roadside / Sold-from-Load Sales (RS)**

They LOOK similar on the surface (“may order, may bayad”),  
but **they do NOT share the same source of truth**.

This caused:

- recomputation of prices ❌
- fallback logic everywhere ❌
- query-param–based expected cash ❌
- “may discount kanina tapos nawala” ❌
- double-freeze confusion ❌

---

## The Final Mental Model (Ukit sa Bato)

### ✅ One truth per business concept — NO duplication

| Concept                 | Source of Truth                 |
| ----------------------- | ------------------------------- |
| Parent order pricing    | `Order` + `OrderItem`           |
| Roadside pricing        | `RunReceipt` + `RunReceiptLine` |
| Rider cash collected    | `RunReceipt.cashCollected`      |
| Cashier payment records | `Payment`                       |

---

## 1️⃣ Parent Flow (PAD / POS Orders)

### What it is

Orders that **exist before the run** (store-created, delivery orders).

### Pricing truth

👉 `OrderItem` (frozen by manager)

Frozen fields:

- `OrderItem.unitPrice`
- `OrderItem.lineTotal`
- (optional audit) `baseUnitPrice`
- (optional audit) `discountAmount`

### When pricing runs

- Once only
- During **manager check-in / remit posting**

### After freeze (READ-ONLY forever)

- Manager review
- Cashier remit
- Receipt printing
- Audit / AR

❌ No recompute  
❌ No SRP lookup  
❌ No pricing rules engine re-run

---

## 2️⃣ Roadside / Adhoc Flow (Sold From Load)

### What it is

Sales that **do not start as Orders**.

They originate during the run, encoded by the rider.

### Pricing truth

👉 `RunReceipt` + `RunReceiptLine`

Frozen fields:

- `RunReceiptLine.unitPrice`
- `RunReceiptLine.baseUnitPrice`
- `RunReceiptLine.discountAmount`
- `RunReceiptLine.lineTotal`
- `RunReceipt.cashCollected`

### Key rule

Roadside sales are **NOT delivery orders with discounts**.  
They are **run receipts that may later be represented as orders**.

---

## Why “Represented as Orders” Is Important

Cashier UI, receipts, and AR are **Order-based**.

So for roadside sales:

- We CREATE Orders
- But those Orders are **representations only**
- They are **NOT the pricing or collection truth**

👉 Pricing stays in `RunReceiptLine`  
👉 Collection stays in `RunReceipt.cashCollected`

---

## Why We Chose Choice A: Separate Cashier Routes

### Old situation (problematic)

One cashier route tried to handle:

- Parent delivery orders
- Roadside-generated orders

This forced:

- parsing `orderCode` to detect RS
- passing `expected=` via query params
- fallback recompute logic
- mixed assumptions inside one screen

### New situation (clean)

We split by **business meaning**, not UI convenience.

| Cashier Route       | Responsibility              |
| ------------------- | --------------------------- |
| Delivery remit      | Parent delivery orders only |
| Roadside collection | Roadside (RS) orders only   |

Each route:

- reads ONE source of truth
- never guesses
- never recomputes

---

## What Changed Technically (High Level)

### `cashier.delivery.$runId.tsx`

- Becomes **Parent Delivery Remit Hub**
- Shows:
  - delivery orders only
  - run-level summary
- Links out to:
  - Roadside collection page

### New: Roadside cashier route

- Lists RS orders for the run
- Expected cash = `RunReceipt.cashCollected`
- Payment = money-only
- No pricing logic inside cashier

---

## What We Gained

✔ No “nawala ang discount”  
✔ No double-freeze  
✔ No query-param dependency  
✔ No recompute confusion  
✔ Audit-safe (BIR / AR / rider variance)  
✔ Clear mental model even after months

---

## One Rule to Remember Forever

> **If it started as an Order → read `OrderItem`.**  
> **If it started in a Run → read `RunReceipt`.**

If you follow this:

- the system stays sane
- bugs stay localized
- future features stay easier

---

## Why This Doc Exists

This is not overengineering.

This is a **guardrail** so future changes don’t accidentally:

- reintroduce recompute
- merge concepts again
- or break audit consistency

If you’re reading this in the future:
👉 **Trust this split. It was paid for by pain.**
