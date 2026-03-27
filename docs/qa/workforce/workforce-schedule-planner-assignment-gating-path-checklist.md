# Workforce Schedule Planner Assignment Gating Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-27

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can generate draft planner rows in `/store/workforce/schedule-planner` for one tagged worker with an `ACTIVE` template assignment while keeping one tagged worker whose matching assignment is already `ENDED` in planner `BLANK`.

## Setup

1. Run `npm run qa:workforce:schedule-planner-assignment-gating-path:setup`.
2. Copy the printed route, tagged worker labels, printed range, target generation date, and expected schedule window from the console output.
3. Keep this scenario limited to assignment-state gating only. Do not publish draft rows in this slice.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-planner-assignment-gating-path`.
2. The browser scenario stops after `Generate` proves that only the active tagged worker target cell becomes `DRAFT`.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged worker with an `ACTIVE` template assignment
3. one tagged worker with an `ENDED` template assignment on the same template pattern
4. zero active `WorkerSchedule` rows before the planner generation step

The browser flow should:

1. open the printed `/store/workforce/schedule-planner` route as `STORE_MANAGER`
2. load the printed seeded range
3. confirm both tagged worker rows already exist on the employee board
4. confirm both printed target cells start `BLANK`
5. click `Generate`
6. confirm `Draft rows generated from active template assignments.`
7. verify the active tagged worker target cell shows `DRAFT` with the printed schedule window
8. verify the ended tagged worker target cell stays `BLANK`

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed planner route.
3. Enter the printed `Start` and `End` values, then click `Load`.
4. Confirm both tagged workers appear as employee rows on the board.
5. Confirm both printed target cells start `BLANK`.
6. Click `Generate`.
7. Confirm the success alert `Draft rows generated from active template assignments.` appears.
8. Confirm the active tagged worker target cell now shows:
   - role row `CASHIER`
   - the printed schedule window
   - status `DRAFT`
9. Confirm the ended tagged worker target cell remains `BLANK`.

## Expected Outcomes

1. exactly one `WorkerSchedule` row is generated for the active-assignment worker
2. the generated row uses `entryType = WORK`
3. no `WorkerSchedule` row is generated for the ended-assignment worker
4. the generated row links to the active `templateAssignmentId`
5. the generated row remains `DRAFT`
6. no publish side effects happen in this slice

## Cleanup

1. Run `npm run qa:workforce:schedule-planner-assignment-gating-path:cleanup`.
2. Confirm the tagged workers, template, assignments, and generated schedule rows were removed.
