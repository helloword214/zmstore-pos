# Canonical Cashier Shift Close + Variance Flow

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-19

## Purpose

Defines one route-level source of truth for cashier shift lifecycle, shift close counting, manager close acceptance, and cashier variance-to-charge handling.

This document is implementation-facing and reflects current as-is behavior plus identified control gaps.

## Scope

1. Cash-in sources handled by cashier:
- Walk-in settlement (`cashier.$id.tsx`)
- Delivery remit collection from rider (`delivery-remit.$id.tsx`)
- Customer A/R partial/full collection (`ar.customers.$id.tsx`)
2. Shift open/submit/close lifecycle:
- Cashier shift console (`cashier.shift.tsx`)
- Manager shift panel (`store.cashier-shifts.tsx`)
3. Variance and charge handling:
- Manager variance decision (`store.cashier-variances.tsx`)
- Cashier charge acknowledgement (`cashier.charges.tsx`)
- Cashier AR/payroll tagging and settlement (`store.cashier-ar.tsx`, `store.payroll.tsx`)

## Shift State Machine (CashierShift.status)

Canonical statuses:

1. `PENDING_ACCEPT`
2. `OPEN`
3. `OPENING_DISPUTED`
4. `SUBMITTED`
5. `RECOUNT_REQUIRED`
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
- `RECOUNT_REQUIRED -> SUBMITTED`
5. Manager final close:
- `SUBMITTED -> FINAL_CLOSED`

## Route Responsibility Map

| Route file | Role | Responsibility |
| --- | --- | --- |
| `app/routes/cashier.shift.tsx` | Cashier | Opening verification, drawer txns, denomination-based count submit |
| `app/routes/store.cashier-shifts.tsx` | Store Manager/Admin | Open shift, resend opening verification, final-close submitted shift |
| `app/routes/cashier.$id.tsx` | Cashier | Walk-in collection posting |
| `app/routes/delivery-remit.$id.tsx` | Cashier | Delivery remit cash posting and rider-shortage bridge posting |
| `app/routes/ar.customers.$id.tsx` | Cashier | A/R payment posting against `customerAr` balances |
| `app/routes/store.cashier-variances.tsx` | Store Manager/Admin | Variance decision and optional cashier-charge creation |
| `app/routes/cashier.charges.tsx` | Cashier/Admin | View/acknowledge manager-charged cashier variance items |
| `app/routes/store.cashier-ar.tsx` | Store Manager/Admin | Cashier charge list and payroll-plan tagging |
| `app/routes/store.payroll.tsx` | Store Manager/Admin | Payroll deduction posting and charge/variance status sync |

## Cash Drawer and Posting SoT

### Drawer balance formula used by shift views

`expectedDrawer = openingFloat + cashInFromSales + deposits - withdrawals`

Where:

1. `cashInFromSales` comes from `Payment` rows (`method = CASH`) via tendered-change cash in.
2. `deposits/withdrawals` come from `CashDrawerTxn` (`CASH_IN`, `CASH_OUT`, `DROP`).

### Collection route posting behavior

1. Walk-in (`cashier.$id.tsx`) posts to `Payment(method=CASH)` with `shiftId` and `cashierId`.
2. Delivery remit (`delivery-remit.$id.tsx`) posts:
- `Payment(method=CASH)` for actual cash drawer intake
- optional `Payment(method=INTERNAL_CREDIT)` bridge for rider shortage workflow
3. A/R (`ar.customers.$id.tsx`) posts to `CustomerArPayment` with `shiftId` and `cashierId` (not `Payment` table).

## Variance and Charge Lifecycle (Current)

1. Cashier submits close count (`SUBMITTED`), then shift is locked on cashier side.
2. Manager final-closes submitted shift (`FINAL_CLOSED`).
3. Manager variance decision page (`store.cashier-variances.tsx`) supports:
- `CHARGE_CASHIER`
- `INFO_ONLY`
- `WAIVE`
4. If `CHARGE_CASHIER` and variance is short (negative), system upserts `CashierCharge` linked by `varianceId`.
5. Cashier can acknowledge charged variance item in `cashier.charges.tsx`.
6. Payroll deduction can settle cashier charges in `store.payroll.tsx`.

## Control Gaps (As-Is, for audit visibility)

1. Manager final close in `store.cashier-shifts.tsx` is currently status-gated (`SUBMITTED`) and does not perform an independent physical recount step.
2. No in-route automatic creation path for `CashierShiftVariance` was found in cashier shift close/final close routes.
3. `RECOUNT_REQUIRED` exists in schema and UI handling, but no active manager action path currently sets it in these shift routes.
4. Because of #2 and #3, charge workflow reliability depends on variance rows already existing from a separate creation path.

## Required Audit Rule (Target Behavior)

Policy target for hardening (implementation follow-up, not part of this docs-only update):

1. Every manager final-close decision must have an explicit manager recount outcome.
2. Every counted-vs-expected mismatch must create or update one authoritative `CashierShiftVariance(shiftId unique)`.
3. `RECOUNT_REQUIRED` must be actionable by manager when cashier count is disputed.
4. Cashier charge creation must remain idempotent and derived only from manager-approved short variance.
