# Pricing Source of Truth – Architecture Rule

## Goal

Make the **database the single source of truth (DB SoT)** for pricing so that:

- Old-price bugs disappear
- Discounts are consistent across PAD, Rider, Cashier, and Manager
- No route recomputes or infers prices differently

Once an order is created, **pricing is frozen** and must never change implicitly.

---

## Core Principle

> **Freeze pricing ONCE at order creation.  
> After that, every downstream flow only READS frozen values.**

No recomputation.  
No inference from current product prices.  
No guessing based on unitPrice.

---

## Where Pricing Is Frozen

### ✅ Order Creation (`orders.new.tsx`)

This is the **only freeze point** for POS / Walk-in / PAD orders.

At creation time, the system MUST persist the following per line:

### OrderItem (line-level)

Always store:

- `unitKind` (PACK | RETAIL)
- `baseUnitPrice` (SRP / base price used for discount reference)
- `unitPrice` (effective / payable price)
- `discountAmount` (baseUnitPrice - unitPrice)
- `lineTotal` (qty × unitPrice)

### Order (header-level)

Always store:

- `totalBeforeDiscount`
- `subtotal`

### Invariants

Before saving:

- Recompute totals server-side
- Ensure totals match line sums
- Reject order if mismatch (force refresh)

After save → **pricing is FINAL**.

---

## Downstream Rules (After Order Creation)

### Rider Check-in

- **Parent Orders**

  - Display payable totals using **frozen `OrderItem.lineTotal`**
  - Show discounts using `baseUnitPrice` + `discountAmount`
  - NEVER reprice parent orders here

- **RunReceipt (PARENT)**
  - Snapshot prices from frozen order items
  - Do NOT use live product prices
  - Do NOT infer unitKind from price

### Cashier

- Payable totals MUST come from:
  - `OrderItem.lineTotal`
- Discount display MUST come from:
  - `discountAmount` + `baseUnitPrice`
- Cashier must never:
  - Recompute `qty × product.price`
  - Use current SRP/price from Product table

### Manager Remit / Stock Posting

- Stock movements use:
  - `unitKind`
  - `qty`
- Pricing is **read-only** at this stage
- No repricing allowed

---

## What Is Explicitly Forbidden

❌ Recomputing prices after order creation  
❌ Using `product.price` or `product.srp` for existing orders  
❌ Inferring `unitKind` by comparing unitPrice to base price  
❌ Applying discounts outside the pricing engine

---

## Allowed Exception

### Roadside / Quick Sale

- Separate flow
- PACK only
- Pricing may be computed at sale time
- Must still freeze into RunReceipt lines when saved

(Out of scope for this document)

---

## Why This Design Works

### Pros

- Eliminates old-price bugs
- Prevents double-freeze issues
- Makes audit trails clear
- Simplifies cashier and rider logic
- DB is always authoritative

### Cons (Accepted Trade-offs)

- Cannot retroactively change price rules
- Repricing requires explicit reprice flow (future feature)

---

## Mental Model

Product Prices + Rules
↓
Order Creation (FREEZE)
↓
OrderItem snapshot (DB)
↓
Rider → Cashier → Manager
(read-only pricing)

## TL;DR Rule

> **If an Order exists, its prices are immutable.  
> Everyone reads from the DB snapshot.**
