# SHIFT FLOW IMPLEMENTATION PLAN (Manager-open shift)

## Source of Truth (SoT)
- Shift truth = `CashierShift` row in DB + cookie `shiftId`.
- Cashier routes that move money MUST call `requireOpenShift(request)`.
- Cash drawer truth = CASH tendered - change + drawer txns (deposit/withdraw/drop).
- AR settlement truth = CASH + INTERNAL_CREDIT only if `refNo` is RIDER_SHORTAGE bridge.
- Delivery remit totals truth = frozen `lineTotal` only (RunReceiptLine first, else OrderItem).

---

## Step 0 — Inventory of current guards
Search in repo:
- `requireActiveShift(` and `getActiveShiftIdOrNull(`
- imports: `from "~/utils/shift.server"`

Goal:
- list which routes still use Option B helper.

---

## Step 1 — Keep compatibility shim (Option B) temporarily
- Update `app/utils/shift.server.ts` to delegate to:
  - `requireOpenShift`
  - `getActiveShift`
  - `setShiftId`
- Do NOT change behavior of working pages yet.

Exit criteria:
- build passes, no runtime error.

---

## Step 2 — Enforce "Manager opens shift" policy
Policy:
- Cashier cannot create shift row.
- Cashier can only "resume" an already-open shift row.

Implementation checks:
- `/cashier/shift` route:
  - `_action=open` returns 403 unless existing open shift exists (resume only)
  - loader recovers shift if session lost (reattach cookie)

Exit criteria:
- Cashier without open shift sees "No active shift"
- Manager opens shift elsewhere; cashier reload → auto reattach

---

## Step 3 — Dashboard gating (cashier._index.tsx)
Rules:
- `Charges` page is always accessible (no shift required).
- POS / AR / Delivery Remit require shift:
  - link uses `guardLink("/path")` → bounces to `/cashier/shift?open=1&next=...`

Exit criteria:
- click any action without shift → goes to shift page with next param.
- with shift → direct.

---

## Step 4 — Route-level hard guards (server side)
For every money-affecting route, ensure loader/action uses:
- `requireOpenShift(request)` (strict)
Examples:
- Walk-in POS checkout action
- Delivery remit action (`delivery-remit.$id.tsx`) ✅ already uses
- AR record payment action ✅ already uses
- Any cash drawer txn routes ✅ already uses

Exit criteria:
- cannot post payment without shift even if user manually hits URL.

---

## Step 5 — Remove Option B helper usage (migration)
Replace imports:
- `requireActiveShift` → `requireOpenShift` + `getActiveShift` where needed
- `getActiveShiftIdOrNull` → `getActiveShift(request)?.id ?? null` (or keep helper in auth)

Exit criteria:
- `grep "~/utils/shift.server"` returns zero results.

---

## Step 6 — Delete `app/utils/shift.server.ts`
Once no references:
- remove file

Exit criteria:
- build passes, no missing imports.

---

## Smoke Tests (must pass)
1) Cashier login, no shift:
   - dashboard shows "No active shift"
   - POS/AR/Delivery buttons bounce to shift page
2) Manager opens shift:
   - cashier reload dashboard → shows shift open
   - POS payment posts payment with shiftId
3) Delivery remit:
   - totals read-only, uses frozen lines
   - shortage creates INTERNAL_CREDIT bridge + variance
4) AR ledger:
   - shows settlement including rider-shortage bridge
   - record payment applies FIFO if no orderId
5) Shift console:
   - deposits/withdraw blocked after count submitted
   - withdraw cannot exceed expected drawer cash
