# Workforce Schedule Row Update Or Cancel Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-21

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can open one tagged `DRAFT` planner row in `/store/workforce/schedule-planner`, save a one-off time or note edit on that same row, then cancel it without creating a duplicate schedule row.

## Setup

1. Run `npm run qa:workforce:schedule-row-update-or-cancel-path:setup`.
2. Copy the printed worker label, range, initial window, edited window, edit note, and cancellation note from the console output.
3. Keep this scenario limited to one selected row only. Do not publish schedules in this slice.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-row-update-or-cancel-path`.
2. The browser scenario stops after the same tagged row reaches `CANCELLED`.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged active worker with linked active user
3. one tagged active template and active assignment
4. one deterministic pre-generated `WorkerSchedule(status = DRAFT)` row already visible in the seeded range

The browser flow should:

1. open the printed `/store/workforce/schedule-planner` route as `STORE_MANAGER`
2. load the printed seeded range
3. open the tagged row through the real row-level `Open` action
4. save a one-off edit through `Save one-off edit`
5. confirm `One-off schedule row updated.`
6. verify the same row still shows `DRAFT` with the edited window
7. cancel the same row through `Cancel schedule row`
8. confirm `Schedule row cancelled with event history preserved.`
9. verify the same row now shows `CANCELLED`

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed planner route.
3. Enter the printed `Range start` and `Range end`, then click `Load range`.
4. Find the printed tagged worker row and confirm it starts with:
   - the printed initial time window
   - status `DRAFT`
5. Click the row-level `Open` link.
6. In `Selected schedule`, change the start time, end time, and manager note to the printed edit values.
7. Click `Save one-off edit`.
8. Confirm the success alert `One-off schedule row updated.` appears.
9. Confirm the same row still shows `DRAFT` and now uses the printed edited time window.
10. Enter the printed cancellation note in `Cancellation note`.
11. Click `Cancel schedule row`.
12. Confirm the success alert `Schedule row cancelled with event history preserved.` appears.
13. Confirm the same row now shows `CANCELLED`.

## Expected Outcomes

1. the same `WorkerSchedule` row is updated in place, not duplicated
2. `startAt`, `endAt`, and `note` change on one-off edit
3. `status` stays `DRAFT` after the edit
4. one `MANAGER_NOTE_ADDED` event is appended for the edit
5. the same row then changes to `CANCELLED`
6. one `SCHEDULE_CANCELLED` event is appended for the cancel action
7. `templateAssignmentId` and worker linkage remain intact throughout

## Cleanup

1. Run `npm run qa:workforce:schedule-row-update-or-cancel-path:cleanup`.
2. Confirm the tagged worker, template, assignment, schedule row, and appended event history were removed.
