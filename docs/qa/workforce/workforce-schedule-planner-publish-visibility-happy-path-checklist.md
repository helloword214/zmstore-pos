# Workforce Schedule Planner Publish Visibility Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

This checklist is a secondary QA artifact.
It does not own scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify one manager-owned schedule planner happy path using a repeatable local QA scenario.

## Setup

1. Run `npm run qa:workforce:schedule-planner-publish-visibility:happy-path:setup`.
2. Copy the printed worker label, date range, target date, and expected time window from the console output.
3. Keep this first scenario limited to generate and publish only.

## Browser QA Steps

1. Run `npm run ui:test:workforce:schedule-planner-publish-visibility:happy-path`.
2. The browser scenario stops after the published row is confirmed in attendance review.

## Expected Scenario Shape

The setup creates:

1. one active tagged `CASHIER` worker with linked active user
2. one active weekly schedule template scoped to the default branch
3. one active template assignment for the tagged worker
4. one next-week Monday target date inside the selected planner range

The browser flow should:

1. load the seeded range in `/store/workforce/schedule-planner`
2. generate one draft row for the tagged worker
3. publish that draft row
4. confirm the same worker is visible in `/store/workforce/attendance-review` for the target date

## Manual QA Steps

1. Log in as `STORE_MANAGER`.
2. Open `/store/workforce/schedule-planner`.
3. Load the exact range printed by setup.
4. Click `Generate Draft Rows`.
5. Confirm the tagged worker appears with `DRAFT`.
6. Click `Publish Draft Rows`.
7. Confirm the tagged worker row changes to `PUBLISHED`.
8. Open `/store/workforce/attendance-review` using the printed target date.
9. Confirm the same worker appears in the attendance review list with the same time window.

## Expected Outcomes

1. exactly one `WorkerSchedule` row is created for the tagged worker and target date
2. the generated row starts as `DRAFT`
3. publish sets the row to `PUBLISHED`
4. `publishedById` and `publishedAt` are stamped on the schedule row
5. `templateAssignmentId` remains linked to the seeded assignment
6. worker role and branch linkage remain unchanged throughout
7. this first schedule scenario proves manager-side downstream visibility, not employee self-view

## Cleanup

1. Run `npm run qa:workforce:schedule-planner-publish-visibility:happy-path:cleanup`.
2. Confirm the tagged user, employee, template, assignment, and generated schedule row were removed.
