# Workforce Schedule Planner Assignment Gating Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-21

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can generate draft planner rows in `/store/workforce/schedule-planner` for one tagged worker with an `ACTIVE` template assignment while excluding one tagged worker whose matching assignment is already `ENDED`.

## Setup

1. Run `npm run qa:workforce:schedule-planner-assignment-gating-path:setup`.
2. Copy the printed route, tagged worker labels, printed range, target generation date, and expected schedule window from the console output.
3. Keep this scenario limited to assignment-state gating only. Do not publish draft rows in this slice.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-planner-assignment-gating-path`.
2. The browser scenario stops after `Generate Draft Rows` proves that only the active tagged worker appears in `DRAFT`.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged worker with an `ACTIVE` template assignment
3. one tagged worker with an `ENDED` template assignment on the same template pattern
4. zero `WorkerSchedule` rows before the planner generation step

The browser flow should:

1. open the printed `/store/workforce/schedule-planner` route as `STORE_MANAGER`
2. load the printed seeded range
3. click `Generate Draft Rows`
4. confirm `Draft schedule rows generated for the selected range.`
5. verify the active tagged worker appears in planner rows with `DRAFT`
6. verify the ended tagged worker does not appear in planner rows

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed planner route.
3. Enter the printed `Range start` and `Range end`, then click `Load range`.
4. Confirm neither tagged worker appears before draft generation.
5. Click `Generate Draft Rows`.
6. Confirm the success alert `Draft schedule rows generated for the selected range.` appears.
7. Confirm the active tagged worker row appears with:
   - role `CASHIER`
   - the printed schedule window
   - status `DRAFT`
8. Confirm the ended tagged worker still does not appear in planner rows.

## Expected Outcomes

1. exactly one `WorkerSchedule` row is generated for the active-assignment worker
2. no `WorkerSchedule` row is generated for the ended-assignment worker
3. the generated row links to the active `templateAssignmentId`
4. the generated row remains `DRAFT`
5. no publish side effects happen in this slice

## Cleanup

1. Run `npm run qa:workforce:schedule-planner-assignment-gating-path:cleanup`.
2. Confirm the tagged workers, template, assignments, and generated schedule rows were removed.
