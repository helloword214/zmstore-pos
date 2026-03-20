# Delivery Manager Remit Posting Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

This checklist is a secondary QA artifact.
It does not own delivery or remit behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`

## Purpose

Verify the first normal manager-remit posting path on a deterministic checked-in run with no missing-stock charge and no pending clearance blockers.

## Setup

1. Run `npm run qa:delivery:manager-remit-posting:happy-path:setup`.
2. Copy the printed checked-in run code, manager remit route, and summary route from the console output.
3. Keep this first scenario limited to the normal `Approve Remit & Close Run` action only.

## Browser QA Steps

1. Run `npm run ui:test:delivery:manager-remit-posting:happy-path`.
2. The browser scenario stops after the manager is redirected to the posted run summary report.

## Expected Scenario Shape

The setup creates:

1. one deterministic checked-in delivery run eligible for normal manager remit
2. one manager browser storage state using the app auth layer
3. no pending-clearance blocker on the checked-in run
4. no missing-stock charge path selected for the run

The browser flow should:

1. open `/runs/:id/remit` as `STORE_MANAGER`
2. confirm the normal `Approve Remit & Close Run` action is enabled
3. submit the normal remit action
4. redirect to `/runs/:id/summary?posted=1`

## Manual QA Steps

1. Log in as `STORE_MANAGER`.
2. Open the printed manager remit route.
3. Confirm the page shows `Run Remit — Manager Review`.
4. Confirm `Approve Remit & Close Run` is enabled.
5. Confirm `Charge Rider (Missing Stocks) & Close Run` is disabled on this no-missing path.
6. Click `Approve Remit & Close Run`.
7. Confirm the app redirects to the printed summary route with `posted=1`.
8. Confirm the page shows `Run Summary Report`.

## Expected Outcomes

1. the checked-in run moves from `CHECKED_IN` to `CLOSED`
2. the manager lands on the posted summary route
3. no `RiderRunVariance` is created for this no-missing path
4. no `RiderCharge` is created for this no-missing path
5. no pending-clearance blocker exists for the seeded run during this happy path

## Cleanup

1. Run `npm run qa:delivery:manager-remit-posting:happy-path:cleanup`.
2. Confirm the deterministic runs, orders, context file, and manager storage-state file were removed.
