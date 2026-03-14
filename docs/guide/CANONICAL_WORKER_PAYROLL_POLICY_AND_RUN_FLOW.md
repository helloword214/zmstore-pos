# Canonical Worker Payroll Policy + Run Flow

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-03-14

## Purpose

Defines one source of truth for:

1. employee pay profiles and effective-dated rate history
2. company payroll policy defaults used by payroll runs
3. payroll computation boundary from attendance facts to gross pay
4. attendance-incentive policy and payroll addition rules
5. manager-controlled payroll deductions from rider/cashier charge ledgers
6. payroll freeze rules for historical attendance basis, finalized payroll runs, and payouts

This document exists so payroll does not recompute live from mutable settings or silently mix schedule facts, charge creation, and payout decisions into one unclear flow.

## Owns

This document owns:

1. employee pay profile model and effective-dated rate history
2. company payroll policy defaults for pay frequency, rest day worked premium, holiday worked premium, sick leave treatment, and attendance incentive treatment
3. payroll interpretation of attendance facts into base pay and payroll additions
4. payroll run model, manager override authority, and net-pay computation
5. deduction consumption from payroll-tagged rider/cashier charge ledgers
6. hybrid freeze rules for attendance-time pay basis snapshots and payroll-time finalization snapshots

## Does Not Own

This document does not own:

1. worker schedule creation, staffing event history, and rider duty-session control
2. rider shortage and cashier variance charge creation rules
3. cashier drawer shift mechanics
4. hourly, late-minute, or undertime computation
5. leave families beyond V1 `SICK_LEAVE`
6. government remittance, tax, or statutory benefit formulas
7. final payslip printing/layout contracts

## Refer To

1. `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md` for schedule authority, attendance facts, staffing events, and duty-session boundaries
2. `CANONICAL_IDENTITY_ACCESS_FLOW.md` for role authority and route access ownership
3. `CANONICAL_DELIVERY_CASH_AR_FLOW.md` for charge-origin route ownership in delivery/cashier flow
4. `RIDER_SHORTAGE_WORKFLOW.md` for rider shortage and `RiderCharge` creation rules
5. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md` for cashier variance and `CashierCharge` creation rules

## Scope

This document covers:

1. one payroll model for all employees, with employee-specific pay profiles even when roles match
2. day-based V1 payroll computation from attendance facts
3. company defaults for rest day worked premium, regular/special holiday worked premium, sick leave treatment, attendance incentive criteria, and pay frequency
4. manager override of default payroll treatment during payroll run review
5. payroll deduction handling for existing rider/cashier charge ledgers
6. historical freeze behavior for attendance pay basis, payroll finalization, and payout

This document does not yet define:

1. hourly or late-minute math
2. undertime or grace-period rules
3. leave families beyond `SICK_LEAVE`
4. tax, SSS, PhilHealth, Pag-IBIG, or 13th-month calculations
5. percentage-based attendance incentives
6. employee self-service payroll release flows

## Domain Separation (Binding)

### 1. Employee Pay Profile

`Employee Pay Profile` is the employee-specific pay setup.

It answers:

1. whether the employee is daily-paid or monthly-paid
2. what their current approved base rate is
3. what day-equivalent value payroll should use for V1 day-based math
4. when a pay-rate change takes effect

Employees may share a role and still have different pay profiles.

### 2. Company Payroll Policy

`Company Payroll Policy` is the internal default policy layer.

It answers:

1. what default premium percentages are used for rest day and holiday work
2. how sick leave is treated by default
3. what attendance incentive amount and qualification criteria apply by default
4. what payroll frequency/cutoff style the business uses
5. whether manager override is allowed at payroll time

These defaults are internal business settings, not employee-facing compliance notices.

### 3. Attendance Payroll Snapshot

`Attendance Payroll Snapshot` is the attendance-time freeze of employee-specific pay basis.

It answers:

1. what employee pay profile applied on that duty date
2. what base day-equivalent value was frozen for that attendance line
3. what attendance facts payroll will later read
4. what historical basis must remain stable even if settings change later

This snapshot freezes employee pay basis, not final payroll treatment.

### 4. Payroll Run

`Payroll Run` is the manager-reviewed pay computation and release record for a cutoff.

It answers:

1. what attendance-backed base pay was computed for the employee in that run
2. what additions such as attendance incentive were applied
3. what company default or manager override was applied
4. what deductions were actually taken
5. what final net pay was approved and paid

### 5. Charge Ledgers

`RiderCharge` and `CashierCharge` remain separate liability ledgers.

They answer:

1. what amount is still owed by the worker
2. whether the charge is open, partially settled, settled, or waived
3. what variance/shift/run created the liability

Payroll consumes tagged charges as deductions, but payroll does not own charge creation.

## Authority Model

### Admin

`ADMIN` is control-plane authority for payroll setup only.

Admin responsibilities:

1. maintain company payroll defaults
2. maintain employee pay profiles and effective-dated rate changes
3. avoid operational payroll decisions such as charge deduction timing or final payroll release

### Store Manager

`STORE_MANAGER` is payroll-run authority.

Manager responsibilities:

1. review attendance-backed payroll inputs for the cutoff
2. apply or override default payroll treatment when needed
3. decide whether to deduct none, partial, or full amount from tagged charges
4. finalize payroll runs and payout snapshots

### Employee

Employees are payroll subjects, not payroll decision authorities.

Future employee self-view must read finalized payroll snapshots only.

## Employee Pay Profile Canonical Model

Recommended fields:

1. `employeeId`
2. `payBasis` -> `DAILY` or `MONTHLY`
3. `baseDailyRate` nullable
4. `baseMonthlyRate` nullable
5. `dailyRateEquivalent`
6. `halfDayFactor` default `0.5`
7. `effectiveFrom`
8. `effectiveTo` nullable
9. `note`
10. `createdById`
11. `updatedById`

Rules:

1. each employee may have a different rate even with the same role
2. pay-rate changes are effective-dated and must not rewrite prior snapshots
3. monthly-paid profiles must still store a manager-approved `dailyRateEquivalent` for V1 day-based payroll math
4. V1 `halfDayFactor` is fixed at `0.5`

## Company Payroll Policy Canonical Model

Recommended fields:

1. `effectiveFrom`
2. `payFrequency` -> `WEEKLY`, `BIWEEKLY`, `SEMI_MONTHLY`, `CUSTOM`
3. `customCutoffNote` nullable
4. `restDayWorkedPremiumPercent`
5. `regularHolidayWorkedPremiumPercent`
6. `specialHolidayWorkedPremiumPercent`
7. `sickLeavePayTreatment` -> `PAID` or `UNPAID`
8. `attendanceIncentiveEnabled`
9. `attendanceIncentiveAmount`
10. `attendanceIncentiveRequireNoLate`
11. `attendanceIncentiveRequireNoAbsent`
12. `attendanceIncentiveRequireNoSuspension`
13. `allowManagerOverride` default `true`
14. `createdById`
15. `updatedById`

Rules:

1. policy changes affect future payroll decisions only; they do not rewrite finalized payroll snapshots
2. businesses may choose flexible premium percentages such as `0`, `10`, `30`, `50`, or `100`
3. manager may override defaults per payroll run when business reality requires it
4. V1 attendance incentive is a fixed peso amount per cutoff, not a percentage-based rule

## Attendance Input Contract

Payroll reads these factual inputs from `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`:

1. `dayType` -> `WORK_DAY`, `REST_DAY`, `REGULAR_HOLIDAY`, `SPECIAL_HOLIDAY`
2. `attendanceResult` -> `WHOLE_DAY`, `HALF_DAY`, `ABSENT`, `LEAVE`, `NOT_REQUIRED`, `SUSPENDED_NO_WORK`
3. `workContext` -> `REGULAR`, `REPLACEMENT`, `ON_CALL`
4. `leaveType` V1 -> `SICK_LEAVE`
5. `lateFlag` -> `YES` or `NO`

Rules:

1. payroll consumes these facts but does not own or rewrite them
2. rest day or holiday work must preserve original `dayType` even when the worker reports as replacement
3. replacement and on-call explain the attendance context; they do not by themselves change pay
4. `lateFlag` is an eligibility/discipline fact only in V1 and does not trigger minute-based pay deduction

## Gross Pay V1 Computation

1. base day amount comes from the frozen pay-profile snapshot for that attendance line
2. `WHOLE_DAY` = 100% of base day amount
3. `HALF_DAY` = 50% of base day amount
4. `ABSENT` = 0
5. `SUSPENDED_NO_WORK` = 0
6. `NOT_REQUIRED` = 0 unless manager explicitly applies another treatment in payroll
7. `LEAVE` with `SICK_LEAVE` follows the payroll policy default or manager override (`PAID` or `UNPAID`)
8. `REST_DAY` worked entries apply `restDayWorkedPremiumPercent`
9. `REGULAR_HOLIDAY` worked entries apply `regularHolidayWorkedPremiumPercent`
10. `SPECIAL_HOLIDAY` worked entries apply `specialHolidayWorkedPremiumPercent`
11. worked premiums apply only to the actual worked day fraction (`WHOLE_DAY` or `HALF_DAY`)

Example interpretation:

1. normal whole day -> `base day amount`
2. half day -> `base day amount * 0.5`
3. rest day whole day with `30%` premium -> `base day amount * 1.30`
4. rest day half day with `30%` premium -> `(base day amount * 0.5) * 1.30`

## Attendance Incentive V1 Policy

Attendance incentive is a payroll addition, not base pay.

V1 rules:

1. incentive is a fixed peso amount per payroll cutoff
2. incentive eligibility comes from company policy defaults and may be overridden by manager during payroll review
3. supported V1 policy criteria are:
   - no `ABSENT`
   - no `SUSPENDED_NO_WORK`
   - `lateFlag = NO` across the payroll period
4. payroll must evaluate the finalized attendance facts inside the payroll period before adding the incentive
5. once payroll is finalized, the incentive result and amount are frozen inside the payroll snapshot

## Hybrid Freeze Model (Binding)

### A. Attendance-Time Freeze

At attendance/day-result recording time, freeze:

1. `employeeId`
2. `payProfileId` or equivalent rate-history anchor
3. `payBasis`
4. `baseDailyRate` / `baseMonthlyRate`
5. `dailyRateEquivalent`
6. `halfDayFactor`
7. factual attendance inputs (`dayType`, `attendanceResult`, `workContext`, `leaveType`, `lateFlag`)

These attendance-basis snapshots must not change when future pay profiles or company settings are edited.

### B. Payroll-Time Freeze

At payroll run finalization time, freeze:

1. company default values actually used
2. manager overrides actually used
3. computed `baseAttendancePay`
4. computed additions such as `attendanceIncentiveAmount`
5. computed `grossPay`
6. selected deductions and linked charge-payment rows
7. final `netPay`
8. payroll status anchors such as `finalizedAt`, `paidAt`, and actor ids

After a payroll run is finalized or paid, later settings changes must not recompute it.

### C. Hybrid Interpretation Rule

1. employee-specific base pay is frozen at attendance time
2. company premium and sick-leave defaults may still change before payroll finalization
3. once payroll is finalized or paid, both pay treatment and deductions are frozen

## Payroll Run Canonical Model

Recommended header fields:

1. `periodStart`
2. `periodEnd`
3. `payDate`
4. `payFrequency`
5. `status` -> `DRAFT`, `FINALIZED`, `PAID`, `VOIDED`
6. `createdById`
7. `finalizedById`
8. `paidById`
9. `createdAt`
10. `finalizedAt`
11. `paidAt`

Recommended per-employee payroll line fields:

1. `payrollRunId`
2. `employeeId`
3. `attendanceSnapshotIds` or equivalent resolved day-line anchors
4. `baseAttendancePay`
5. `attendanceIncentiveAmount`
6. `totalAdditions`
7. `grossPay`
8. `totalDeductions`
9. `netPay`
10. `policySnapshot`
11. `managerOverrideNote`
12. `createdAt`

Rules:

1. payroll run is manager-reviewed before finalization
2. finalized run is audit-safe and immutable except formal void/adjustment flow
3. paid run must never be silently recalculated or rebundled into a later payout

## Charge Deduction Contract

1. charge creation stays in the rider/cashier owner docs
2. only charges explicitly tagged for payroll deduction are eligible
3. manager may apply `NONE`, `PARTIAL`, or `FULL` deduction per payroll run
4. current route behavior distributes an entered deduction amount FIFO across open payroll-tagged charges for the selected employee
5. payroll deduction posts `RiderChargePayment` or `CashierChargePayment` with method `PAYROLL_DEDUCTION`
6. charge and variance statuses sync after deduction posting
7. unpaid or partially paid charges remain open for future payroll runs

## Current Implementation Anchor

1. `app/routes/store.rider-ar.tsx` and `app/routes/store.cashier-ar.tsx` tag eligible charges for payroll deduction planning
2. `app/routes/store.payroll.tsx` currently handles charge-ledger deduction posting only
3. future payroll expansion must preserve the existing charge-ledger source of truth while adding gross-pay, net-pay, and payroll-line snapshots
4. current code still allows `ADMIN` in some payroll routes; canonical target is `STORE_MANAGER` for payroll-run decisions and `ADMIN` only for control-plane payroll settings
