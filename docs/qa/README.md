# QA Scenario Index

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

This file is a router for `docs/qa`.
It points readers to QA scenario docs and must not become the owner of QA/testing architecture rules.

## Owns

1. routing readers to scenario-specific QA checklists
2. keeping a discoverable list of current QA scenario docs

## Does Not Own

1. QA/testing architecture rules
2. business behavior under test
3. Playwright execution contracts

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/README.md`
3. the relevant canonical business doc for the flow being tested
4. `docs/qa/APP_QA_FLOW_REGISTRY.md`
5. `docs/qa/APP_QA_ROADMAP.md`

## Core QA Planning Docs

Start here before adding or rewriting browser QA:

1. `APP_QA_FLOW_REGISTRY.md`
   Owner doc for repository-level QA flow inventory, current coverage mapping, and legacy-test disposition
2. `APP_QA_ROADMAP.md`
   Supporting rollout plan for phasing scenario-family work across auth, product, payroll, schedule, cashier, delivery, and admin flows

## Current Scenario Docs

### Auth

1. `auth/auth-login-otp-session-checklist.md`
2. `auth/auth-role-routing-checklist.md`

Use this checklist after running the matching scenario setup command:

1. `npm run qa:auth:login-otp-session:setup`
2. perform the manual QA steps in the checklist
3. `npm run qa:auth:login-otp-session:cleanup`
4. `npm run qa:auth:role-routing:setup`
5. perform the manual QA steps in the role-routing checklist
6. `npm run qa:auth:role-routing:cleanup`

### Cashier

1. `cashier/cashier-shift-open-close-happy-path-checklist.md`
2. `cashier/cashier-shift-dispute-shortage-path-checklist.md`
3. `cashier/cashier-shift-waive-info-only-path-checklist.md`
4. `cashier/cashier-opening-dispute-resend-path-checklist.md`

Use this scenario family with the matching setup and cleanup commands:

1. `npm run qa:cashier:shift-open-close:happy-path:setup`
2. perform the manual QA steps in the checklist, or run `npm run ui:test:cashier:shift-open-close:happy-path`
3. `npm run qa:cashier:shift-open-close:happy-path:cleanup`
4. `npm run qa:cashier:shift-dispute-shortage-path:setup`
5. perform the manual QA steps in the shortage checklist, or run `npm run ui:test:cashier:shift-dispute-shortage-path`
6. `npm run qa:cashier:shift-dispute-shortage-path:cleanup`
7. `npm run qa:cashier:shift-waive-info-only-path:setup`
8. perform the manual QA steps in the alternate-decision checklist, or run `npm run ui:test:cashier:shift-waive-info-only-path`
9. `npm run qa:cashier:shift-waive-info-only-path:cleanup`
10. `npm run qa:cashier:opening-dispute-resend-path:setup`
11. perform the manual QA steps in the dispute-resend checklist, or run `npm run ui:test:cashier:opening-dispute-resend-path`
12. `npm run qa:cashier:opening-dispute-resend-path:cleanup`

### Delivery

1. `delivery/delivery-run-handoff-and-remit-access-happy-path-checklist.md`
2. `delivery/delivery-manager-remit-posting-happy-path-checklist.md`
3. `delivery/delivery-cashier-order-remit-posting-happy-path-checklist.md`
4. `delivery/delivery-cashier-order-remit-shortage-path-checklist.md`
5. `delivery/delivery-manager-shortage-review-charge-path-checklist.md`
6. `delivery/delivery-manager-shortage-waive-info-only-path-checklist.md`
7. `delivery/delivery-rider-acceptance-path-checklist.md`
8. `delivery/delivery-final-settlement-gating-checklist.md`
9. `delivery/delivery-final-settlement-info-only-waive-path-checklist.md`
10. `delivery/delivery-payroll-deduction-follow-through-checklist.md`

Use this scenario family with the matching setup and cleanup commands:

1. `npm run qa:delivery:run-handoff-and-remit-access:happy-path:setup`
2. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:run-handoff-and-remit-access:happy-path`
3. `npm run qa:delivery:run-handoff-and-remit-access:happy-path:cleanup`
4. `npm run qa:delivery:manager-remit-posting:happy-path:setup`
5. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:manager-remit-posting:happy-path`
6. `npm run qa:delivery:manager-remit-posting:happy-path:cleanup`
7. `npm run qa:delivery:cashier-order-remit-posting:happy-path:setup`
8. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:cashier-order-remit-posting:happy-path`
9. `npm run qa:delivery:cashier-order-remit-posting:happy-path:cleanup`
10. `npm run qa:delivery:cashier-order-remit-shortage-path:setup`
11. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:cashier-order-remit-shortage-path`
12. `npm run qa:delivery:cashier-order-remit-shortage-path:cleanup`
13. `npm run qa:delivery:manager-shortage-review-charge-path:setup`
14. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:manager-shortage-review-charge-path`
15. `npm run qa:delivery:manager-shortage-review-charge-path:cleanup`
16. `npm run qa:delivery:manager-shortage-waive-info-only-path:setup`
17. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:manager-shortage-waive-info-only-path`
18. `npm run qa:delivery:manager-shortage-waive-info-only-path:cleanup`
19. `npm run qa:delivery:rider-acceptance-path:setup`
20. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:rider-acceptance-path`
21. `npm run qa:delivery:rider-acceptance-path:cleanup`
22. `npm run qa:delivery:final-settlement-gating:setup`
23. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:final-settlement-gating`
24. `npm run qa:delivery:final-settlement-gating:cleanup`
25. `npm run qa:delivery:final-settlement-info-only-waive-path:setup`
26. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:final-settlement-info-only-waive-path`
27. `npm run qa:delivery:final-settlement-info-only-waive-path:cleanup`
28. `npm run qa:delivery:payroll-deduction-follow-through:setup`
29. perform the manual QA steps in the checklist, or run `npm run ui:test:delivery:payroll-deduction-follow-through`
30. `npm run qa:delivery:payroll-deduction-follow-through:cleanup`

### Employee

1. `employee/employee-onboarding-create-happy-path-checklist.md`
2. `employee/employee-onboarding-rider-happy-path-checklist.md`
3. `employee/employee-onboarding-store-manager-happy-path-checklist.md`
4. `employee/employee-account-management-happy-path-checklist.md`
5. `employee/employee-profile-edit-happy-path-checklist.md`
6. `employee/employee-role-switch-happy-path-checklist.md`

Use this scenario family with the matching setup and cleanup commands:

1. `npm run qa:employee:onboarding-create:happy-path:setup`
2. perform the manual QA steps in the checklist, or run `npm run ui:test:employee:onboarding-create:happy-path`
3. `npm run qa:employee:onboarding-create:happy-path:cleanup`
4. `npm run qa:employee:onboarding-rider:happy-path:setup`
5. perform the manual QA steps in the checklist, or run `npm run ui:test:employee:onboarding-rider:happy-path`
6. `npm run qa:employee:onboarding-rider:happy-path:cleanup`
7. `npm run qa:employee:onboarding-store-manager:happy-path:setup`
8. perform the manual QA steps in the checklist, or run `npm run ui:test:employee:onboarding-store-manager:happy-path`
9. `npm run qa:employee:onboarding-store-manager:happy-path:cleanup`
10. `npm run qa:employee:account-management:happy-path:setup`
11. perform the manual QA steps in the checklist, or run `npm run ui:test:employee:account-management:happy-path`
12. `npm run qa:employee:account-management:happy-path:cleanup`
13. `npm run qa:employee:profile-edit:happy-path:setup`
14. perform the manual QA steps in the checklist, or run `npm run ui:test:employee:profile-edit:happy-path`
15. `npm run qa:employee:profile-edit:happy-path:cleanup`
16. `npm run qa:employee:role-switch:happy-path:setup`
17. perform the manual QA steps in the checklist, or run `npm run ui:test:employee:role-switch:happy-path`
18. `npm run qa:employee:role-switch:happy-path:cleanup`

Current admin access governance is covered through this employee scenario-family cluster.
The live app does not currently expose a separate branch or access maintenance UI outside these employee admin routes, so role, branch, invite, profile, and resulting lane checks should stay mapped here unless a dedicated admin surface is added later.

### Product

1. `product/product-catalog-admin-happy-path-checklist.md`

Use this scenario family with the matching setup and cleanup commands:

1. `npm run qa:product:catalog-admin:happy-path:setup`
2. perform the manual QA steps in the checklist, or run `npm run ui:test:product:catalog-admin:happy-path`
3. `npm run qa:product:catalog-admin:happy-path:cleanup`

### Workforce

1. `workforce/workforce-payroll-happy-path-checklist.md`
2. `workforce/workforce-schedule-template-assignment-happy-path-checklist.md`
3. `workforce/workforce-schedule-template-assignment-status-path-checklist.md`
4. `workforce/workforce-schedule-template-create-edit-happy-path-checklist.md`
5. `workforce/workforce-schedule-planner-assignment-gating-path-checklist.md`
6. `workforce/workforce-schedule-row-update-or-cancel-path-checklist.md`
7. `workforce/workforce-schedule-published-row-maintenance-path-checklist.md`
8. `workforce/workforce-schedule-append-event-history-path-checklist.md`
9. `workforce/workforce-schedule-planner-publish-visibility-happy-path-checklist.md`
10. `workforce/workforce-attendance-recording-happy-path-checklist.md`

Use this scenario family with the matching setup and cleanup commands:

1. `npm run qa:workforce:payroll:happy-path:setup`
2. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:payroll:happy-path`
3. `npm run qa:workforce:payroll:happy-path:cleanup`
4. `npm run qa:workforce:schedule-template-assignment:happy-path:setup`
5. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:schedule-template-assignment:happy-path`
6. `npm run qa:workforce:schedule-template-assignment:happy-path:cleanup`
7. `npm run qa:workforce:schedule-template-assignment-status-path:setup`
8. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:schedule-template-assignment-status-path`
9. `npm run qa:workforce:schedule-template-assignment-status-path:cleanup`
10. `npm run qa:workforce:schedule-template-create-edit:happy-path:setup`
11. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:schedule-template-create-edit:happy-path`
12. `npm run qa:workforce:schedule-template-create-edit:happy-path:cleanup`
13. `npm run qa:workforce:schedule-planner-assignment-gating-path:setup`
14. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:schedule-planner-assignment-gating-path`
15. `npm run qa:workforce:schedule-planner-assignment-gating-path:cleanup`
16. `npm run qa:workforce:schedule-row-update-or-cancel-path:setup`
17. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:schedule-row-update-or-cancel-path`
18. `npm run qa:workforce:schedule-row-update-or-cancel-path:cleanup`
19. `npm run qa:workforce:schedule-published-row-maintenance-path:setup`
20. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:schedule-published-row-maintenance-path`
21. `npm run qa:workforce:schedule-published-row-maintenance-path:cleanup`
22. `npm run qa:workforce:schedule-append-event-history-path:setup`
23. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:schedule-append-event-history-path`
24. `npm run qa:workforce:schedule-append-event-history-path:cleanup`
25. `npm run qa:workforce:schedule-planner-publish-visibility:happy-path:setup`
26. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:schedule-planner-publish-visibility:happy-path`
27. `npm run qa:workforce:schedule-planner-publish-visibility:happy-path:cleanup`
28. `npm run qa:workforce:attendance-recording:happy-path:setup`
29. perform the manual QA steps in the checklist, or run `npm run ui:test:workforce:attendance-recording:happy-path`
30. `npm run qa:workforce:attendance-recording:happy-path:cleanup`
