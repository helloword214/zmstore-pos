# Cashier Shift Open Close Happy Path Checklist

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

Verify the no-variance cashier shift lifecycle across the manager and cashier lanes.

## Setup

1. Run `npm run qa:cashier:shift-open-close:happy-path:setup`.
2. Copy the printed cashier label, device marker, and opening float from the console output.
3. Do not use this device marker for real operational shifts outside the QA scenario.

## Browser QA Steps

1. Run `npm run ui:test:cashier:shift-open-close:happy-path`.
2. The browser scenario stops after the shift reaches `FINAL_CLOSED`.

## Manual QA Steps

1. Log in as `STORE_MANAGER`.
2. Open `/store/cashier-shifts`.
3. Open a shift for the printed cashier with the printed opening float and device marker.
4. Confirm the new shift row appears in `PENDING ACCEPT`.
5. Log in as the printed cashier.
6. Open `/cashier/shift`.
7. Accept the opening float using the same amount printed by setup.
8. Confirm the shift becomes writable and the cashier can reach the submit-count panel.
9. Submit counted cash matching the expected drawer with no extra transactions posted.
10. Return to the manager lane in `/store/cashier-shifts`.
11. Confirm the shift status changes to `COUNT SUBMITTED`.
12. Enter the same manager recount total and final-close the shift.
13. Confirm the tagged shift no longer appears in the manager open-shifts list.
14. Return to `/cashier/shift` and confirm the cashier now has no active shift.

## Expected Outcomes

1. manager open creates a shift in `PENDING_ACCEPT`
2. cashier acceptance moves the shift to `OPEN`
3. cashier submit moves the shift to `SUBMITTED`
4. manager final close moves the shift to `FINAL_CLOSED`
5. no shortage branch is triggered
6. no paper reference number is required on this no-variance path
7. no cashier variance or cashier charge is created for the tagged QA shift

## Cleanup

1. Run `npm run qa:cashier:shift-open-close:happy-path:cleanup`.
2. If cleanup reports deleted tagged QA rows, confirm that only the printed device marker was targeted.
