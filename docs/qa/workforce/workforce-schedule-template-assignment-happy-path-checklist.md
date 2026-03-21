# Workforce Schedule Template Assignment Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can assign one tagged active worker to one tagged active weekly template in `/store/workforce/schedule-templates`, and that the assignment appears in `Current assignments` without generating worker schedule rows yet.

## Setup

1. Run `npm run qa:workforce:schedule-template-assignment:happy-path:setup`.
2. Copy the printed route, tagged worker label, template name, and assignment effective-from date from the console output.
3. Keep this scenario limited to template assignment only.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-template-assignment:happy-path`.
2. The browser scenario stops after the tagged worker appears in `Current assignments` with `ACTIVE` status.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged active worker with linked active user
3. one tagged active schedule template with a deterministic weekday pattern
4. zero tagged assignments before the test starts

The browser flow should:

1. open the printed `/store/workforce/schedule-templates?templateId=...` route as `STORE_MANAGER`
2. select the printed tagged worker in the assignment form
3. fill the printed assignment effective-from date
4. submit `Assign selected workers`
5. confirm `Workers assigned to template.`
6. verify the tagged worker appears in `Current assignments`

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed route.
3. Confirm `No worker assignments yet.` is visible before the action.
4. Check the printed tagged worker in the assignment form.
5. Fill the printed assignment effective-from date.
6. Click `Assign selected workers`.
7. Confirm the success alert `Workers assigned to template.` appears.
8. Confirm the tagged worker appears in `Current assignments`.
9. Confirm the row shows:
   - worker label
   - role `CASHIER`
   - effective range `<printed date> -> open`
   - status `ACTIVE`

## Expected Outcomes

1. exactly one tagged `ScheduleTemplateAssignment` exists for this family
2. `status` is `ACTIVE`
3. `templateId` matches the tagged template
4. `workerId` matches the tagged worker
5. `createdById` and `updatedById` both match the manager actor
6. no duplicate assignment rows are created
7. no `WorkerSchedule` rows are generated in this first slice

## Cleanup

1. Run `npm run qa:workforce:schedule-template-assignment:happy-path:cleanup`.
2. Confirm the tagged assignment and any accidental generated schedule artifacts were removed.
