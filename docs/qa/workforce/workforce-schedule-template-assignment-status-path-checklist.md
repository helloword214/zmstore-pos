# Workforce Schedule Template Assignment Status Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-21

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can update one existing tagged assignment row in `/store/workforce/schedule-templates?templateId=...` from `ACTIVE` to `PAUSED`, then from `PAUSED` to `ENDED`, without creating duplicate assignments or generating worker schedules.

## Setup

1. Run `npm run qa:workforce:schedule-template-assignment-status-path:setup`.
2. Copy the printed route, tagged worker label, template name, and assignment effective-from date from the console output.
3. Keep this scenario limited to assignment status changes only.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-template-assignment-status-path`.
2. The browser scenario stops after the same tagged assignment row reaches `ENDED`.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged active worker with linked active user
3. one tagged active schedule template
4. one tagged active `ScheduleTemplateAssignment` already visible in `Current assignments`

The browser flow should:

1. open the printed `/store/workforce/schedule-templates?templateId=...` route as `STORE_MANAGER`
2. change the tagged assignment from `ACTIVE` to `PAUSED`
3. click row-level `Save`
4. confirm `Assignment status updated.`
5. verify the same row now shows `PAUSED`
6. change the same row from `PAUSED` to `ENDED`
7. click `Save` again
8. confirm the success alert again
9. verify the same row now shows `ENDED`

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed route.
3. Find the printed tagged worker row in `Current assignments`.
4. Confirm the row starts with:
   - role `CASHIER`
   - effective range `<printed date> -> open`
   - status `ACTIVE`
5. Change the row status to `Paused` and click `Save`.
6. Confirm the success alert `Assignment status updated.` appears.
7. Confirm the same row now shows `PAUSED`.
8. Change the row status to `Ended` and click `Save`.
9. Confirm the success alert appears again.
10. Confirm the same row now shows `ENDED`.

## Expected Outcomes

1. the same tagged assignment row is updated in place, not duplicated
2. `status` changes `ACTIVE -> PAUSED -> ENDED`
3. `updatedById` matches the manager actor
4. `createdById` remains the original manager actor
5. no `WorkerSchedule` rows are generated in this first slice

## Cleanup

1. Run `npm run qa:workforce:schedule-template-assignment-status-path:cleanup`.
2. Confirm the tagged assignment and any accidental generated schedule artifacts were removed.
