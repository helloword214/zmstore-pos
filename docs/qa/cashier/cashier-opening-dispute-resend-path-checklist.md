# Cashier Opening Dispute Resend Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

## Refer To

1. `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`

This checklist routes QA to the canonical cashier shift source of truth.
It does not own cashier shift behavior.

## Purpose

Validate the manager and cashier lifecycle for an opening-float dispute that is resent and finally accepted.

## Preconditions

1. an active `STORE_MANAGER` account exists
2. an active `CASHIER` account exists
3. the target cashier has no non-QA open shift
4. run `npm run qa:cashier:opening-dispute-resend-path:setup`

## Browser QA Steps

1. open the printed manager route as `STORE_MANAGER`
2. open a shift for the printed cashier using the printed initial opening float and device marker
3. open the printed cashier route as `CASHIER`
4. enter the printed disputed opening count and dispute note
5. click `Dispute`
6. confirm the cashier page shows `DISPUTED`
7. return to `/store/cashier-shifts`
8. confirm the tagged row shows `OPENING DISPUTED` and the printed dispute note
9. resend the opening verification using the printed resent opening float
10. return to `/cashier/shift`
11. accept the resent opening float
12. confirm the cashier page moves into the normal `Submit counted cash` state

## Expected Outcomes

1. the first manager open creates one tagged shift in `PENDING_ACCEPT`
2. the cashier dispute changes the same shift to `OPENING_DISPUTED`
3. the dispute note is stored on the same shift during the disputed state
4. manager resend changes the same shift back to `PENDING_ACCEPT`
5. resend clears `openingCounted`, `openingVerifiedAt`, and `openingDisputeNote`
6. resend updates `openingFloat` to the corrected printed value
7. final cashier accept changes the same shift to `OPEN`
8. there is still only one tagged open shift for the printed device marker
9. no close, recount, or variance side effects are created in this path

## Cleanup

1. run `npm run qa:cashier:opening-dispute-resend-path:cleanup`
2. confirm the tagged shift artifacts were removed
