# Delivery Cashier Order Remit Shortage Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

This checklist is a secondary QA artifact.
It does not own delivery remit behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`

## Purpose

Verify the cashier shortage bridge path on a deterministic closed run where rider truth says the customer is fully paid, but the cashier turns in less cash than expected.

## Setup

1. Run `npm run qa:delivery:cashier-order-remit-shortage-path:setup`.
2. Copy the printed order remit route, run hub route, exact rider-cash amount, short cash amount, and expected shortage bridge from the console output.
3. Keep this scenario limited to the shortage bridge lane only.

## Browser QA Steps

1. Run `npm run ui:test:delivery:cashier-order-remit-shortage-path`.
2. The browser scenario stops after the cashier returns to the closed run remit hub.

## Expected Scenario Shape

The setup creates:

1. one deterministic closed delivery run
2. one linked closed-run delivery order
3. one seeded `PARENT` run receipt with exact `cashCollected` equal to the frozen order total
4. one tagged open cashier shift
5. one cashier browser storage state using the app auth layer

The browser flow should:

1. open `/delivery-remit/:orderId?fromRunId=:runId` as `CASHIER`
2. uncheck print-after-posting so the flow returns to the run hub
3. submit the printed short cash amount
4. redirect back to `/cashier/delivery/:runId`

## Manual QA Steps

1. Log in as the printed cashier.
2. Open the printed order remit route.
3. Confirm the page shows `Delivery Payment Remit`.
4. Confirm the printed exact rider-cash amount matches the due amount.
5. Uncheck the print-after-posting option.
6. Enter the printed short cash amount instead of the exact rider-cash amount.
7. Click `Post Remit`.
8. Confirm the app redirects back to the printed run hub route.
9. Confirm the run hub shows that all delivery orders for the run are settled.

## Expected Outcomes

1. one `Payment` is created with `method = CASH` for the actual cash received
2. one `Payment` is created with `method = INTERNAL_CREDIT` and `refNo` starting `RIDER-SHORTAGE:`
3. one `RiderRunVariance` is created for the same receipt or run
4. no `RiderCharge` is created yet at this stage
5. the order still becomes `PAID` under the bridge-payment rule

## Cleanup

1. Run `npm run qa:delivery:cashier-order-remit-shortage-path:cleanup`.
2. Confirm the deterministic runs, orders, parent receipt, tagged shift, context file, and cashier storage-state file were removed.
