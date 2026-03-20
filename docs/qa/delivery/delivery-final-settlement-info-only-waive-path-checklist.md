# Delivery Final Settlement Info-Only Waive Path Checklist

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

Verify that cashier final settlement is unlocked after a manager clears a shortage through `INFO_ONLY` or `WAIVE`, without requiring rider acceptance.

## Setup

1. Run `npm run qa:delivery:final-settlement-info-only-waive-path:setup`.
2. Optional: set `QA_DELIVERY_FINAL_SETTLEMENT_INFO_ONLY_WAIVE_PATH_RESOLUTION=WAIVE` before setup if you want the printed manual setup to seed the waived branch instead of the default info-only branch.
3. Copy the printed settlement route, settled listing route, run code, and variance ref from the console output.
4. Keep this scenario limited to the alternate final cashier settlement lane only.

## Browser QA Steps

1. Run `npm run ui:test:delivery:final-settlement-info-only-waive-path`.
2. The browser scenario runs both branches:
3. `INFO_ONLY`
4. `WAIVE`
5. Each branch stops after the run redirects to the settled listing route and the settled run hub is re-opened in history mode.

## Expected Scenario Shape

The setup creates:

1. one deterministic closed delivery run
2. one shortage-backed paid delivery order with a rider-shortage bridge already posted
3. one manager-cleared `RiderRunVariance` using either:
4. `MANAGER_APPROVED + INFO_ONLY`
5. `WAIVED + WAIVE`
6. no linked open `RiderCharge`
7. one cashier browser storage state using the app auth layer

The browser flow should:

1. open `/cashier/delivery/:runId` as the seeded cashier
2. confirm the run shows the manager-cleared shortage state and enabled `Finalize run settlement`
3. submit the final settlement action
4. redirect to `/cashier/delivery?settled=1&runId=:runId`
5. re-open the settled run hub and confirm it is now read-only history

## Manual QA Steps

1. Log in as the printed cashier.
2. Open the printed settlement route.
3. Confirm the page shows the seeded run code and the manager-cleared shortage state.
4. Confirm no rider-acceptance action is required on this branch.
5. Confirm `Finalize run settlement` is enabled.
6. Click `Finalize run settlement`.
7. Confirm the app redirects to the printed settled listing route.
8. Re-open the printed settlement route and confirm the run is now fully settled and the finalize button is gone.

## Expected Outcomes

1. `DeliveryRun.status` moves from `CLOSED` to `SETTLED`
2. the same `RiderRunVariance` moves to `CLOSED`
3. `resolution` stays `INFO_ONLY` or `WAIVE`
4. `resolvedAt` is set on the variance
5. no `RiderCharge` is created or left open
6. no duplicate payments are created

## Cleanup

1. Run `npm run qa:delivery:final-settlement-info-only-waive-path:cleanup`.
2. Confirm the deterministic runs, orders, variance, context file, and browser storage-state files were removed.
