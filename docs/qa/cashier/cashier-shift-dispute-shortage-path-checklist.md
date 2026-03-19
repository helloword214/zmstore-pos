# Cashier Shift Dispute Shortage Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

This checklist is a secondary QA artifact.
It does not own cashier shift behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
3. `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`

## Purpose

Verify the canonical cashier shortage close path where the manager final-closes with `CHARGE_CASHIER` and a paper reference number.

## Setup

1. Run `npm run qa:cashier:shift-dispute-shortage-path:setup`.
2. Copy the printed cashier label, device marker, opening float, short count, expected charge amount, and paper reference number from the console output.
3. Do not use this device marker or paper reference for real operational shifts outside the QA scenario.

## Browser QA Steps

1. Run `npm run ui:test:cashier:shift-dispute-shortage-path`.
2. The browser scenario stops after the shift reaches `FINAL_CLOSED` and the shortage records are asserted.

## Manual QA Steps

1. Log in as `STORE_MANAGER`.
2. Open `/store/cashier-shifts`.
3. Open a shift for the printed cashier with the printed opening float and device marker.
4. Confirm the new shift row appears in `PENDING ACCEPT`.
5. Log in as the printed cashier.
6. Open `/cashier/shift`.
7. Accept the opening float using the same amount printed by setup.
8. Confirm the shift becomes writable and the cashier can reach the submit-count panel.
9. Submit counted cash using the printed short count so the drawer is short.
10. Return to the manager lane in `/store/cashier-shifts`.
11. Confirm the shift status changes to `COUNT SUBMITTED`.
12. Enter the same short amount as the manager recount total.
13. Select `Charge cashier` as the shortage decision.
14. Enter the printed paper reference number.
15. Final-close the shift.
16. Confirm the tagged shift no longer appears in the manager open-shifts list.
17. Return to `/cashier/shift` and confirm the cashier now has no active shift.

## Expected Outcomes

1. manager open creates a shift in `PENDING_ACCEPT`
2. cashier acceptance moves the shift to `OPEN`
3. cashier submit moves the shift to `SUBMITTED`
4. manager final close moves the shift to `FINAL_CLOSED`
5. a `CashierShiftVariance` is created or updated for the tagged QA shift
6. the variance resolution is `CHARGE_CASHIER`
7. a `CashierCharge` is created for the tagged QA shift using the shortage amount
8. a paper reference number is required on this shortage path

## Cleanup

1. Run `npm run qa:cashier:shift-dispute-shortage-path:cleanup`.
2. If cleanup reports deleted tagged QA rows, confirm that only the printed device marker was targeted.
