# Workforce Schedule Published Row Maintenance Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-27

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can select one tagged `PUBLISHED` planner cell in `/store/workforce/schedule-planner`, save a custom edit on that same cell, then return it to planner `BLANK` while preserving the underlying schedule record history.

## Setup

1. Run `npm run qa:workforce:schedule-published-row-maintenance-path:setup`.
2. Copy the printed worker label, range, initial window, edited window, and edit note from the console output.
3. Keep this scenario limited to one selected published row only.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-published-row-maintenance-path`.
2. The browser scenario stops after the same tagged cell returns to `BLANK`.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged active worker with linked active user
3. one tagged active template and active assignment
4. one deterministic pre-generated `WorkerSchedule(status = PUBLISHED)` row already visible in the seeded range

The browser flow should:

1. open the printed `/store/workforce/schedule-planner` route as `STORE_MANAGER`
2. load the printed seeded range
3. select the tagged published worker-date cell from the board
4. save a custom edit through `Save custom cell`
5. confirm `Custom schedule row saved for the selected cell.`
6. verify the same cell still shows `PUBLISHED` with the edited window
7. confirm `Cell history` now includes the `MANAGER_NOTE_ADDED` entry for the edit
8. clear the same cell through `Clear to blank`
9. confirm `Selected cell returned to blank.`
10. verify the same target cell now shows `BLANK`

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed planner route.
3. Enter the printed `Start` and `End` values, then click `Load`.
4. Find the printed tagged worker row and confirm it starts with:
   - the printed initial time window
   - status `PUBLISHED`
5. Click the printed worker target cell.
6. Confirm `Cell history` initially shows `No staffing events yet.`
7. In `Cell editor`, choose the printed start time and end time from the dropdowns, then enter the manager note.
8. Click `Save custom cell`.
9. Confirm the success alert `Custom schedule row saved for the selected cell.` appears.
10. Confirm the same cell still shows `PUBLISHED` and now uses the printed edited time window.
11. Confirm `Cell history` shows a `MANAGER_NOTE_ADDED` entry that includes the printed edit note.
12. Click `Clear to blank`.
13. Confirm the success alert `Selected cell returned to blank.` appears.
14. Confirm the same target cell now shows `BLANK`.
15. Note the current planner UI no longer keeps cancelled-row history visible once the cell becomes `BLANK`.

## Expected Outcomes

1. the same `WorkerSchedule` row is updated in place, not duplicated
2. `startAt`, `endAt`, and `note` change on one-off edit while `status` remains `PUBLISHED`
3. one `MANAGER_NOTE_ADDED` event is appended for the edit
4. clearing the cell changes the underlying row to `CANCELLED` and returns the board cell to `BLANK`
5. one `SCHEDULE_CANCELLED` event is appended for the clear action
6. `publishedById`, `publishedAt`, `templateAssignmentId`, and worker linkage remain intact throughout
7. current planner UI does not keep cleared-row history visible once the cell is `BLANK`

## Cleanup

1. Run `npm run qa:workforce:schedule-published-row-maintenance-path:cleanup`.
2. Confirm the tagged worker, template, assignment, schedule row, and appended event history were removed.
