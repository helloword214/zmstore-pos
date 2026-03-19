# App QA Flow Registry

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

This document is the owner doc for repository-level QA flow inventory.
It records which real app flows are in scope, how they map to current QA coverage, and what should happen to legacy automation assets.

This document does not own business rules.
Canonical guide docs remain the binding authority for product, payroll, schedule, identity, delivery, cashier, and AR behavior.

## Purpose

Create one scalable inventory for app QA work so new browser automation and manual QA are rebuilt from current business flows instead of from outdated role or screenshot suites.

## Scope

This registry applies to repository-level QA planning for real app flows, including:

1. auth and OTP
2. role routing and access boundaries
3. admin and product maintenance flows
4. payroll flows
5. schedule flows
6. cashier and delivery handoff flows

## Owns

This document owns:

1. the list of tracked app QA flows at the repository level
2. the required metadata fields for each tracked flow
3. the disposition vocabulary for existing QA coverage
4. the readiness vocabulary for scenario-family rollout
5. the initial priority grouping used by QA planning

## Does Not Own

This document does not own:

1. business rules or state machines for any product domain
2. QA artifact naming or folder structure rules
3. automation execution runbooks or command contracts
4. route or module authority

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/README.md`
3. `docs/automation/runbooks/README.md`
4. `docs/qa/APP_QA_ROADMAP.md`

## Registry Use Rule

Use this registry in this order:

1. identify the real flow currently used in the app
2. link that flow to its owner canonical guide doc
3. map current QA coverage to the flow
4. label the current coverage as `keep`, `rewrite`, `retire`, or `missing`
5. only promote the flow to regression-ready after a scenario family exists

## Flow Record Fields

Each tracked flow should define at least:

1. `flowId`: stable QA identifier for the flow
2. `priority`: current rollout tier such as `foundation`, `P0`, `P1`, or `later`
3. `domain`: concern area such as auth, payroll, schedule, product, cashier, or delivery
4. `actor`: user role or system actor performing the flow
5. `trigger`: the user action that starts the flow
6. `preconditions`: minimum state required before QA starts
7. `expected result`: the business-visible outcome to verify
8. `owner docs`: canonical guide docs that own the business rules
9. `current coverage`: existing repo artifacts that partially or fully touch the flow
10. `disposition`: `keep`, `rewrite`, `retire`, or `missing`
11. `readiness`: current scenario-family readiness
12. `next move`: the next QA delivery step needed for the flow

## Disposition Vocabulary

Use these labels consistently:

1. `keep`: the existing artifact is still useful and should remain in service, even if it becomes secondary coverage
2. `rewrite`: the flow is still valid, but the current artifact shape no longer matches live app behavior
3. `retire`: the current artifact should be removed after a replacement or explicit de-scope decision
4. `missing`: no meaningful current coverage exists for the flow

## Readiness Vocabulary

Use these rollout states:

1. `inventory-only`: flow is listed but not yet broken into a scenario family
2. `mapped`: owner docs, current coverage, and next move are clear
3. `manual-family-ready`: setup, cleanup, and checklist are defined for manual QA
4. `scenario-family-ready`: setup, cleanup, checklist, and browser spec are defined
5. `regression-ready`: the flow is stable enough to run as repeatable regression coverage

## Initial App QA Flow Inventory

| flowId | priority | domain | actor | trigger | owner docs | current coverage | disposition | readiness | next move |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `auth-login-otp-session` | `foundation` | auth | manager, rider, cashier, admin | submit login credentials and complete OTP | `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md` | canonical coverage is now `tests/ui/auth/auth-login-otp-session.spec.ts`; retired legacy artifacts were `tests/ui/auth.manager.setup.ts`, `tests/ui/auth.rider.setup.ts`, `tests/ui/auth.cashier.setup.ts`, and `tests/ui/helpers/auth.ts` | `keep` | `scenario-family-ready` | extend the auth family to the remaining role lanes only after the manager path is validated in routine QA |
| `auth-role-routing` | `foundation` | auth | manager, rider, cashier, admin | land on role home after authenticated entry | `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md` | canonical coverage is now `tests/ui/auth/auth-role-routing.spec.ts`; legacy visual route checks remain in `tests/ui/*.golden-reference.spec.ts` as secondary coverage pending review | `keep` | `scenario-family-ready` | extend the role-routing matrix with additional representative protected routes before deciding whether any legacy visual route checks should remain |
| `product-catalog-admin-happy-path` | `P0` | product | admin or manager | create, edit, and activate or deactivate a sellable product | `docs/guide/CANONICAL_PRODUCTLIST_SHAPE_SOT.md`, `docs/guide/CANONICAL_ORDER_PRICING_SOT.md` | no dedicated scenario family found in current QA docs or Playwright suites | `missing` | `inventory-only` | define one product admin scenario family with setup, cleanup, checklist, and browser spec |
| `payroll-run-happy-path` | `P0` | payroll | store manager | create payroll draft, rebuild lines, finalize, and stop at finalized state for the canonical happy path | `docs/guide/CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md`, `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md` | `scripts/qa/workforce/workforce-payroll-happy-path-setup.ts`, `scripts/qa/workforce/workforce-payroll-happy-path-cleanup.ts`, `docs/qa/workforce/workforce-payroll-happy-path-checklist.md`, `tests/ui/workforce/workforce-payroll-happy-path-fixture.ts`, `tests/ui/workforce/workforce-payroll-happy-path.spec.ts` | `keep` | `scenario-family-ready` | validate the finalized-state happy path in routine QA, then decide whether `mark-paid` stays inside this flow or becomes a separate scenario family |
| `schedule-publish-and-visibility` | `P1` | schedule | manager or planner | create or publish a worker schedule and confirm downstream visibility | `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md` | no dedicated scenario family found in current QA docs or Playwright suites | `missing` | `inventory-only` | define one schedule scenario family rooted in current publish and visibility rules |
| `cashier-shift-open-close` | `P0` | cashier | cashier and store manager | manager opens shift, cashier accepts and submits count, then manager final-closes | `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md` | canonical coverage is now `tests/ui/cashier/cashier-shift-open-close-happy-path.spec.ts`; legacy visual route checks remain in `tests/ui/cashier.golden-reference.spec.ts` as secondary coverage pending review | `keep` | `scenario-family-ready` | extend cashier coverage with dispute and shortage decision lanes after the no-variance close path is stable |
| `delivery-run-handoff-and-remit-access` | `P0` | delivery | manager, rider, cashier | move through checked-in and closed run access points needed by remit and handoff work | `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`, `docs/guide/RIDER_SHORTAGE_WORKFLOW.md` | `tests/automation/business-flow/*.flow.smoke.spec.ts`, `playwright.business-flow.config.ts`, manager route snapshots using `UI_RUN_ID` | `rewrite` | `mapped` | keep context-driven setup, then add one true happy-path scenario per role before expanding smoke coverage |
| `admin-user-role-branch-access` | `P1` | admin | admin | create or update access-bearing user records and confirm branch or role boundaries | `docs/guide/CANONICAL_IDENTITY_ACCESS_FLOW.md` | no dedicated scenario family found in current QA docs or Playwright suites | `missing` | `inventory-only` | define one admin access scenario family after auth foundation is stable |

## Current Legacy Coverage Groups

The current repo already contains these broad QA groups:

1. role-oriented auth setup and golden-reference specs under `tests/ui/`
2. deterministic delivery route smoke checks under `tests/automation/business-flow/`
3. one workforce manual scenario family under `scripts/qa/workforce/` and `docs/qa/workforce/`

These groups should be treated as migration input, not as the final QA structure for live app operations.
