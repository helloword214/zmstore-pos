# Delivery Final Settlement Gating Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

This checklist is a secondary QA artifact.
It does not own delivery shortage behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`

## Purpose

Verify that cashier final settlement is unlocked after manager approval plus rider acceptance on a shortage-backed delivery run.

## Setup

1. Run `npm run qa:delivery:final-settlement-gating:setup`.
2. Copy the printed settlement route, settled listing route, run code, and variance ref from the console output.
3. Keep this scenario limited to the final cashier settlement lane only.

## Browser QA Steps

1. Run `npm run ui:test:delivery:final-settlement-gating`.
2. The browser scenario stops after the run redirects to the settled listing route and the settled run hub is re-opened in history mode.

## Expected Scenario Shape

The setup creates:

1. one deterministic closed delivery run
2. one shortage-backed paid delivery order with a rider-shortage bridge already posted
3. one `RiderRunVariance(status = RIDER_ACCEPTED, resolution = CHARGE_RIDER)`
4. one linked `RiderCharge(status = OPEN)`
5. one cashier browser storage state using the app auth layer

The browser flow should:

1. open `/cashier/delivery/:runId` as the seeded cashier
2. confirm the run shows the accepted shortage state and enabled `Finalize run settlement`
3. submit the final settlement action
4. redirect to `/cashier/delivery?settled=1&runId=:runId`
5. re-open the settled run hub and confirm it is now read-only history

## Manual QA Steps

1. Log in as the printed cashier.
2. Open the printed settlement route.
3. Confirm the page shows the seeded run code and accepted rider shortage state.
4. Confirm `Finalize run settlement` is enabled.
5. Click `Finalize run settlement`.
6. Confirm the app redirects to the printed settled listing route.
7. Re-open the printed settlement route and confirm the run is now fully settled and the finalize button is gone.

## Expected Outcomes

1. `DeliveryRun.status` moves from `CLOSED` to `SETTLED`
2. the same `RiderRunVariance` moves from `RIDER_ACCEPTED` to `CLOSED`
3. `resolvedAt` is set on the variance
4. the linked `RiderCharge` remains present and single
5. no duplicate payments or charges are created

## Cleanup

1. Run `npm run qa:delivery:final-settlement-gating:cleanup`.
2. Confirm the deterministic runs, orders, variance, charge, context file, and browser storage-state files were removed.
