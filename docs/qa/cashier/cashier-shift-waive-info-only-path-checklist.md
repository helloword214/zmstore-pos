# Cashier Shift Waive Info-Only Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

This checklist is a secondary QA artifact.
It does not own cashier shift behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
3. `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md`

## Purpose

Verify the canonical cashier shortage close branches where the manager final-closes with alternate decisions:

1. `INFO_ONLY`
2. `WAIVE`

## Setup

1. Run `npm run qa:cashier:shift-waive-info-only-path:setup`.
2. Copy the printed cashier label, device marker, opening float, short count, and the two printed paper references.
3. Do not use this device marker or paper reference set for real operational shifts outside the QA scenario.

## Browser QA Steps

1. Run `npm run ui:test:cashier:shift-waive-info-only-path`.
2. The browser scenario runs both manager alternate-decision branches:
3. `INFO_ONLY`
4. `WAIVE`

## Manual QA Steps

1. Log in as `STORE_MANAGER`.
2. Open `/store/cashier-shifts`.
3. Open a shift for the printed cashier with the printed opening float and device marker.
4. Confirm the new shift row appears in `PENDING ACCEPT`.
5. Log in as the printed cashier.
6. Open `/cashier/shift`.
7. Accept the opening float using the same amount printed by setup.
8. Submit counted cash using the printed short count so the drawer is short.
9. Return to the manager lane in `/store/cashier-shifts`.
10. Confirm the shift status changes to `COUNT SUBMITTED`.
11. Enter the same short amount as the manager recount total.
12. For branch one, select `Info only` and enter the printed info-only paper reference.
13. For branch two, select `Waive` and enter the printed waive paper reference.
14. Final-close the shift.
15. Confirm the tagged shift no longer appears in the manager open-shifts list.
16. Return to `/cashier/shift` and confirm the cashier now has no active shift.

## Expected Outcomes

1. manager open creates a shift in `PENDING_ACCEPT`
2. cashier acceptance moves the shift to `OPEN`
3. cashier submit moves the shift to `SUBMITTED`
4. manager final close moves the shift to `FINAL_CLOSED`
5. an `INFO_ONLY` decision creates or updates a `CashierShiftVariance` in `MANAGER_APPROVED`
6. a `WAIVE` decision creates or updates a `CashierShiftVariance` in `WAIVED`
7. no `CashierCharge` is created for either alternate-decision branch
8. a paper reference number is still required on this shortage path

## Cleanup

1. Run `npm run qa:cashier:shift-waive-info-only-path:cleanup`.
2. If cleanup reports deleted tagged QA rows, confirm that only the printed device marker was targeted.
