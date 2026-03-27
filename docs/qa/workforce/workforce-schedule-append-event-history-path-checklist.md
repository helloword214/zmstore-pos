# Workforce Schedule Append Event History Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-27

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can append one staffing event to a selected draft planner cell in `/store/workforce/schedule-planner` and immediately see the append-only entry in `Cell history`.

## Setup

1. Run `npm run qa:workforce:schedule-append-event-history-path:setup`.
2. Copy the printed worker labels, range, initial window, and event note from the console output.
3. Keep this scenario limited to one `Replacement assigned` event on one selected row only.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-append-event-history-path`.
2. The browser scenario stops after the new replacement event appears in `Cell history`.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged active worker with linked active user and one pre-generated `DRAFT` schedule row
3. one extra active worker available to choose as `Related worker`
4. zero pre-existing `ScheduleEvent` rows for the tagged schedule before the test starts

The browser flow should:

1. open the printed `/store/workforce/schedule-planner` route as `STORE_MANAGER`
2. load the printed seeded range
3. select the tagged worker-date cell from the board
4. use `Staffing activity`
5. choose `Replacement assigned`
6. choose the printed related worker
7. submit the printed event note
8. confirm `Schedule event appended to the selected row.`
9. verify the new entry appears in `Cell history`

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed planner route.
3. Enter the printed `Start` and `End` values, then click `Load`.
4. Find the printed subject worker row and confirm it starts with:
   - the printed initial time window
   - status `DRAFT`
5. Click the printed subject worker target cell.
6. Confirm the `Cell editor` opens for that worker-date and `Cell history` initially shows `No staffing events yet.`
7. In `Staffing activity`, choose:
   - `Event type`: `Replacement assigned`
   - `Related worker`: the printed related worker
   - `Event note`: the printed event note
8. Click `Append event`.
9. Confirm the success alert `Schedule event appended to the selected row.` appears.
10. Confirm the new history entry shows:
   - `REPLACEMENT_ASSIGNED`
   - the printed event note
   - `Related worker: <printed related worker>`

## Expected Outcomes

1. the same `WorkerSchedule` row remains unchanged in status and time window
2. exactly one `ScheduleEvent` row is created for that schedule
3. `eventType = REPLACEMENT_ASSIGNED`
4. `actorUserId` matches the manager
5. `subjectWorkerId` matches the selected schedule worker
6. `relatedWorkerId` matches the tagged replacement worker
7. `note` matches the submitted event note
8. no duplicate event rows are created

## Cleanup

1. Run `npm run qa:workforce:schedule-append-event-history-path:cleanup`.
2. Confirm the tagged workers, template, assignment, schedule row, and appended event history were removed.
