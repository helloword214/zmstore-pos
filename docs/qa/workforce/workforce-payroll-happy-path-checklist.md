# Workforce Payroll Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

This checklist is a secondary QA artifact.
It does not own payroll behavior.

## Refer To

1. `docs/Governance SOP/QA Testing Architecture Standard.md`
2. `docs/guide/CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md`
3. `docs/guide/CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`

## Purpose

Verify one attendance-backed payroll happy path using a repeatable local QA scenario.

## Setup

1. Run `npm run qa:workforce:payroll:happy-path:setup`.
2. Copy the printed employee name, cutoff dates, and QA marker from the console output.
3. Do not apply charge deductions in this scenario if you want cleanup to fully reset the local data afterward.

## Expected Scenario Shape

The setup creates or confirms:

1. one active rider employee
2. one active daily salary row for that rider
3. one active statutory-deduction row for that rider if none exists yet
4. three attendance facts inside the current cutoff:
   - `WHOLE_DAY`
   - `WHOLE_DAY`
   - `HALF_DAY`

Expected base-pay formula:

1. `dailyRate x 2`
2. `dailyRate x halfDayFactor`
3. total base attendance pay = `dailyRate x (2 + halfDayFactor)`

## Manual QA Steps

1. Log in as `STORE_MANAGER`.
2. Open `/store/payroll`.
3. Create a payroll draft using the exact cutoff dates printed by setup.
4. Paste the exact QA marker into the draft note field.
5. Click `Create payroll draft`.
6. Open the created draft if it is not already selected.
7. Click `Rebuild payroll lines`.
8. Confirm that the tagged rider appears in the payroll lines.
9. Confirm that the base attendance pay matches the setup formula.
10. If payroll policy currently enables SSS, PhilHealth, or Pag-IBIG, confirm the employee deduction row is reflected in deductions.
11. Confirm the run can be finalized because it now has attendance-backed payroll lines.
12. Optionally mark the run paid if you are only validating the paid-state path and did not apply charge deductions.

## Expected Outcomes

1. no zero-pay synthetic line is created for workers without attendance
2. the selected rider has positive gross pay
3. deductions stay separate from base attendance pay
4. finalize is enabled only after rebuild creates attendance-backed lines
5. no runtime crash occurs on the payroll page during draft, rebuild, finalize, or paid actions

## Cleanup

1. Run `npm run qa:workforce:payroll:happy-path:cleanup`.
2. If cleanup warns that a tagged payroll run has applied charge deductions, leave that run in place and resolve it manually before rerunning cleanup.
