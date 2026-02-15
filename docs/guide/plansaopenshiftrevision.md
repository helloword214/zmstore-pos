# Cashier Shift + Payments Hardening Plan (SoT + Guards)

> Goal: One consistent rule-set so CASH posting is audit-safe, shift-safe, and SoT-safe across:
>
> - Walk-in POS
> - Delivery Remit (rider collection)
> - AR collections
> - Cash drawer deposits/withdrawals
> - Shift count submission + manager close

---

## 0) Definitions (non-negotiable)

### 0.1 Shift states

- **NO_SHIFT**: no active open shift for cashier
- **SHIFT_OPEN_WRITABLE**: open shift exists AND `closingTotal == null`
- **SHIFT_LOCKED_COUNT_SUBMITTED**: open shift exists BUT `closingTotal != null`
  - meaning cashier already submitted counted cash, waiting manager audit/close
- **SHIFT_CLOSED**: closedAt != null (should not appear as active)

### 0.2 Write operations (must be shift-guarded)

Anything that creates money effects:

- `Payment.create` (CASH, INTERNAL_CREDIT bridge, etc.)
- `CashDrawerTxn.create` (deposit/withdraw/drop)
- anything that changes order status to PAID/PARTIALLY_PAID during cashier flows

### 0.3 Read operations (may be allowed without shift)

- Viewing pages, listing items
- Charges acknowledgement page (manager-charged variances)
- Shift history page
  But: any route that locks rows (e.g. delivery-remit loader that writes lock) is **not read-only** and should behave like a guarded action.

---

## 1) Create one shared helper: `assertActiveShiftWritable()`

### 1.1 File

- `app/utils/shiftGuards.server.ts` (new)

### 1.2 Responsibilities

- Ensure cashier has an active open shift in DB (not just cookie)
- Ensure shift belongs to cashier (unless ADMIN)
- Ensure shift is **writable** (`closingTotal == null`)
- Return `{ shiftId }` for use in writes

### 1.3 Behavior

- If NO_SHIFT → redirect to `/cashier/shift?open=1&next=...`
- If LOCKED (closingTotal != null) → redirect to `/cashier/shift?next=...&locked=1`
- If CLOSED/stale session → clear session shiftId then redirect to open flow

### 1.4 Use this helper in:

- Walk-in POS settle action
- Delivery remit action
- AR record payment action
- Any route that posts cash drawer txns (already guarded, but unify)

---

## 2) Fix “Dashboard Guard” to reflect LOCKED shift (UX)

### 2.1 Update cashier dashboard loader payload

- `activeShift` should include `closingTotal` (already included)

### 2.2 Add derived booleans

- `hasShift = !!activeShift`
- `shiftWritable = hasShift && activeShift.closingTotal == null`

### 2.3 Update `guardLink()`

- If `!hasShift` → `/cashier/shift?open=1&next=...`
- If `hasShift && !shiftWritable` → `/cashier/shift?next=...&locked=1`
- Else normal link

### 2.4 UI badges

- No shift → red badge
- Shift open → green badge
- Shift locked → amber badge “COUNT SUBMITTED / WAIT MANAGER CLOSE”

---

## 3) Delivery Remit (`delivery-remit.$id.tsx`) hardening

### 3.1 Loader side-effect check

Your loader currently updates:

- `order.lockedAt/lockedBy` in loader ✅ (this is a write)

**Action:**

- Before locking, require shift exists (and ideally writable).
- If shift is locked (count submitted), cashier should not be remitting more orders.

**Decision:**

- For simplicity + audit safety:
  - Loader requires **SHIFT_OPEN_WRITABLE**.
  - If not, redirect to shift console with next back to remit.

### 3.2 Action guard

At the top of action:

- Call `assertActiveShiftWritable(request, nextUrl)`

### 3.3 Payment write

Ensure every `Payment.create` for remit has:

- `shiftId` set (from helper)
- `cashierId` set (already)
- method rules unchanged:
  - CASH = drawer truth
  - INTERNAL_CREDIT (RIDER-SHORTAGE) = bridge truth (AR settlement but not drawer)

### 3.4 Idempotency

Keep:

- `sumCashPayments`
- `sumShortageBridgePayments`
- receiptId-based upsert to `riderRunVariance`
  Add:
- Ensure shortage bridge never posts if shift locked

---

## 4) AR Customer Ledger hardening

### 4.1 Loader: keep as-is (read-only)

Loader can show ledger even without shift (optional)
But your dashboard currently requires shift for AR access.
Pick one:

- **Option A (strict):** require shift to view AR
- **Option B (lenient):** allow view AR without shift, but require shift for `recordPayment`

Recommendation:

- **Option B** (better operations): allow viewing customer balances anytime; only require shift for posting payments.

### 4.2 Action: `recordPayment` must require SHIFT_OPEN_WRITABLE

Add guard at start of action:

- `const { shiftId } = await assertActiveShiftWritable(...)`

Then ensure `Payment.create` uses:

- `shiftId: shiftId`

### 4.3 Ensure AR settlement truth remains:

- CASH always counts
- INTERNAL_CREDIT counts only if rider-shortage ref

No changes required to SoT math; just enforce shift-writable before writing.

---

## 5) Walk-in POS hardening (cash settle action)

### 5.1 Identify POS settle route(s)

Find routes that do:

- create order
- take payment
- mark paid
- print receipt

### 5.2 Apply same guard

At the start of any action that does `Payment.create`:

- `assertActiveShiftWritable`

### 5.3 Ensure Payment fields

- `shiftId` must be populated
- `tendered/change` correctly computed
- avoid partial posts after count submitted

---

## 6) Cash Drawer hardening (Shift Console)

You already have:

- deposit/withdraw: checks shift open + belongs to cashier
- locks once `closingTotal != null`
  ✅ Good.

### 6.1 Unify with helper (optional)

Replace local checks with:

- `assertActiveShiftWritable` for deposit/withdraw
- For “submit count”, allow when shift open (even if writable), and after submit shift becomes locked

### 6.2 Locked UX

If `?locked=1` show:

- “Count already submitted. Manager must close/audit.”

---

## 7) Standardize “next” handling and redirects

### 7.1 Safe internal next

Keep your `safeNext()` helper.

### 7.2 Default next targets

- Cashier dashboard: `/cashier`
- Delivery console: `/cashier/delivery`
- AR: `/ar`
- POS: `/cashier/pos`

### 7.3 Consistent redirect rules

- NO_SHIFT → `/cashier/shift?open=1&next=...`
- SHIFT_LOCKED → `/cashier/shift?next=...&locked=1`

---

## 8) Add a test checklist (manual smoke tests)

### 8.1 Shift gating

1. Login cashier with **no shift**
2. Click POS → must go to shift page (open=1)
3. Click AR → must go to shift page (open=1) _if strict_ or allow view _if lenient_
4. Click Delivery Remit → must go to shift page (open=1)

### 8.2 Locked shift gating

1. Open shift
2. Submit count (closingTotal set)
3. Try POS settle → must block
4. Try AR recordPayment → must block
5. Try Delivery remit action → must block
6. Charges page → must still be accessible

### 8.3 Delivery remit flow

1. Manager check-in freeze totals
2. Rider collects cash
3. Cashier posts remit exact amount → PAID, CASH payment recorded, shiftId set
4. Cashier posts remit short → CASH + INTERNAL_CREDIT bridge created, variance created, shiftId set

### 8.4 AR FIFO

1. Customer has 2 open orders
2. Record payment without orderId → applies FIFO
3. Overpay → change computed and not applied

---

## 9) Implementation order (do this sequence)

1. **Create `shiftGuards.server.ts`** with `assertActiveShiftWritable()`
2. **Update cashier dashboard** to handle LOCKED shift (UX + guardLink)
3. **Patch Delivery Remit**
   - loader guard (since it writes locks)
   - action guard (shift writable)
4. **Patch AR recordPayment action**
   - shift writable guard
   - force shiftId usage
5. **Patch Walk-in POS settle action(s)**
   - shift writable guard
   - force shiftId usage
6. Run smoke tests checklist

---

## 10) Notes / Decisions we must keep consistent

- Cash drawer truth is **CASH tendered - change**
- Rider-shortage bridge is **INTERNAL_CREDIT** (settles customer ledger but not drawer)
- Any write after `closingTotal != null` is a **hard NO**
- Server-side guards are required even if UI guard exists

---
