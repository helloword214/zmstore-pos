# Workforce Attendance Recording Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-21

This checklist is a secondary QA artifact.
It does not own worker scheduling behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`
3. `docs/guide/CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md`

## Purpose

Verify that a store manager can open `/store/workforce/attendance-review` for one tagged published schedule row and record a clean `WORK_DAY + WHOLE_DAY + REGULAR` attendance fact without changing the published schedule row or creating schedule-event side effects.

## Setup

1. Run `npm run qa:workforce:attendance-recording:happy-path:setup`.
2. Copy the printed worker label, duty date, planned window, and attendance note from the console output.
3. Keep this scenario limited to one tagged worker and one published schedule row.

## Browser QA Steps

1. Run `npm run ui:test:workforce:attendance-recording:happy-path`.
2. The browser scenario stops after the tagged worker shows the saved attendance state.

## Expected Scenario Shape

The setup creates:

1. one active `STORE_MANAGER` actor
2. one tagged active worker with linked active user
3. one tagged active template and active assignment
4. one deterministic `WorkerSchedule(status = PUBLISHED)` row for the printed duty date
5. one active employee pay profile so attendance duty result snapshotting can succeed
6. no preexisting attendance result for the tagged worker and date

The browser flow should:

1. open the printed `/store/workforce/attendance-review?date=...&workerId=...` route as `STORE_MANAGER`
2. confirm the tagged worker row shows the planned row and `Not recorded yet`
3. save attendance with:
   - `Day type = WORK_DAY`
   - `Attendance result = WHOLE_DAY`
   - `Work context = REGULAR`
   - `Late flag = NO`
   - the printed manager note
4. confirm `Attendance record saved.`
5. verify the worker row now shows `WHOLE_DAY`
6. verify the row detail now shows `WORK_DAY · REGULAR`

## Manual QA Steps

1. Log in as the printed manager.
2. Open the printed attendance review route.
3. Confirm the tagged worker row shows:
   - the printed planned window
   - `Scheduled`
   - `Not recorded yet`
4. Confirm the selected worker panel shows `Planned row: <printed window>`.
5. In the attendance form, choose:
   - `Day type = Work day`
   - `Attendance result = Whole day`
   - `Work context = Regular`
   - `Late flag = No`
6. Enter the printed attendance note in `Manager note`.
7. Click `Save attendance fact`.
8. Confirm the success alert `Attendance record saved.` appears.
9. Confirm the tagged worker row now shows:
   - `WHOLE_DAY`
   - `WORK_DAY · REGULAR`
10. Confirm the planned row still matches the printed window.

## Expected Outcomes

1. exactly one `AttendanceDutyResult` exists for the tagged worker and duty date
2. `scheduleId` points to the seeded published schedule row
3. `recordedById` matches the manager
4. `dayType`, `attendanceResult`, `workContext`, `lateFlag`, and `note` match the submitted values
5. the schedule row remains `PUBLISHED`
6. no `ScheduleEvent` row is appended in this happy path
7. no suspension or leave side effects are created

## Cleanup

1. Run `npm run qa:workforce:attendance-recording:happy-path:cleanup`.
2. Confirm the tagged worker, template, assignment, schedule row, pay profile, and attendance record were removed.
