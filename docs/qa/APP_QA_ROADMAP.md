# App QA Roadmap

Status: DRAFT
Owner: POS Platform
Last Reviewed: 2026-03-19

This roadmap is a supporting plan for rebuilding QA around current app behavior.
It does not override canonical guide docs, QA architecture rules, or automation runbooks.

## Refer To

1. `docs/qa/APP_QA_FLOW_REGISTRY.md`
2. `docs/Governance SOP/QA Testing Architecture Standard.md`
3. `docs/guide/README.md`
4. `docs/automation/runbooks/README.md`

## Goal

Replace outdated role-driven and shell-only browser checks with scenario families that follow the real operational flow of the app today.

## Delivery Rule

Build QA in scenario families, not as isolated tests.

Each critical flow should eventually have:

1. one named setup artifact
2. one named cleanup artifact
3. one named browser spec
4. one named manual checklist
5. links back to the canonical business owner docs

## Definition Of Done Per Scenario Family

A flow should not be called ready until all of these are true:

1. the flow exists in `APP_QA_FLOW_REGISTRY.md`
2. the flow links to the correct owner canonical guide docs
3. setup is narrow, traceable, and reversible
4. cleanup removes only scenario-created data
5. the checklist describes the expected happy path and visible outcomes
6. the browser spec verifies the same named scenario
7. current legacy coverage is labeled `keep`, `rewrite`, `retire`, or `missing`

## Phase Plan

### Phase 0 - Registry And Triage

Focus:

1. complete the initial flow inventory
2. map every known legacy QA artifact to a live flow or retire queue
3. choose one first scenario family per critical domain

Exit criteria:

1. no critical flow is missing an owner-doc link
2. no existing Playwright group is left unlabeled
3. first implementation order is explicit

### Phase 1 - Foundation Auth And Access

Focus:

1. login with OTP
2. session persistence
3. logout and protected-route behavior
4. role-based landing and access routing

Target families:

1. `auth-login-otp-session`
2. `auth-role-routing`

Exit criteria:

1. auth scenario family exists and matches current OTP behavior
2. post-login role routing is verified through the live app flow
3. old role auth setup tests are either rewritten or clearly demoted to helper-only support

### Phase 2 - P0 Operational And Money-Risk Flows

Focus:

1. cashier shift open and close lifecycle
2. payroll draft, rebuild, finalize, and paid path
3. product admin happy path for sellable catalog maintenance
4. delivery run handoff and remit access points that directly affect operational completion

Target families:

1. `cashier-shift-open-close`
2. `payroll-run-happy-path`
3. `product-catalog-admin-happy-path`
4. `delivery-run-handoff-and-remit-access`

Exit criteria:

1. each target flow has a named scenario family
2. each flow has a stable setup and cleanup path
3. shell-only legacy route checks are no longer the primary regression signal for these flows

### Phase 3 - P1 Planning And Admin Flows

Focus:

1. schedule publish and visibility
2. admin user, role, and branch access maintenance through the live employee admin surfaces
3. any remaining manager-side setup pages that gate workforce or product operations

Target families:

1. `schedule-publish-and-visibility`
2. employee admin access cluster reconciliation across onboarding, account management, profile edit, and role switch

Exit criteria:

1. schedule and admin flows are represented by real scenario families
2. role and branch boundary checks are tied to current identity rules, even when the live app exposes them through employee admin routes instead of a separate admin-only maintenance page

### Phase 4 - Edge Cases, Recovery, And Secondary Monitors

Focus:

1. validation errors
2. recovery after partial progress
3. session expiry or forced re-entry
4. visual-baseline coverage that remains useful after happy-path families are stable

Exit criteria:

1. edge cases are added only after the matching happy-path family is stable
2. any retained visual or smoke monitors are clearly marked as secondary coverage

## Recommended Current Order

Use this implementation order unless a production issue forces reprioritization:

1. `auth-login-otp-session`
2. `auth-role-routing`
3. `payroll-run-happy-path`
4. `cashier-shift-open-close`
5. `product-catalog-admin-happy-path`
6. `schedule-publish-and-visibility`
7. employee admin access cluster reconciliation
8. `delivery-run-handoff-and-remit-access`

## WIP Control Rule

To keep the rollout scalable:

1. build one happy-path scenario family at a time
2. close setup and cleanup design before expanding assertions
3. do not start edge-case automation for a flow that does not yet have a stable happy-path family
