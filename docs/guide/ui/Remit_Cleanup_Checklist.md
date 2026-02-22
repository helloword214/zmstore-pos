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

- Treat the page as **Manager verification review**
- Clearly show:
  - Loaded vs Sold vs Unsold
  - Cash vs Credit per receipt / order
- For each `unsold > 0` product, provide explicit manager choice:
  - `Stocks Present`
  - `Mark Missing`
- Show reminder/preview for all rows marked `Mark Missing` with collectible amount
- Show discount badges only if:
  - `baseUnitPrice` and `discountAmount` exist
- Disable “Approve Remit” if:
  - Any unsold row is marked `Mark Missing`
  - Run status is not `CHECKED_IN`

### MUST NOT DO

- ❌ Allow editing qty or prices
- ❌ Allow discount editing
- ❌ Allow changing customer or payment mode
- ❌ Auto-charge rider without explicit `Mark Missing` manager choice

---

## 3️⃣ Remit Action – Guards (Before Posting)

### MUST DO

- Verify run status is `CHECKED_IN`
- Recompute stock recap using **loadRunRecap**
- Compute `unsold = loaded - sold`
- Parse manager stock decisions from submit payload:
  - `Stocks Present` rows
  - `Mark Missing` rows
- Validate credit rules:
  - Credit or partial payment requires customer
- Use **RunReceipt as the only input** for roadside sales
- If normal approve intent:
  - reject when any row is `Mark Missing`
- If charge intent:
  - require at least one `Mark Missing` row
  - require valuation source for each missing row

### MUST NOT DO

- ❌ Recompute prices
- ❌ Pull live product pricing
- ❌ Trust client-side totals
- ❌ Allow charge intent with zero-value shortage

---

## 3.5️⃣ Missing Stock Charge Linkage Rules

### MUST DO

- Value missing stocks using frozen-first SoT priority:
  - `RunReceiptLine.unitPrice` (ROAD)
  - `OrderItem.unitPrice` (PARENT)
  - `Product.srp` fallback
  - `Product.price` fallback (last resort)
- On **Charge Rider (Missing Stocks) & Close Run**:
  - Create `RiderRunVariance` with:
    - `status = MANAGER_APPROVED`
    - `resolution = CHARGE_RIDER`
    - negative `variance`
  - Create or upsert linked `RiderCharge(status = OPEN)` using `varianceId`
- Keep detailed audit note per missing product (qty, unit value source, amount)

### MUST NOT DO

- ❌ Mix missing-stock charge into customer A/R
- ❌ Skip rider acceptance path for charged shortages

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
- only for rows manager marked as `Stocks Present`
- Ensure idempotency:
- Do not post returns twice

### MUST NOT DO

- ❌ Infer stock from leftovers
- ❌ Recompute sold quantities manually
- ❌ Post stock before remit approval
- ❌ Return to stock rows marked as `Mark Missing`

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
