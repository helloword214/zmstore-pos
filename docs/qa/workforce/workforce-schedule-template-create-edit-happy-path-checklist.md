# Workforce Schedule Template Create / Edit Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-26

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify that a store manager can create a weekly schedule template in `/store/workforce/schedule-templates`, then edit the same template’s name, role, and day pattern without creating a duplicate template.

## Setup

1. Run `npm run qa:workforce:schedule-template-create-edit:happy-path:setup`.
2. Copy the printed route, initial template name, edited template name, effective-from date, and time windows from the console output.
3. Keep this scenario limited to template create and edit only.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-template-create-edit:happy-path`.
2. The browser scenario stops after the edited template is visible in the library and selected-days panel with the updated role and day pattern.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one pre-existing tagged template already visible in the library before the test starts
3. one deterministic create payload for a Monday cashier template
4. one deterministic edit payload for a Tuesday and Thursday employee template

The browser flow should:

1. open `/store/workforce/schedule-templates` as `STORE_MANAGER`
2. keep the page in blank `Create Template` mode even while the pre-existing library row is visible
3. create the initial tagged template
4. confirm `Schedule template saved.`
5. verify the library row shows `CASHIER · 1 work day(s)`
6. edit the same template into the printed employee-scoped two-day pattern
7. confirm `Schedule template saved.` again
8. verify the edited library row and selected-days panel both reflect the new template state while the pre-existing library row stays untouched

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed route.
3. Confirm the printed pre-existing template is already visible in the library while the main form still shows `Create Template`.
4. Create the printed initial template name with:
   - role scope `Cashier`
   - one enabled day: Monday
   - the printed initial time window
5. Save the template and confirm the success alert appears.
6. Confirm the library row shows `CASHIER · 1 work day(s)`.
7. Edit the same template so it uses the printed edited template name with:
   - role scope `Employee`
   - enabled days `Tuesday` and `Thursday`
   - the printed edited time window
8. Save again and confirm the success alert appears.
9. Confirm the old template name no longer appears in the library.
10. Confirm the pre-existing library row still appears unchanged.
11. Confirm the selected template days panel now shows only Tuesday and Thursday with the edited time window and note.

## Expected Outcomes

1. exactly two tagged `ScheduleTemplate` rows exist for this family: one untouched pre-existing template plus one created-and-edited template
2. `branchId` stays `null` because the current live UI does not set branch on template create or edit
3. `status` stays `ACTIVE`
4. `createdById` and `updatedById` both match the manager actor
5. the created template gets its own row instead of overwriting the pre-existing template
6. the template day rows are replaced on edit instead of duplicating the template
7. clicking `New template` returns to the blank create lane instead of silently re-opening another template
8. no `ScheduleTemplateAssignment` rows are created in this first slice

## Cleanup

1. Run `npm run qa:workforce:schedule-template-create-edit:happy-path:cleanup`.
2. Confirm the tagged template and any accidental assignment or generated schedule artifacts were removed.
