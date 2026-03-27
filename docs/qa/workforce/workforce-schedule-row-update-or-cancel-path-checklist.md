# Workforce Schedule Row Update Or Cancel Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-27

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can select one tagged `DRAFT` planner cell in `/store/workforce/schedule-planner`, save a custom time or note edit on that same cell, then return it to planner `BLANK` without creating a duplicate schedule row.

## Setup

1. Run `npm run qa:workforce:schedule-row-update-or-cancel-path:setup`.
2. Copy the printed worker label, range, initial window, edited window, and edit note from the console output.
3. Ignore any printed cancellation note from older setup output; the current board uses `Clear to blank` without a note field.
4. Keep this scenario limited to one selected row only. Do not publish schedules in this slice.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-row-update-or-cancel-path`.
2. The browser scenario stops after the same tagged cell returns to `BLANK`.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged active worker with linked active user
3. one tagged active template and active assignment
4. one deterministic pre-generated `WorkerSchedule(status = DRAFT)` row already visible in the seeded range

The browser flow should:

1. open the printed `/store/workforce/schedule-planner` route as `STORE_MANAGER`
2. load the printed seeded range
3. select the tagged worker-date cell from the board
4. save a custom edit through `Save custom cell`
5. confirm `Custom schedule row saved for the selected cell.`
6. verify the same cell still shows `DRAFT` with the edited window
7. clear the same cell through `Clear to blank`
8. confirm `Selected cell returned to blank.`
9. verify the same target cell now shows `BLANK`

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed planner route.
3. Enter the printed `Start` and `End` values, then click `Load`.
4. Find the printed tagged worker row and confirm it starts with:
   - the printed initial time window
   - status `DRAFT`
5. Click the printed worker target cell.
6. In `Cell editor`, choose the printed start time and end time from the dropdowns, then enter the manager note.
7. Click `Save custom cell`.
8. Confirm the success alert `Custom schedule row saved for the selected cell.` appears.
9. Confirm the same cell still shows `DRAFT` and now uses the printed edited time window.
10. Click `Clear to blank`.
11. Confirm the success alert `Selected cell returned to blank.` appears.
12. Confirm the same target cell now shows `BLANK`.
13. Note the current planner UI no longer keeps cancelled-row history visible once the cell becomes `BLANK`.

## Expected Outcomes

1. the same `WorkerSchedule` row is updated in place, not duplicated
2. `startAt`, `endAt`, and `note` change on one-off edit
3. `status` stays `DRAFT` after the edit
4. one `MANAGER_NOTE_ADDED` event is appended for the edit
5. clearing the cell changes the underlying row to `CANCELLED` and returns the board cell to `BLANK`
6. one `SCHEDULE_CANCELLED` event is appended for the clear action
7. `templateAssignmentId` and worker linkage remain intact throughout
8. current planner UI does not keep cleared-row history visible once the cell is `BLANK`

## Cleanup

1. Run `npm run qa:workforce:schedule-row-update-or-cancel-path:cleanup`.
2. Confirm the tagged worker, template, assignment, schedule row, and appended event history were removed.
