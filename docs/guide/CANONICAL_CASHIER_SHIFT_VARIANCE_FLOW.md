# Canonical Cashier Shift Close + Variance Flow

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-20

## Purpose

Defines one route-level source of truth for cashier shift lifecycle, shift close counting, manager recount, manager final-close authority, and cashier variance-to-charge handling.

## Scope

1. Cash-in sources handled by cashier:
- Walk-in settlement (`cashier.$id.tsx`)
- Delivery remit collection from rider (`delivery-remit.$id.tsx`)
- Customer A/R partial/full collection (`ar.customers.$id.tsx`)
2. Shift open/submit/close lifecycle:
- Cashier shift console (`cashier.shift.tsx`)
- Manager shift panel (`store.cashier-shifts.tsx`)
3. Variance and charge handling:
- Manager recount decision capture during final close (`store.cashier-shifts.tsx`)
- Read-only variance queue/history (`store.cashier-variances.tsx`)
- Cashier charge acknowledgement (`cashier.charges.tsx`)
- Cashier AR/payroll tagging and settlement (`store.cashier-ar.tsx`, `store.payroll.tsx`)

## Shift State Machine (CashierShift.status)

Canonical statuses:

1. `PENDING_ACCEPT`
2. `OPEN`
3. `OPENING_DISPUTED`
4. `SUBMITTED`
5. `RECOUNT_REQUIRED` (legacy enum value)
6. `FINAL_CLOSED`

Current transition map (as implemented):

1. Manager open shift: new row defaults to `PENDING_ACCEPT`.
2. Cashier opening verification:
- `PENDING_ACCEPT -> OPEN` (accept)
- `PENDING_ACCEPT -> OPENING_DISPUTED` (dispute)
3. Manager resend opening verification:
- `OPENING_DISPUTED -> PENDING_ACCEPT`
4. Cashier submit counted cash (manual denomination count):
- `OPEN -> SUBMITTED`
5. Manager final close:
- `SUBMITTED -> FINAL_CLOSED`
6. Current routes do not actively transition to `RECOUNT_REQUIRED`; it remains a legacy status value for history compatibility.

## Route Responsibility Map

| Route file | Role | Responsibility |
| --- | --- | --- |
| `app/routes/cashier.shift.tsx` | Cashier | Opening verification, drawer txns, denomination-based count submit (`SUBMITTED`) |
| `app/routes/store.cashier-shifts.tsx` | Store Manager/Admin | Open shift, resend opening verification, manager recount + final close, decision capture, variance upsert, optional charge creation |
| `app/routes/cashier.$id.tsx` | Cashier | Walk-in collection posting |
| `app/routes/delivery-remit.$id.tsx` | Cashier | Delivery remit cash posting and rider-shortage bridge posting |
| `app/routes/ar.customers.$id.tsx` | Cashier | A/R payment posting against `customerAr` balances |
| `app/routes/store.cashier-variances.tsx` | Store Manager/Admin | Read-only variance queue/history (decision is not written here) |
| `app/routes/cashier.charges.tsx` | Cashier/Admin | View/acknowledge manager-charged cashier variance items |
| `app/routes/store.cashier-ar.tsx` | Store Manager/Admin | Cashier charge list and payroll-plan tagging |
| `app/routes/store.payroll.tsx` | Store Manager/Admin | Payroll deduction posting and charge/variance status sync |

## Cash Drawer and Posting SoT

### Drawer balance formula used by shift views

`expectedDrawer = openingFloat + cashInFromSales + deposits - withdrawals`

Where:

1. `cashInFromSales` comes from `Payment` rows (`method = CASH`) via `tendered - change`.
2. `deposits/withdrawals` come from `CashDrawerTxn` (`CASH_IN`, `CASH_OUT`, `DROP`).

### Collection route posting behavior

1. Walk-in (`cashier.$id.tsx`) posts to `Payment(method=CASH)` with `shiftId` and `cashierId`.
2. Delivery remit (`delivery-remit.$id.tsx`) posts:
- `Payment(method=CASH)` for actual cash drawer intake
- optional `Payment(method=INTERNAL_CREDIT)` bridge for rider shortage workflow
3. A/R (`ar.customers.$id.tsx`) posts to `CustomerArPayment` with `shiftId` and `cashierId` (not `Payment` table).

## Manager Final-Close Contract (As Implemented)

### Input and pre-close gates

1. Shift must exist and must not be closed yet.
2. Shift status must be `SUBMITTED`.
3. Cashier `closingTotal` must already exist.
4. `managerCounted` is required and must be a valid number (`>= 0`).

### Recount and variance math

1. `expectedDrawer` is recomputed from drawer SoT.
2. `variance = managerCounted - expectedDrawer`.
3. `short` means `variance < -EPS`.

### Resolution rules

1. Allowed explicit decisions: `CHARGE_CASHIER`, `INFO_ONLY`, `WAIVE`.
2. If short, manager decision is required before close.
3. If short, `paperRefNo` is required before close.
4. `CHARGE_CASHIER` is valid only for short variance.
5. For overage mismatch without selected decision, system defaults to `INFO_ONLY`.

### Persistence and outputs

1. Manager recount audit note is appended to `cashierShift.notes` (expected, cashier count, manager recount, variance, decision, paper ref, manager note).
2. If mismatch exists, system upserts one authoritative `CashierShiftVariance` by `shiftId`.
3. If decision is `CHARGE_CASHIER` and variance is short, system upserts `CashierCharge` by `varianceId` (idempotent linkage).
4. Shift is then finalized to `FINAL_CLOSED` with `closedAt` and `finalClosedById`.

## Variance and Charge Lifecycle (Current)

1. Cashier submits close count once in `cashier.shift.tsx`, and drawer writes become locked for cashier.
2. Manager recounts and decides in `store.cashier-shifts.tsx` during final close.
3. Manager can print an A4 recount form from `store.cashier-shifts.tsx`; UI can auto-generate paper reference number.
4. Variance rows are created/updated in final close when mismatch exists.
5. `store.cashier-variances.tsx` is a read-only queue/history of variance outcomes.
6. Charged items are acknowledged in `cashier.charges.tsx` and can be settled via payroll routes.

## Mandatory Controls (Current)

1. No manager final close without cashier submit gate (`SUBMITTED`) and manager recount input.
2. No short final close without manager decision and paper reference.
3. Final recount authority is manager-side at close time; no post-close back-and-forth path in shift routes.
4. Variance authority is manager-authored and auditable from final close note trail.
5. Cashier charge creation is limited to short variance with explicit `CHARGE_CASHIER` decision and is idempotent by `varianceId`.
