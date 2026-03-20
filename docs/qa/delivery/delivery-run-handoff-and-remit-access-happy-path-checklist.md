# Delivery Run Handoff And Remit Access Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

This checklist is a secondary QA artifact.
It does not own delivery behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `docs/guide/RIDER_SHORTAGE_WORKFLOW.md`
4. `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`

## Purpose

Verify one deterministic delivery access lane across the manager, assigned rider, and cashier roles before adding remit posting math or shortage resolution flows.

## Setup

1. Run `npm run qa:delivery:run-handoff-and-remit-access:happy-path:setup`.
2. Copy the printed checked-in routes, closed cashier remit route, assigned rider label, cashier label, and tagged shift marker from the console output.
3. Keep this first scenario limited to access and route-gate verification only.

## Browser QA Steps

1. Run `npm run ui:test:delivery:run-handoff-and-remit-access:happy-path`.
2. The browser scenario stops after all three role lanes are confirmed:
   manager remit, assigned rider check-in, and cashier remit hub.

## Expected Scenario Shape

The setup creates:

1. one deterministic checked-in delivery run
2. one deterministic closed delivery run
3. one assigned rider session for the exact rider linked to the checked-in run
4. one tagged open cashier shift so the cashier remit hub can resume into the route

The browser flow should:

1. open the checked-in manager remit page as `STORE_MANAGER`
2. confirm the same manager is redirected away from rider-only check-in
3. open the checked-in rider check-in page as the assigned rider
4. open the closed cashier remit hub as `CASHIER`

## Manual QA Steps

1. Log in as `STORE_MANAGER`.
2. Open the printed checked-in remit route.
3. Confirm the page shows `Run Remit — Manager Review`.
4. Try opening the printed checked-in rider-checkin route with the same manager session.
5. Confirm the manager is redirected away from rider-only access.
6. Log in as the printed assigned rider.
7. Open the printed checked-in rider-checkin route.
8. Confirm the page shows `Rider Check-in`.
9. Log in as the printed cashier.
10. Open the printed closed cashier remit route.
11. Confirm the page shows `Delivery Run Remit`.
12. Confirm the tagged cashier shift allowed remit-hub access instead of redirecting back to `needShift`.

## Expected Outcomes

1. checked-in run stays in `CHECKED_IN`
2. closed run stays in `CLOSED`
3. manager can access checked-in remit, but not rider-only check-in
4. only the assigned rider can access the checked-in rider-checkin page
5. cashier can access the closed run remit hub once the tagged open shift exists
6. this first delivery scenario proves route and gate correctness only, not remit posting or shortage settlement math

## Cleanup

1. Run `npm run qa:delivery:run-handoff-and-remit-access:happy-path:cleanup`.
2. Confirm the tagged cashier shift, deterministic runs and orders, and generated storage-state files were removed.
