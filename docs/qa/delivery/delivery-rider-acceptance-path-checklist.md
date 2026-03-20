# Delivery Rider Acceptance Path Checklist

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

Verify the rider acknowledgement lane after a manager-approved `CHARGE_RIDER` shortage decision.

## Setup

1. Run `npm run qa:delivery:rider-acceptance-path:setup`.
2. Copy the printed rider acceptance route, run code, and variance ref from the console output.
3. Keep this scenario limited to the rider acceptance lane only.

## Browser QA Steps

1. Run `npm run ui:test:delivery:rider-acceptance-path`.
2. The browser scenario stops after the rider is redirected back to the rider variance queue with the accepted marker.

## Expected Scenario Shape

The setup creates:

1. one deterministic closed delivery run
2. one `RiderRunVariance(status = MANAGER_APPROVED, resolution = CHARGE_RIDER)`
3. one linked `RiderCharge(status = OPEN)`
4. one rider browser storage state using the app auth layer

The browser flow should:

1. open `/rider/variance/:id` as the seeded rider
2. confirm the acceptance UI is visible
3. click `Accept variance`
4. redirect to `/rider/variances?accepted=1`

## Manual QA Steps

1. Log in as the printed rider.
2. Open the printed acceptance route.
3. Confirm the page shows the seeded variance and run code.
4. Confirm the page says the manager decided to charge rider.
5. Click `Accept variance`.
6. Confirm the app redirects to `/rider/variances?accepted=1`.

## Expected Outcomes

1. `riderAcceptedAt` is set on the same variance
2. `riderAcceptedById` is set to the seeded rider user
3. `resolution` remains `CHARGE_RIDER`
4. linked `RiderCharge` remains present and open
5. no duplicate `RiderCharge` is created

## Cleanup

1. Run `npm run qa:delivery:rider-acceptance-path:cleanup`.
2. Confirm the deterministic runs, orders, variance, charge, context file, and rider storage-state file were removed.
