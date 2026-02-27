# Guide Index

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-27

This folder contains both binding rules and historical implementation notes.
Use the sections below to avoid outdated references.

## A. Canonical (Binding)

Use these as source of truth for implementation and review:

1. `Commercial Clearance System V2`
2. `CANONICAL_IDENTITY_ACCESS_FLOW.md`
3. `CANONICAL_ORDER_PRICING_SOT.md`
4. `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
5. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
6. `DIAGRAMS_DELIVERY_CSS_AR.md`
7. `Accounts Receivable — Canonical Source of Truth (SoT)`
8. `RIDER_SHORTAGE_WORKFLOW.md`
9. `RunReceipt_Architecture.md`

Current route-level mapping coverage (canonical):

1. `pad-order._index.tsx`
2. `orders.new.tsx`
3. `customers.$id_.pricing.tsx`
4. `customers.$id_.pricing_.$ruleId.tsx`
5. `store.dispatch.tsx`
6. `runs.$id.dispatch.tsx`
7. `runs.$id.summary.tsx`
8. `runs.$id.rider-checkin.tsx`
9. `store.clearance.tsx`
10. `store.clearance_.$caseId.tsx`
11. `runs.$id.remit.tsx`
12. `cashier.delivery._index.tsx`
13. `cashier.delivery.$runId.tsx`
14. `delivery-remit.$id.tsx`
15. `ar._index.tsx`
16. `ar.customers.$id.tsx`
17. `cashier.shift.tsx`
18. `store.cashier-shifts.tsx`
19. `store.cashier-variances.tsx`
20. `cashier.charges.tsx`
21. `store.cashier-ar.tsx`
22. `store.payroll.tsx`
23. `_index.tsx`
24. `creation._index.tsx`
25. `creation.employees.tsx`
26. `creation.employees_.new.tsx`
27. `creation.employees_.$employeeId.edit.tsx`
28. `creation.riders.tsx`
29. `creation.vehicles.tsx`
30. `creation.areas.tsx`
31. `creation.provinces.tsx`
32. `customers._index.tsx`
33. `customers.new.tsx`
34. `customers.$id.tsx`
35. `customers.$id_.edit.tsx`
36. `customers.$id_.pricing.tsx`
37. `customers.$id_.pricing_.$ruleId.tsx`
38. `login.tsx`
39. `forgot-password.tsx`
40. `reset-password.$token.tsx`

Identity operations note:

1. `creation.employees_.new.tsx` is the canonical admin surface for new employee account creation.
2. `creation.employees.tsx` is the canonical employee directory/manage surface for normal `CASHIER <-> RIDER` role switching.
3. `creation.employees_.$employeeId.edit.tsx` is the canonical profile/compliance update surface for existing employee accounts.
4. `STORE_MANAGER` assignment/revocation remains a protected flow outside normal switching.
5. `login.tsx` is email/password-only for all roles (including cashier).
6. `forgot-password.tsx` and `reset-password.$token.tsx` are the canonical self-service password recovery routes.
7. Employee account creation is invite-based (`PENDING_PASSWORD` to `ACTIVE`) and requires email.
8. Employee account creation captures one primary address using canonical address masters.
9. Employee creation/edit captures optional profile compliance fields plus document history (`VALID_ID`, `DRIVER_LICENSE_SCAN`, `BARANGAY_CLEARANCE`, `POLICE_CLEARANCE`, `NBI_CLEARANCE`, `PHOTO_2X2`, `RESUME`, `OTHER`).
10. Employee compliance remains monitoring-only in current phase; warnings focus on `VALID_ID` and rider license signals, while HR docs remain optional records.
11. Clearance docs (`BARANGAY_CLEARANCE`, `POLICE_CLEARANCE`, `NBI_CLEARANCE`) are hiring/reference records only and are stored without expiry tracking.
12. Vehicle creation includes registration metadata (`plateNumber`, `orNumber`, `crNumber`, `ltoRegistrationExpiry`) for monitoring reminders.
13. Customer address management supports optional location photos per address (`0..4` slots with optional caption), and uploads are non-blocking.
14. Customer profile supports optional single profile photo upload from admin customer detail (`/customers/:id?ctx=admin`).

## B. Supporting (Context / Detailed Rationale)

1. `ui/README.md`
2. `ui/UI_SOT.md`
3. `ui/UI_AUTOMATION_GUIDE.md`
4. `ui/UI_CONFORMANCE_MATRIX.md`
5. `ui/UI_REPAIR_AUTOMATION_RUNBOOK.md`
6. `ui/Clearance CSS Alignment Rules.md`
7. `ui/Remit_Cleanup_Checklist.md`
8. `../automation/runbooks/README.md`
9. `../automation/runbooks/INTENT_ROUTER.md`
10. `../automation/runbooks/UI_CYCLE_RUNBOOK.md`
11. `../automation/runbooks/BUSINESS_FLOW_SMOKE_RUNBOOK.md`
12. `../automation/templates/UI_AUTOMATION_PROMPT_TEMPLATE.md`

These help implementation but must not override Canonical docs.

Monitor/repair split rule:

1. `ui:cycle` is monitor-only (detect/classify/report).
2. UI code edits belong to repair flow/runbook.
3. Repeated route patterns should be extracted into SoT UI components first.

## C. Deprecated or Plan-Only (Do Not Use as Authority)

See `../archive/README.md` for the current deprecation list and superseding docs.
Archived guide files now live under `../archive/guide/`.

## D. Conflict Rule inside `docs/guide`

When two guide docs conflict, apply this order:

1. `Commercial Clearance System V2`
2. `CANONICAL_IDENTITY_ACCESS_FLOW.md`
3. `CANONICAL_ORDER_PRICING_SOT.md`
4. `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
5. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
6. `DIAGRAMS_DELIVERY_CSS_AR.md`
7. `Accounts Receivable — Canonical Source of Truth (SoT)`
8. `RIDER_SHORTAGE_WORKFLOW.md`
9. all other guide docs

## E. Flow Change Sync Rule (Mandatory)

1. If code changes flow behavior, update the corresponding canonical guide docs in the same objective/PR.
2. Minimum required docs for flow-affecting updates:
   - `CANONICAL_ORDER_PRICING_SOT.md` when order-create pricing/freeze behavior changes
   - `CANONICAL_IDENTITY_ACCESS_FLOW.md` when role/access authority boundaries change
   - relevant `CANONICAL_*.md` flow guide
   - `DIAGRAMS_DELIVERY_CSS_AR.md` when flow nodes/handoffs/decision gates changed
3. Manager/cashier flow changes must not be considered complete until both behavior doc and diagram doc are aligned.
