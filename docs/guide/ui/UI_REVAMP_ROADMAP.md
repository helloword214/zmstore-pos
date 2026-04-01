# UI Revamp Roadmap

Status: ACTIVE
Owner: POS Platform
Last Updated: 2026-04-01

## 1. Purpose

Own the April 2026 UI/UX revamp rollout plan for active operator-facing routes so the team has one working map for sequencing, monthly completion tracking, and end-of-wave summaries.

This roadmap is docs-only planning and tracking.
It does not change business logic by itself.

## 2. Scope

This roadmap applies to active UI surfaces already covered by the UI guide stack.

Primary focus for this month:

1. remove generic-feel layout drift across route families
2. make loading, empty, locked, and pending states explicit
3. keep route-family hierarchy consistent with `UI_SOT.md`
4. finish route-family revamp one wave at a time
5. summarize completed work without keeping the active tracker bloated

Out of scope:

1. business-flow rule changes
2. cleanup-only typing/log objectives
3. monitor automation execution mechanics
4. action-only routes that do not expose a user-facing screen

## 3. Owns

This document owns:

1. monthly UI/UX revamp sequencing
2. the active wave board for this campaign
3. the active route tracker for this campaign
4. route-level done criteria for this campaign
5. wave-complete summary rules
6. the rule for removing finished routes from the active tracker

## 4. Does Not Own

This document does not own:

1. visual/token/layout rules -> `docs/guide/ui/UI_SOT.md`
2. route-level baseline notes and conformance detail -> `docs/guide/ui/UI_CONFORMANCE_MATRIX.md`
3. cleanup-only `any` / `console.log` tracking -> `docs/guide/ui/ROUTE_CLEANUP_CHECKLIST.md`
4. canonical business behavior -> owner docs in `docs/guide/README.md`
5. automation run commands and monitor flow -> `docs/automation/runbooks/`

## 5. Refer To

1. `docs/guide/ui/UI_SOT.md`
2. `docs/guide/ui/UI_CONFORMANCE_MATRIX.md`
3. `docs/guide/ui/ROUTE_CLEANUP_CHECKLIST.md`
4. `docs/guide/ui/UI_AUTOMATION_GUIDE.md`
5. `docs/guide/README.md`

## 6. April 2026 Objective

Finish a full-route UI/UX revamp map for active screens this month, using one active wave at a time.

Execution intent:

1. keep one working roadmap instead of scattered per-route notes
2. keep route-level conformance detail in the matrix
3. keep the active tracker short by removing finished routes only after they are summarized
4. close the month with a final summary instead of a permanently huge in-progress list

## 7. Status Legend

Roadmap status in this file is not the same thing as conformance status in `UI_CONFORMANCE_MATRIX.md`.

Use these roadmap statuses:

1. `QUEUE`: route is in the roadmap but not in the current batch
2. `ACTIVE`: route is in the current working batch
3. `REVIEW`: route patch is complete and waiting for final operator/QA confirmation before removal from the active tracker
4. `PARKED`: route is intentionally deferred for a stated reason

`DONE` is not meant to stay in the active tracker.
Once a route is done, move it to the completion summary and remove it from the active wave table.

## 8. Route Done Criteria

A route may leave the active tracker only when all of these are true:

1. the route matches its target family contract from `UI_SOT.md`
2. the primary action is obvious in the first working viewport
3. loading, empty, locked, and pending states are explicit
4. repeated helper text has been trimmed to the current noise budget
5. shared SoT primitives were used or extracted when the pattern repeated
6. desktop and mobile fit were reviewed for the changed surface on a confirmed runtime target, per `docs/Governance SOP/QA Testing Architecture Standard.md`
7. `UI_CONFORMANCE_MATRIX.md` was updated in the same objective
8. docs impact was reported in the task summary

## 9. Wave Done Criteria

A wave is done only when:

1. every route in the wave has been removed from the active tracker as completed, or marked `PARKED` with a reason
2. one concise wave summary has been added to the completion log
3. `UI_CONFORMANCE_MATRIX.md` reflects the final route notes for that wave
4. the next active wave is named explicitly, or the month is marked complete

## 10. Removal And Summary Rule

When a route is finished:

1. do not silently delete it from the active tracker
2. first add a one-line completion entry to the summary log
3. then remove it from the active route table
4. keep the route's lasting conformance note in `UI_CONFORMANCE_MATRIX.md`

When a wave is finished:

1. add a short wave rollup summary
2. remove finished route rows from the active wave table
3. keep only unfinished or parked rows visible in the active board

At month close:

1. replace the active wave board with the final monthly summary if no active work remains
2. archive or retire this roadmap only in a separate cleanup objective after the summary is preserved

## 11. Shared Foundation Track

These are shared revamp items that affect many routes and should be handled before or alongside route waves.

| Shared item | Status | Notes |
| --- | --- | --- |
| App-shell transition loading | ACTIVE | shell-level route handoff loading remains part of the revamp baseline; current direction is a simpler app-shell loading bar plus route-aware label/hint instead of route-transition skeleton previews |
| Empty-state clarity | QUEUE | standardize empty-state guidance before final wave closeout |
| Locked and pending-state language | QUEUE | keep state wording consistent across manager, cashier, rider, and admin lanes |
| Route-family density audit | QUEUE | final month pass should remove remaining generic-feel repetition and over-dense helper text |

## 12. Wave Board

Only one wave should be `ACTIVE` at a time unless an explicit parallel objective is approved.

### Wave 0 - Foundation, Dashboards, And Auth

Goal:

1. finish the top-level visual language and the role-entry surfaces first

| Route | Family | Status | Current focus |
| --- | --- | --- | --- |
| `app/routes/_index.tsx` | Dashboard | ACTIVE | admin launchpad hierarchy and entry clarity |
| `app/routes/store._index.tsx` | Dashboard | ACTIVE | manager control-tower hierarchy and non-generic first viewport |
| `app/routes/cashier._index.tsx` | Dashboard | ACTIVE | shift-first focus and quiet reference balance |
| `app/routes/rider._index.tsx` | Dashboard | ACTIVE | do-now task board clarity and reduced helper noise |
| `app/routes/login.tsx` | Public / Auth | ACTIVE | auth screen clarity, wait states, and non-generic public entry feel |

### Wave 1 - Operational List / Inbox

Goal:

1. make queue surfaces scan-first and table-first

| Route | Family | Status | Current focus |
| --- | --- | --- | --- |
| `app/routes/customers._index.tsx` | Operational List / Inbox | QUEUE | customer directory scan rhythm and toolbar clarity |
| `app/routes/store.dispatch.tsx` | Operational List / Inbox | QUEUE | triage strip priority and dense exception fit |
| `app/routes/runs._index.tsx` | Operational List / Inbox | ACTIVE | actionable inbox default, optional terminal history mode, low-noise load-more scaling, mobile action-card parity with the desktop table, and no duplicate create entry outside dispatch |
| `app/routes/store.clearance.tsx` | Operational List / Inbox | QUEUE | inbox triage clarity and tab/filter density |
| `app/routes/cashier.delivery._index.tsx` | Operational List / Inbox | QUEUE | remit queue scan rhythm and state summary clarity |
| `app/routes/ar._index.tsx` | Operational List / Inbox | QUEUE | receivable triage and compact severity cues |
| `app/routes/rider.variances.tsx` | Operational List / Inbox | QUEUE | rider pending-review clarity and mobile fit |

### Wave 2 - Console / Workspace

Goal:

1. keep one dominant workbench per operator lane

| Route | Family | Status | Current focus |
| --- | --- | --- | --- |
| `app/routes/pad-order._index.tsx` | Console / Workspace | QUEUE | product-search rhythm and cart workbench focus |
| `app/routes/cashier.shift.tsx` | Console / Workspace | QUEUE | current-state strip, workbench dominance, and exception placement |
| `app/routes/store.cashier-shifts.tsx` | Console / Workspace | QUEUE | manager shift console hierarchy and row-summary density |
| `app/routes/store.payroll.tsx` | Console / Workspace | QUEUE | blocker-first payroll workbench and detail density audit |
| `app/routes/cashier.pos._index.tsx` | Console / Workspace | QUEUE | walk-in queue focus and fast-action rhythm |

### Wave 3 - Decision / Detail / Settlement

Goal:

1. put decision context and action confidence above dense evidence

| Route | Family | Status | Current focus |
| --- | --- | --- | --- |
| `app/routes/runs.new.tsx` | Decision / Detail | QUEUE | creation framing and submit-state clarity |
| `app/routes/runs.$id.dispatch.tsx` | Decision / Detail | ACTIVE | assignment first, one shared load-plan workbench for linked orders plus extra loadout, and a dispatch-only editable action lane |
| `app/routes/runs.$id.summary.tsx` | Decision / Detail | QUEUE | quiet reference hierarchy, recap clarity, and route-aware shell-level handoff loading |
| `app/routes/runs.$id.rider-checkin.tsx` | Decision / Detail | QUEUE | dense receipt flow clarity, action-state consistency, and route-aware shell-level handoff loading |
| `app/routes/store.clearance_.$caseId.tsx` | Decision / Detail | QUEUE | decision framing and evidence/action ordering |
| `app/routes/store.clearance-opening-batches.tsx` | Decision / Detail | QUEUE | batch summary-first review flow |
| `app/routes/runs.$id.remit.tsx` | Decision / Detail | QUEUE | remit action hierarchy and dense evidence compression |
| `app/routes/cashier.delivery.$runId.tsx` | Decision / Detail | QUEUE | hub hierarchy and remit-row scan rhythm |
| `app/routes/delivery-remit.$id.tsx` | Decision / Detail | QUEUE | cashier order decision framing and settlement clarity |
| `app/routes/cashier.$id.tsx` | Decision / Detail | QUEUE | settlement decision confidence and payment-side guidance compression |
| `app/routes/ar.customers.$id.tsx` | Decision / Detail | QUEUE | ledger action framing and activity-row readability |
| `app/routes/rider.variance.$id.tsx` | Decision / Detail | QUEUE | acceptance confidence and evidence ordering |

### Wave 4 - Admin Form / Library

Goal:

1. keep forms and maintenance tables central while support notes stay quiet

| Route | Family | Status | Current focus |
| --- | --- | --- | --- |
| `app/routes/customers.new.tsx` | Admin Form / Library | QUEUE | create flow rhythm and map/address support density |
| `app/routes/customers.$id.tsx` | Admin Form / Library | QUEUE | profile quietness and summary density |
| `app/routes/customers.$id_.edit.tsx` | Admin Form / Library | QUEUE | edit-task framing and field-group rhythm |
| `app/routes/customers.$id_.pricing.tsx` | Admin Form / Library | QUEUE | pricing library readability and action hierarchy |
| `app/routes/customers.$id_.pricing_.$ruleId.tsx` | Admin Form / Library | QUEUE | rule edit clarity and save/delete emphasis |
| `app/routes/creation._index.tsx` | Admin Form / Library | QUEUE | tabbed library focus and list/tool noise reduction |
| `app/routes/creation.riders.tsx` | Admin Form / Library | QUEUE | create/edit collapse rhythm and row-action stability |
| `app/routes/creation.vehicles.tsx` | Admin Form / Library | QUEUE | toolbar/form/table balance |
| `app/routes/creation.provinces.tsx` | Admin Form / Library | QUEUE | compact maintenance rhythm and search/form parity |
| `app/routes/creation.areas.tsx` | Admin Form / Library | QUEUE | hierarchy navigation density and workspace clarity |
| `app/routes/creation.opening-ar-batches.tsx` | Admin Form / Library | QUEUE | encode flow density and staged-row clarity |
| `app/routes/products._index.tsx` | Admin Form / Library | QUEUE | filter density and result framing |
| `app/routes/products.new.tsx` | Admin Form / Library | QUEUE | create-route focus and helper-text restraint |
| `app/routes/products.$productId.tsx` | Admin Form / Library | QUEUE | detail emphasis and operations demotion |
| `app/routes/products.$productId.edit.tsx` | Admin Form / Library | QUEUE | edit hierarchy and shared-form calmness |

### Wave 5 - Review / Tagging / Exception Lanes

Goal:

1. finish the smaller decision-heavy lanes and close the month with parity

| Route | Family | Status | Current focus |
| --- | --- | --- | --- |
| `app/routes/store.cashier-variances.tsx` | Review / Exception Lane | QUEUE | queue framing and evidence disclosure clarity |
| `app/routes/cashier.charges.tsx` | Review / Exception Lane | QUEUE | two-lane detail hierarchy and close-action clarity |
| `app/routes/store.cashier-ar.tsx` | Review / Exception Lane | QUEUE | tagging rhythm and plan-note compression |
| `app/routes/store.rider-variances.tsx` | Review / Exception Lane | QUEUE | decision-wording calmness and review density |
| `app/routes/store.rider-charges.tsx` | Review / Exception Lane | QUEUE | tagging clarity and payroll-plan note restraint |

## 13. Completion Summary Log

Use this section to summarize finished routes and waves after they leave the active board.

Current state:

1. no route has been closed out in this roadmap yet
2. existing baseline alignment history remains in `UI_CONFORMANCE_MATRIX.md`

Recommended log format:

1. date
2. wave
3. route or route group
4. short completion summary
5. PR / merge trace once available

## 14. Month-Close Summary Slot

When April 2026 closes, replace this placeholder with:

1. total routes completed
2. parked routes and reasons
3. shared foundation items completed
4. remaining UI/UX risks
5. next-cycle recommendation if another month is needed
