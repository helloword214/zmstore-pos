# Delivery Manager Shortage Review Charge Path Checklist

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

Verify the manager decision lane for a seeded cashier shortage bridge where the manager charges the rider from the open rider-variance queue.

## Setup

1. Run `npm run qa:delivery:manager-shortage-review-charge-path:setup`.
2. Copy the printed review route, awaiting route, run code, variance ref, and decision note from the console output.
3. Keep this scenario limited to the `CHARGE_RIDER` manager decision only.

## Browser QA Steps

1. Run `npm run ui:test:delivery:manager-shortage-review-charge-path`.
2. The browser scenario stops after the variance appears in the awaiting-rider tab.

## Expected Scenario Shape

The setup creates:

1. one deterministic closed delivery run
2. one cashier shortage bridge with an open `RiderRunVariance`
3. no `RiderCharge` yet
4. one manager browser storage state using the app auth layer

The browser flow should:

1. open `/store/rider-variances?tab=open` as `STORE_MANAGER`
2. find the seeded open shortage row for the printed run code
3. choose `Charge rider (needs rider accept)`
4. submit the printed decision note
5. confirm the row moves to the awaiting-rider queue

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed review route.
3. Confirm the page shows `Rider Variances`.
4. Find the row for the printed run code and variance ref.
5. Choose `Charge rider (needs rider accept)`.
6. Enter the printed decision note.
7. Click `Save decision`.
8. Confirm the row leaves the open queue.
9. Open the printed awaiting route and confirm the same row appears there.

## Expected Outcomes

1. the seeded `RiderRunVariance` moves from `OPEN` to `MANAGER_APPROVED`
2. the variance `resolution` becomes `CHARGE_RIDER`
3. `managerApprovedAt` and `managerApprovedById` are set
4. one `RiderCharge(status = OPEN)` is created and linked by `varianceId`
5. the original rider-shortage bridge payment remains intact
6. no duplicate `RiderCharge` is created during the first manager decision

## Cleanup

1. Run `npm run qa:delivery:manager-shortage-review-charge-path:cleanup`.
2. Confirm the deterministic runs, orders, variance, charge, context file, and manager storage-state file were removed.
