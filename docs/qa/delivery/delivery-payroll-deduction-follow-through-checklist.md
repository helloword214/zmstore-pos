# Delivery Payroll Deduction Follow-Through Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

This checklist is a secondary QA artifact.
It does not own delivery shortage behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `docs/guide/CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md`
4. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`

## Purpose

Verify the real payment-posting follow-through for a `CHARGE_RIDER` delivery shortage, where the open rider charge is settled through payroll deduction in `/store/payroll`.

## Setup

1. Run `npm run qa:delivery:payroll-deduction-follow-through:setup`.
2. Copy the printed payroll route, rider charge ref, cutoff, pay date, draft note, employee label, expected deduction amount, and deduction note from the console output.
3. Keep this scenario limited to the payroll-deduction lane only.

## Browser QA Steps

1. Run `npm run ui:test:delivery:payroll-deduction-follow-through`.
2. The browser scenario stops after the payroll run remains in `DRAFT` with the rider charge fully deducted and the deduction review section cleared.

## Expected Scenario Shape

The setup creates:

1. one deterministic settled delivery run with a closed `CHARGE_RIDER` variance chain
2. one linked `RiderCharge(status = OPEN)` tagged for payroll deduction
3. one payroll-ready attendance slice for the same rider employee
4. one manager browser storage state using the app auth layer

The browser flow should:

1. open `/store/payroll` as `STORE_MANAGER`
2. create a payroll draft using the printed cutoff and draft note
3. rebuild payroll lines
4. open the seeded rider employee line
5. confirm the open payroll-tagged rider charge appears in `Deduction review`
6. submit `Apply full remaining balance` with the printed deduction note

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed payroll route.
3. Create a draft using the printed period start, period end, pay date, and draft note.
4. Click `Rebuild payroll lines`.
5. Open the printed rider employee line.
6. Confirm the deduction review card shows the printed rider charge amount.
7. Enter the printed full-deduction note.
8. Click `Apply full remaining balance`.
9. Confirm the success alert says `Payroll deduction posted to the charge ledgers.`
10. Confirm the same rider now shows `No open payroll-tagged charges for this employee.`

## Expected Outcomes

1. one `RiderChargePayment(method = PAYROLL_DEDUCTION)` is created for the full remaining balance
2. the same `RiderCharge` moves from `OPEN` to `SETTLED`
3. `settledAt` is set on the rider charge
4. the payroll run line records the charge deduction amount without duplicating payment rows
5. the original delivery run, variance, and rider charge linkage remain intact

## Cleanup

1. Run `npm run qa:delivery:payroll-deduction-follow-through:cleanup`.
2. Confirm the tagged payroll runs, tagged attendance rows, tagged profile rows, deterministic delivery artifacts, and manager storage-state file were removed.
