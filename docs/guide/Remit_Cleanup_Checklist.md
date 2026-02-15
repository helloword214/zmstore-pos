# Remit Cleanup Checklist

This checklist defines what the **Run Remit page and action** MUST and MUST NOT do,
based on the RunReceipt architecture and pricing source-of-truth rules.

Use this as a guardrail when refactoring or reviewing remit-related code.

---

## 1️⃣ Remit Page – Loader Rules

### MUST DO

- Load **RunReceipt(kind = "ROAD")** for roadside sales display
- Load **RunReceipt(kind = "PARENT")** for parent order collections
- Load **parent Orders** only for:
  - order metadata (customer, orderId)
  - pricing display (read-only)
- Display pricing using **frozen snapshot fields only**:
  - `unitPrice`
  - `lineTotal`
  - `baseUnitPrice`
  - `discountAmount`
- Display totals using:
  - `SUM(lineTotal)`
- Use **runReceipt.cashCollected** as the only source for:
  - rider cash
  - remit cash totals
  - A/R calculation

### MUST NOT DO

- ❌ Recompute pricing using pricing rules
- ❌ Use `Product.price` or `Product.srp` for existing orders
- ❌ Infer unitKind from unitPrice
- ❌ Mutate any pricing data in loader
- ❌ Create or update Orders in the loader

---

## 2️⃣ Remit Page – UI Rules

### MUST DO

- Treat the page as **READ-ONLY REVIEW**
- Clearly show:
  - Loaded vs Sold vs Returned
  - Cash vs Credit per receipt / order
- Show discount badges only if:
  - `baseUnitPrice` and `discountAmount` exist
- Disable “Approve Remit” if:
  - Stock recap mismatch exists
  - Run status is not `CHECKED_IN`

### MUST NOT DO

- ❌ Allow editing qty or prices
- ❌ Allow discount editing
- ❌ Allow changing customer or payment mode
- ❌ Hide mismatches or auto-correct silently

---

## 3️⃣ Remit Action – Guards (Before Posting)

### MUST DO

- Verify run status is `CHECKED_IN`
- Recompute stock recap using **loadRunRecap**
- Reject post if:
  - `Loaded ≠ Sold + Returned`
- Validate credit rules:
  - Credit or partial payment requires customer
- Use **RunReceipt as the only input** for roadside sales

### MUST NOT DO

- ❌ Recompute prices
- ❌ Pull live product pricing
- ❌ Trust client-side totals
- ❌ Post remit if recap mismatch exists

---

## 4️⃣ Remit Action – Roadside Order Creation

### MUST DO

- Create **ONE Order per RunReceipt(kind = "ROAD")**
- Use deterministic orderCode:

RS-RUN{runId}-RR{runReceiptId}

- Use **only frozen snapshot fields**:
- qty
- unitPrice
- lineTotal
- baseUnitPrice
- discountAmount
- Set pricing audit fields:
- `pricePolicy = "FROZEN:RUN_RECEIPT_LINE"`
- Ensure idempotency:
- Skip if orderCode already exists

### MUST NOT DO

- ❌ Apply pricing rules
- ❌ Modify unitPrice or discounts
- ❌ Merge multiple receipts into one order
- ❌ Create orders without receipt traceability

---

## 5️⃣ Remit Action – Parent Orders

### MUST DO

- Treat parent Orders as **already posted**
- Use **RunReceipt(kind = "PARENT")** for:
- cash collected
- A/R determination
- NEVER modify parent order pricing
- NEVER create new Orders for parent receipts

### MUST NOT DO

- ❌ Duplicate parent orders
- ❌ Change parent order totals
- ❌ Post stock movements for parent orders

---

## 6️⃣ Stock Posting Rules

### MUST DO

- Post `RETURN_IN` stock movements only:
- after remit approval
- using recap service as source of truth
- Ensure idempotency:
- Do not post returns twice

### MUST NOT DO

- ❌ Infer stock from leftovers
- ❌ Recompute sold quantities manually
- ❌ Post stock before remit approval

---

## 7️⃣ After Run is CLOSED

### MUST DO

- Treat Orders as official sales records
- Treat RunReceipt as frozen audit data
- Prevent any edits to:
- RunReceipt
- Orders
- Stock movements

### MUST NOT DO

- ❌ Re-open pricing
- ❌ Edit receipts
- ❌ Re-run remit logic

---

## 8️⃣ Debug & Audit Expectations

Every roadside Order MUST be traceable to:

- `originRunReceiptId`
- deterministic `orderCode`

Every remit decision MUST be reproducible from:

- RunReceipt
- Order
- StockMovement

---

## Final Rule

> **Remit does not decide prices.  
> Remit only decides when data becomes official.**
