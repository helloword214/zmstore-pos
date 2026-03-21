# Workforce Schedule Published Row Maintenance Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-21

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can open one tagged `PUBLISHED` planner row in `/store/workforce/schedule-planner`, save a one-off edit on that same row, then cancel it while preserving event history on the same schedule record.

## Setup

1. Run `npm run qa:workforce:schedule-published-row-maintenance-path:setup`.
2. Copy the printed worker label, range, initial window, edited window, edit note, and cancellation note from the console output.
3. Keep this scenario limited to one selected published row only.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-published-row-maintenance-path`.
2. The browser scenario stops after the same tagged row reaches `CANCELLED`.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged active worker with linked active user
3. one tagged active template and active assignment
4. one deterministic pre-generated `WorkerSchedule(status = PUBLISHED)` row already visible in the seeded range

The browser flow should:

1. open the printed `/store/workforce/schedule-planner` route as `STORE_MANAGER`
2. load the printed seeded range
3. open the tagged published row through the real row-level `Open` action
4. save a one-off edit through `Save one-off edit`
5. confirm `One-off schedule row updated.`
6. verify the same row still shows `PUBLISHED` with the edited window
7. confirm event history now includes the `MANAGER_NOTE_ADDED` entry for the edit
8. cancel the same row through `Cancel schedule row`
9. confirm `Schedule row cancelled with event history preserved.`
10. verify the same row now shows `CANCELLED`
11. confirm event history still shows the earlier edit entry plus the new `SCHEDULE_CANCELLED` entry

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed planner route.
3. Enter the printed `Range start` and `Range end`, then click `Load range`.
4. Find the printed tagged worker row and confirm it starts with:
   - the printed initial time window
   - status `PUBLISHED`
5. Click the row-level `Open` link.
6. Confirm `No schedule events yet.` is visible.
7. In `Selected schedule`, change the start time, end time, and manager note to the printed edit values.
8. Click `Save one-off edit`.
9. Confirm the success alert `One-off schedule row updated.` appears.
10. Confirm the same row still shows `PUBLISHED` and now uses the printed edited time window.
11. Confirm event history shows a `MANAGER_NOTE_ADDED` entry that includes the printed edit note.
12. Enter the printed cancellation note in `Cancellation note`.
13. Click `Cancel schedule row`.
14. Confirm the success alert `Schedule row cancelled with event history preserved.` appears.
15. Confirm the same row now shows `CANCELLED`.
16. Confirm event history shows a `SCHEDULE_CANCELLED` entry with the printed cancellation note.

## Expected Outcomes

1. the same `WorkerSchedule` row is updated in place, not duplicated
2. `startAt`, `endAt`, and `note` change on one-off edit while `status` remains `PUBLISHED`
3. one `MANAGER_NOTE_ADDED` event is appended for the edit
4. the same row then changes to `CANCELLED`
5. one `SCHEDULE_CANCELLED` event is appended for the cancel action
6. `publishedById`, `publishedAt`, `templateAssignmentId`, and worker linkage remain intact throughout

## Cleanup

1. Run `npm run qa:workforce:schedule-published-row-maintenance-path:cleanup`.
2. Confirm the tagged worker, template, assignment, schedule row, and appended event history were removed.
