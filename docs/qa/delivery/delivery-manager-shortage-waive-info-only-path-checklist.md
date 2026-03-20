# Delivery Manager Shortage Waive / Info-Only Path Checklist

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

Verify the alternate manager decision lanes for a seeded cashier shortage bridge where the manager clears the rider variance as `INFO_ONLY` or `WAIVE` from the open rider-variance queue.

## Setup

1. Run `npm run qa:delivery:manager-shortage-waive-info-only-path:setup`.
2. Copy the printed review route, history route, run code, variance ref, info-only note, and waive note from the console output.
3. Keep this scenario limited to the two alternate manager decisions only:
   - `INFO_ONLY`
   - `WAIVE`

## Browser QA Steps

1. Run `npm run ui:test:delivery:manager-shortage-waive-info-only-path`.
2. The browser scenario stops after the row is confirmed in the history tab for each manager decision.

## Expected Scenario Shape

The setup creates:

1. one deterministic closed delivery run
2. one cashier shortage bridge with an open `RiderRunVariance`
3. no `RiderCharge` yet
4. one manager browser storage state using the app auth layer

The browser flow should:

1. open `/store/rider-variances?tab=open` as `STORE_MANAGER`
2. find the seeded open shortage row for the printed run code
3. choose `Info only (no rider accept)` and submit the printed info-only note
4. confirm the row leaves the open queue and appears in history
5. reset through setup, then choose `Waive` and submit the printed waive note
6. confirm the row leaves the open queue and appears in history

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed review route.
3. Confirm the page shows `Rider Variances`.
4. Find the row for the printed run code and variance ref.
5. Choose `Info only (no rider accept)`.
6. Enter the printed info-only note.
7. Click `Save decision`.
8. Confirm the row leaves the open queue.
9. Open the printed history route and confirm the same row appears there with `MANAGER_APPROVED` and `INFO_ONLY`.
10. Re-run setup.
11. Repeat the same flow with `Waive` and the printed waive note.
12. Confirm the history row shows `WAIVED` and `WAIVE`.

## Expected Outcomes

1. `INFO_ONLY` moves the seeded `RiderRunVariance` to `MANAGER_APPROVED`
2. `INFO_ONLY` sets `resolution = INFO_ONLY`
3. `INFO_ONLY` sets `managerApprovedAt` and `managerApprovedById`
4. `INFO_ONLY` does not create an open `RiderCharge`
5. `WAIVE` moves the seeded `RiderRunVariance` to `WAIVED`
6. `WAIVE` sets `resolution = WAIVE`
7. `WAIVE` does not require rider acknowledgement
8. the original rider-shortage bridge payment remains intact in both branches
9. no duplicate `RiderCharge` is created during either manager decision

## Cleanup

1. Run `npm run qa:delivery:manager-shortage-waive-info-only-path:cleanup`.
2. Confirm the deterministic runs, orders, variance, context file, and manager storage-state file were removed.
