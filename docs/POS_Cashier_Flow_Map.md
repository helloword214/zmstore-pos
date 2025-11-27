# Cashier Money Flow – Implementation Map

Legend:

- [ ] = hindi pa nagagawa
- [x] = tapos na
- [>] = optional / next phase

---

## 0. Core shift infra

- [x] Prisma models:
  - `CashierShift` may `openingFloat`, `closingTotal`, `branchId`
  - `Payment` may `shiftId`, `cashierId`
  - `CashDrawerTxn` naka-link sa `CashierShift`
- [x] Auth helpers:
  - `getUser`, `requireRole`
  - `requireOpenShift` (with shiftId validation)
  - `setShiftId`
  - `openCashierShift`, `closeCashierShift`
- [>] Optional later:
  - Refactor `/cashier/shift` action to gumamit ng `openCashierShift` / `closeCashierShift` helpers instead of direct `db.cashierShift.create/update`.

---

## 1. “Seatbelt” – lahat ng pera dumadaan sa `requireOpenShift`

**Goal:** Kahit anong money-in/out, hindi pwede kung walang bukas na shift.

### 1.1 Walk-in / POS cashier

- [ ] Main cashier route (POS)
  - Loader: gumamit ng `requireOpenShift(request)`
  - Action: gumamit din ng `requireOpenShift(request)` bago mag-create ng `Order`/`Payment`.

### 1.2 Accounts Receivable (AR)

- [x] `ar._index.tsx`
  - Loader: gumagamit na ng `requireRole(["CASHIER", "ADMIN"])` (list view lang)
- [ ] `ar.customers.$id.tsx`
  - Loader: palitan to use `requireOpenShift` **(para sure naka-open shift ang nagrerecord ng payment)**.
  - Action (`recordPayment`): palitan to use `requireOpenShift` (kailangan natin si `me.shiftId` at `me.userId` dito).

### 1.3 Rider Remit

- [ ] Remit main page loader
  - Use `requireOpenShift(request)` (cashier ang tatanggap ng remit).
- [ ] Remit action (kung saan ginagawa ang remit logic)
  - Use `requireOpenShift(request)` bago gumawa ng anumang `Payment` o `CashDrawerTxn`.

### 1.4 Pure Delivery Run Sales (no parent order)

- [ ] Kung meron kang route para mag-encode ng **adhoc sales** from `DeliveryRun` (galing sa `RunAdhocSale`):
  - Loader: `requireOpenShift`
  - Action: `requireOpenShift` bago gumawa ng ad-hoc `Order` + `Payment`.

---

## 2. Tagging – lahat ng `Payment.create()` may `shiftId` + `cashierId`

**Goal:** Any pera na pumasok, alam natin _anong shift_ at _sinong cashier_.

### 2.1 Walk-in POS

- [ ] Sa POS `action` kung saan ka nagse-`db.payment.create`:
  - Idagdag:
    - `shiftId: me.shiftId`
    - `cashierId: me.userId`

### 2.2 AR – Customer Ledger

File: `ar.customers.$id.tsx`

- [ ] Sa loob ng transaction:

  ```ts
  await tx.payment.create({
    data: {
      orderId: ...,
      method,
      amount: apply,
      refNo,
      // TODO:
      // shiftId: me.shiftId,
      // cashierId: me.userId,
    },
  });
  ```

  I-wire si me galing requireOpenShift sa action.

  2.3 Rider Remit

Sa lahat ng db.payment.create sa remit route:

Lagyan din ng:

shiftId: me.shiftId

cashierId: me.userId

2.4 Pure Run Adhoc Sales

Kapag gumawa ka ng Payment para sa adhoc sales (galing RunAdhocSale → converted to Order):

Same tagging:

shiftId

cashierId

3. Cash Drawer consistency

Goal: Lahat ng galaw sa drawer may trace: sales-in, manual deposit/out, drop, remit, etc.

CashDrawerTxn model + relation sa CashierShift.

/cashier/shift loader:

groupBy ng CashDrawerTxn per shift

compute:

deposits = CASH_IN

withdrawals = CASH_OUT + DROP

balance = openingFloat + cashDrawerIn + deposits - withdrawals

Fix UI ng Deposit / Withdraw section

Overlapping buttons / hindi malinaw kung saan ikiclick

Goal: klaro ang 2 forms:

"Deposit" (CASH_IN)

"Withdraw" (CASH_OUT)

Design decision (future):

Rider remit: gagawin mo bang:

a) Payment lang (no drawer txn), tapos physical cash assumed na nasa drawer, or

b) Payment + CashDrawerTxn.CASH_IN entry para kita na “pumasok galing remit”.

4. Cashier views / dashboard

Goal: Cashier may sariling world; hindi na siya naliligaw sa buong system.

4.1 Shift console (/cashier/shift)

Shows:

Active shift info (id, branch, device, openedAt, openingFloat)

Running totals (grandAmount, cashDrawerIn by method)

Cash drawer snapshot (deposits/withdrawals/balance)

Recent drawer txns

Recent payments (this shift)

Add link:

“View all shifts” → /cashier/shifts

4.2 Shift list (/cashier/shifts)

List per shift:

paymentsCount, sum amount, tendered, change

Drawer deposits/out/drop

Drawer balance

Opening float

Closing total

4.3 Cashier home (/cashier)

Gumawa ng simple dashboard page:

Card: “New Sale (Walk-In)” → link sa POS

Card: “Collect Payment on AR” → /ar

Card: “Rider Remit” → remit route

Card: “Shift Console” → /cashier/shift

Small summary:

“Today collected: ₱…”

“Active shift #… at Branch …”

5. AR flow sanity check

Goal: AR side consistent sa cashier world.

ar.\_index.tsx

Shows per-customer AR balance using pricing rules.

ar.customers.$id.tsx ledger:

Recalculates balance based on orders + payments (with discount rules).

i-wire sa cashier system:

Action uses requireOpenShift

Payments tagged with shiftId + cashierId

[>] Optional enhancement:

AR list (ar.\_index.tsx): add “Last payment at [date] via [method]”.

6. Delivery runs / remit integration

Goal: Lahat ng pera mula sa delivery world, dumapo pa rin sa cashier shift.

I-document sa notes mo ang actual remit steps (manual picture lang muna):

Rider brings cash + list (parent orders + adhoc).

Cashier:

Confirms totals

Encodes remit

Records payments / adjustments.

Sa remit action:

For each collected amount:

Ensure may Payment row (shift-tagged).

For adhoc/pure run sales:

Decide pattern (later):

RunAdhocSale → create Order per sale, or grouped per remit.

Then create Payments pointing to those orders (shift-tagged).

7. Future cleanups / refinements

[>] Gawing consistent language sa UI:

“Cash drawer in”, “Manual deposit”, “Manual withdraw”, etc.

[>] Add simple audit views:

List payments per shift (detail view / modal from /cashier/shifts table row).

[>] Add permission nuances:

Only ADMIN can adjust (CashDrawerTxnType.ADJUST).

Cashiers limited to CASH_IN / CASH_OUT / DROP.
