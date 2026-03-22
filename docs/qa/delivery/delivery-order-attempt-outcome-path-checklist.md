# Delivery Order Attempt Outcome Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-22

## Purpose

Manual QA checklist for delivery parent-order no-release outcomes:

1. `NO_RELEASE_REATTEMPT`
2. `NO_RELEASE_CANCELLED`

Rule authority lives in:

1. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
2. `docs/guide/Commercial Clearance System V2`
3. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`

This checklist validates UI behavior only. It does not redefine flow rules.

## Scenario Family Commands

1. `npm run qa:delivery:order-attempt-outcome-path:setup`
2. perform the manual QA steps below, or run `npm run ui:test:delivery:order-attempt-outcome-path`
3. `npm run qa:delivery:order-attempt-outcome-path:cleanup`

The dedicated setup seeds:

1. one active delivery parent order on a rider-editable run
2. manager, rider, and cashier local browser sessions
3. a tagged open cashier shift so the closed-run remit hub stays reachable after manager close

## Scenario 1: No Release -> Return To Dispatch

1. Create a delivery parent order with stock available and dispatch it to a run.
2. Open rider check-in for the assigned rider.
3. On the parent order card, choose `Return to dispatch`.
4. Leave rider cash at `0.00`.
5. Submit check-in.

Expected:

1. Check-in submission succeeds without creating a clearance requirement for that parent order.
2. Stock recap treats the parent order as unsold for this run.
3. Run summary shows a no-release attempt outcome for that parent order.

Then:

1. Open manager remit.
2. Keep the no-release disposition as `Return to dispatch`.
3. Mark returned stocks as `Stocks Present`.
4. Close the run.

Expected:

1. Run closes successfully.
2. Parent order returns to dispatch eligibility.
3. Parent order does not appear in cashier delivery remit for the closed run.

## Scenario 2: No Release -> Cancel Before Release

1. Create a delivery parent order with no prior partial-payment state.
2. Dispatch it to a run and open rider check-in.
3. Choose `Cancel before release`.
4. Leave rider cash at `0.00`.
5. Submit check-in.
6. Open manager remit and keep `Cancel before release`.
7. Mark returned stocks as `Stocks Present`.
8. Close the run.

Expected:

1. Run closes successfully.
2. Parent order becomes `CANCELLED`.
3. Parent order does not return to dispatch queue.
4. Parent order does not create cashier delivery-remit work.

## Scenario 3: No Release + Missing Returned Stock

1. Repeat Scenario 1 or Scenario 2 until manager remit.
2. For at least one unsold product tied to the no-release order, mark `Mark Missing`.
3. Use the charge-close action on remit.

Expected:

1. No commercial clearance is created from the no-release outcome itself.
2. Rider shortage charge path still works for the missing unsold stock.
3. Run closes with rider shortage artifacts written.
4. Order remains eligible for dispatch retry while rider shortage accountability stays separate.

## Scenario 4: Guardrail On Partially Paid Parent Order

1. Prepare a delivery parent order that is already `PARTIALLY_PAID`.
2. Dispatch it to a run and open rider check-in.

Expected:

1. `Cancel before release` is disabled in rider check-in.

Then:

1. Force a manager remit attempt toward `Cancel before release` if possible.

Expected:

1. Server rejects the cancellation path.
2. Message points to refund/void flow as the missing prerequisite.

## Regression Checks

1. Normal parent order clearance still works when `remaining > EPS`.
2. Rejected clearance still requires `full pay` or `VOIDED`.
3. Quick roadside receipts are unaffected by the parent-order no-release controls.
4. Closed-run cashier list excludes no-release parent attempts from cash-turnover workload.
