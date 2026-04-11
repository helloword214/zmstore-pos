# Delivery Order Attempt Outcome Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-25

## Purpose

Manual QA checklist for delivery parent-order failed-delivery flow:

1. rider-reported failed delivery
2. dispatch-manager re-dispatch decision
3. dispatch-manager cancel decision

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

Default rider-check-in expectation:

1. parent orders stay on normal delivery unless the rider explicitly reports `Failed delivery`
2. rider sees one failed-delivery control, not separate `Return to dispatch` and `Cancel before release` choices
3. failed delivery requires a rider reason
4. stock recap `Loaded` reflects linked parent-order quantity plus any extra run load
5. a parent order already attached to an active run is hidden from dispatch assignment, and `/orders/:id/dispatch` resolves back to that active run

## Scenario 1: Failed Delivery -> Re-Dispatch

1. Create a delivery parent order with stock available and dispatch it to a run.
2. Open rider check-in for the assigned rider.
3. Confirm the parent order remains on normal delivery by default.
4. On the parent order card, click `Mark as failed delivery`.
5. Enter a rider reason.
6. Leave rider cash at `0.00`.
7. Submit check-in.

Expected:

1. Check-in submission succeeds without creating a clearance requirement for that parent order.
2. Stock recap treats the parent order as unsold for this run.
3. Run summary shows a failed-delivery report for that parent order.

Then:

1. Open manager remit.
2. Mark returned stocks as `Stocks Present`.
3. Close the run.

Expected:

1. Run closes successfully.
2. Parent order returns to dispatch review eligibility.
3. Parent order does not appear in cashier delivery remit for the closed run.

Then:

1. Open the dispatch queue.
2. Confirm the failed-delivery row shows rider reason and attempt count.
3. Re-dispatch the order by creating a new run from the queue selection.

Expected:

1. Dispatch review finalizes as re-dispatch.
2. Order leaves the queue because it is now linked to an active planned run.

## Scenario 2: Failed Delivery -> Cancel In Dispatch

1. Create a delivery parent order with no prior partial-payment state.
2. Dispatch it to a run and open rider check-in.
3. Click `Mark as failed delivery`.
4. Enter a rider reason.
5. Leave rider cash at `0.00`.
6. Submit check-in.
7. Open manager remit, mark returned stocks as `Stocks Present`, and close the run.
8. Open the dispatch queue and click `Cancel order`.

Expected:

1. Order becomes `CANCELLED`.
2. Order does not return to the dispatch queue.
3. Order does not create cashier delivery-remit work.

## Scenario 3: Failed Delivery + Missing Returned Stock

1. Repeat Scenario 1 until manager remit.
2. For at least one unsold product tied to the failed-delivery order, mark `Mark Missing`.
3. Use the charge-close action on remit.

Expected:

1. No commercial clearance is created from the failed-delivery report itself.
2. Rider shortage charge path still works for the missing unsold stock.
3. Run closes with rider shortage artifacts written.
4. Order stays in dispatch review so logistics disposition remains separate from rider accountability.

## Scenario 4: Guardrail On Partially Paid Parent Order

1. Prepare a delivery parent order that is already `PARTIALLY_PAID`.
2. Dispatch it to a run, mark failed delivery, and close the run through remit with returned stocks present.
3. Open the dispatch queue.

Expected:

1. `Cancel order` is disabled for that failed-delivery row.
2. Message points to refund/void flow as the missing prerequisite.

## Regression Checks

1. Normal parent order clearance still works when `remaining > EPS`.
2. Rejected clearance still requires `full pay` or `VOIDED`.
3. Quick roadside receipts are unaffected by the parent-order failed-delivery controls.
4. Closed-run cashier list excludes failed-delivery parent attempts from cash-turnover workload.
5. Extra run stock stays available for quick sales after parent-order quantities are reserved against the same product.
6. A delivery order already assigned to one active run cannot be assigned to another active run through dispatch queue or `/orders/:id/dispatch`.
