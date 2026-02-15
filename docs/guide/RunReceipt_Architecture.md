# RunReceipt Architecture – Draft vs Posted Sales

## Purpose

This document explains **what `RunReceipt` is**, **why it exists**, and **how it relates to Orders**, especially for developers working on:

- Rider Check-in
- Delivery Runs
- Remit / Manager Approval
- Cash & A/R tracking

The goal is to avoid:

- pricing recomputation bugs
- double counting of sales
- confusion between _orders_, _collections_, and _runs_

---

## Core Principle (TL;DR)

> **RunReceipt is a frozen, per-run draft record.  
> Orders are the official, posted records.**

---

## What is a RunReceipt?

**RunReceipt** is a **run-scoped snapshot** of what happened during a delivery run.

It is:

- frozen at creation
- editable only before the run is `CLOSED`
- used for review, validation, and approval

It is **NOT** an official Order.

---

## Types of RunReceipt

### 1️⃣ RunReceipt(kind = "ROAD")

**Represents:**  
Sales created _on the road_ by the rider (walk-in / roadside customers).

**Characteristics:**

- No Order exists yet
- Pricing is frozen at `RunReceiptLine` level
- Can be reverted or edited before remit
- Becomes an **Order** only at remit approval

**Lifecycle:**

Rider Check-in
↓
RunReceipt (ROAD)
↓ approve remit
Order (RS-RUN{id}-RR{receiptId})
↓
Run CLOSED

**Source of Truth:**

- Before `CLOSED` → RunReceipt
- After `CLOSED` → Order (RS-\* orders)

---

### 2️⃣ RunReceipt(kind = "PARENT")

**Represents:**  
Cash collection **during this run** for an **already existing parent Order**
(POS / Order Pad orders).

**Important distinction:**

- Parent Orders already exist
- Pricing is already frozen in `OrderItem`
- RunReceipt(PARENT) does **NOT** change pricing

**Purpose:**

- Track how much the rider actually collected
- Support partial payments
- Support credit (A/R)
- Provide an audit trail per run

---

## Why RunReceipt(PARENT) Exists

Orders answer:

> “How much does the customer owe?”

RunReceipts answer:

> “How much did the rider collect **in this run**?”

Without RunReceipt(PARENT):

- Rider cash on hand cannot be computed reliably
- Remit totals become ambiguous
- Partial collections across multiple runs break

---

## RunReceipt(PARENT) and Lines

`RunReceipt(PARENT)` may include `lines`, but:

> **These lines are READ-ONLY MIRRORS.**

They exist only for:

- UI display
- manager review
- audit evidence

**Source of truth remains:**

- Pricing → `OrderItem`
- Totals → `Order`

Never:

- recompute pricing from RunReceipt(PARENT)
- write pricing back to Order from RunReceipt

---

## Source of Truth by Stage

### Before Run is CLOSED

| Data                   | Source of Truth    |
| ---------------------- | ------------------ |
| Roadside sales         | RunReceipt(ROAD)   |
| Parent order pricing   | Order / OrderItem  |
| Parent cash collection | RunReceipt(PARENT) |
| Rider cash on hand     | RunReceipt         |

---

### After Run is CLOSED

| Data                  | Source of Truth        |
| --------------------- | ---------------------- |
| Roadside posted sales | Order (RS-\*)          |
| Parent order pricing  | Order / OrderItem      |
| Collections (audit)   | RunReceipt (read-only) |
| Stock movements       | StockMovement          |

---

## Key Invariants

- RunReceipt pricing is **frozen**
- Orders are **immutable after creation**
- No pricing engine runs after order creation
- RunReceipt is never the pricing authority for parent orders
- Orders are never edited from RunReceipt

---

## Mental Model (for developers)

- **RunReceipt = draft notebook**
- **Order = official ledger**
- **StockMovement = physical truth**

---

## Common Pitfalls (DO NOT DO)

- Recompute prices in remit
- Use `Product.price` for existing orders
- Treat RunReceipt(PARENT) as an order
- Double-count RS-\* orders in recap
- Modify RunReceipt after run is CLOSED

---

## Why This Architecture Works

- Eliminates old-price bugs
- Makes remit deterministic
- Supports partial payments cleanly
- Allows safe revert before approval
- Preserves a clear audit trail

---

## One-Sentence Rule

> **RunReceipt records what happened in a run.  
> Orders record what the business officially sold.**
