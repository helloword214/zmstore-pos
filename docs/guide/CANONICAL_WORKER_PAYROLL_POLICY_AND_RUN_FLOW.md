# Canonical Worker Payroll Policy + Run Flow

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-03-15

## Purpose

Defines one source of truth for:

1. employee daily-rate profiles and effective-dated salary history
2. employee-specific government-deduction profiles and effectivity history
3. company payroll policy defaults used by payroll runs
4. payroll computation boundary from attendance facts to gross pay
5. attendance-incentive policy and payroll addition rules
6. payroll identity normalization from operational ledgers into one employee-centered payroll subject
7. government-deduction inclusion plus manager-controlled charge deductions
8. payroll freeze rules for historical attendance basis, finalized payroll runs, and payouts

This document exists so payroll does not recompute live from mutable settings or silently mix schedule facts, charge creation, and payout decisions into one unclear flow.

## Owns

This document owns:

1. employee daily-rate model and effective-dated salary history
2. employee-specific SSS, PhilHealth, and Pag-IBIG amount history
3. company payroll policy defaults for pay frequency, rest day worked premium, holiday worked premium, sick leave treatment, attendance incentive treatment, and government-deduction inclusion switches
4. payroll interpretation of attendance facts into base pay and payroll additions
5. payroll identity normalization rules when operational ledgers use different actor anchors
6. payroll run model, manager override authority, and net-pay computation
7. deduction consumption from payroll-tagged rider/cashier charge ledgers
8. hybrid freeze rules for attendance-time salary snapshots and payroll-time finalization snapshots

## Does Not Own

This document does not own:

1. worker schedule creation, staffing event history, and rider duty-session control
2. rider shortage and cashier variance charge creation rules
3. cashier drawer shift mechanics
4. hourly, late-minute, or undertime computation
5. leave families beyond V1 `SICK_LEAVE`
6. government remittance filing, tax formulas, or automated statutory rate-table computation
7. final payslip printing/layout contracts

## Refer To

1. `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md` for schedule authority, attendance facts, staffing events, and duty-session boundaries
2. `CANONICAL_IDENTITY_ACCESS_FLOW.md` for role authority and route access ownership
3. `CANONICAL_DELIVERY_CASH_AR_FLOW.md` for charge-origin route ownership in delivery/cashier flow
4. `RIDER_SHORTAGE_WORKFLOW.md` for rider shortage and `RiderCharge` creation rules
5. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md` for cashier variance and `CashierCharge` creation rules

## Scope

This document covers:

1. one payroll model for all employees, with employee-specific daily-rate rows even when roles match
2. day-based V1 payroll computation from attendance facts
3. company defaults for rest day worked premium, regular/special holiday worked premium, sick leave treatment, attendance incentive criteria, pay frequency, and government-deduction inclusion
4. employee-specific government-deduction amounts with their own effective-dated history
5. employee-centered payroll-line ownership even when an upstream operational ledger uses another actor anchor
6. manager override of default payroll treatment during payroll run review
7. payroll deduction handling for existing rider/cashier charge ledgers
8. historical freeze behavior for attendance salary basis, payroll finalization, and payout

This document does not yet define:

1. hourly or late-minute math
2. undertime or grace-period rules
3. leave families beyond `SICK_LEAVE`
4. tax, automated SSS/PhilHealth/Pag-IBIG formulas, or 13th-month calculations
5. percentage-based attendance incentives
6. employee self-service payroll release flows

## Domain Separation (Binding)

### 1. Employee Pay Profile

`Employee Pay Profile` is the employee-specific salary setup.

It answers:

1. what the employee's approved daily rate is
2. when a salary change takes effect
3. what salary basis payroll should freeze at attendance time

Employees may share a role and still have different salary rows.

### 2. Employee Statutory Deduction Profile

`Employee Statutory Deduction Profile` is the employee-specific government-deduction setup.

It answers:

1. what SSS employee-share amount should be used for that employee
2. what PhilHealth employee-share amount should be used for that employee
3. what Pag-IBIG employee-share amount should be used for that employee
4. when a deduction-amount change takes effect

These rows are separate from salary rows because the business may change salary and government deductions on different dates.

### 3. Company Payroll Policy

`Company Payroll Policy` is the internal default policy layer.

It answers:

1. what default premium percentages are used for rest day and holiday work
2. how sick leave is treated by default
3. what attendance incentive amount and qualification criteria apply by default
4. what payroll frequency/cutoff style the business uses
5. whether SSS, PhilHealth, and Pag-IBIG are included on payroll runs
6. whether manager override is allowed at payroll time

These defaults are internal business settings, not employee-facing compliance notices.

### 4. Attendance Payroll Snapshot

`Attendance Payroll Snapshot` is the attendance-time freeze of employee-specific salary basis.

It answers:

1. what employee pay profile applied on that duty date
2. what daily rate was frozen for that attendance line
3. what attendance facts payroll will later read
4. what historical basis must remain stable even if settings change later

This snapshot freezes salary basis, not final payroll treatment.

### 5. Payroll Run

`Payroll Run` is the manager-reviewed pay computation and release record for a cutoff.

It answers:

1. what attendance-backed base pay was computed for the employee in that run
2. what additions such as attendance incentive were applied
3. what company default or manager override was applied
4. what government and charge deductions were actually taken
5. what final net pay was approved and paid

### 6. Charge Ledgers

`RiderCharge` and `CashierCharge` remain separate liability ledgers.

They answer:

1. what amount is still owed by the worker
2. whether the charge is open, partially settled, settled, or waived
3. what variance/shift/run created the liability

Payroll consumes tagged charges as deductions, but payroll does not own charge creation.

### 7. Payroll Identity Normalization

`Payroll Identity Normalization` is the translation layer that keeps payroll employee-centered even when an upstream operational ledger uses another actor anchor.

It answers:

1. what canonical `employeeId` a payroll line belongs to
2. how rider and cashier charge sources are resolved into one payroll subject
3. when payroll must block because an operational user has no linked employee record
4. which layer owns the mismatch fix without rewriting operational accountability flows

## Authority Model

### Admin

`ADMIN` is control-plane authority for payroll setup only.

Admin responsibilities:

1. maintain company payroll defaults
2. maintain employee daily-rate rows and effective-dated salary changes
3. maintain employee-specific government-deduction rows
4. avoid operational payroll decisions such as charge deduction timing or final payroll release

### Store Manager

`STORE_MANAGER` is payroll-run authority.

Manager responsibilities:

1. review attendance-backed payroll inputs for the cutoff
2. apply or override default payroll treatment when needed
3. review government deductions plus tagged rider/cashier charges
4. decide whether to deduct none, partial, or full amount from tagged charges
5. finalize payroll runs and payout snapshots

### Employee

Employees are payroll subjects, not payroll decision authorities.

Future employee self-view must read finalized payroll snapshots only.

## Employee Pay Profile Canonical Model

Recommended fields:

1. `employeeId`
2. `dailyRate`
3. `halfDayFactor` default `0.5`
4. `effectiveFrom`
5. `effectiveTo` nullable
6. `note`
7. `createdById`
8. `updatedById`

Rules:

1. each employee may have a different rate even with the same role
2. salary changes are effective-dated and must not rewrite prior snapshots
3. salary setup is daily-rate only for the small-store V1 scope
4. V1 `halfDayFactor` is fixed at `0.5`
5. `effectiveTo` is optional/open-ended by default
6. when a new current row is added, the prior open-ended row may be auto-closed to the day before the new effectivity starts
7. payroll lines remain anchored to `employeeId`, not role name or operational `userId`

## Employee Statutory Deduction Profile Canonical Model

Recommended fields:

1. `employeeId`
2. `sssAmount`
3. `philhealthAmount`
4. `pagIbigAmount`
5. `effectiveFrom`
6. `effectiveTo` nullable
7. `note`
8. `createdById`
9. `updatedById`

Rules:

1. these amounts are employee-specific and may differ even for the same role
2. deduction-amount changes are effective-dated and must not rewrite prior payroll snapshots
3. these rows are separate from salary rows
4. `effectiveTo` is optional/open-ended by default
5. when a new current deduction row is added, the prior open-ended row may be auto-closed to the day before the new effectivity starts

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
13. `sssDeductionEnabled`
14. `philhealthDeductionEnabled`
15. `pagIbigDeductionEnabled`
16. `allowManagerOverride` default `true`
17. `createdById`
18. `updatedById`

Rules:

1. policy changes affect future payroll decisions only; they do not rewrite finalized payroll snapshots
2. businesses may choose flexible premium percentages such as `0`, `10`, `30`, `50`, or `100`
3. manager may override defaults per payroll run when business reality requires it
4. V1 attendance incentive is a fixed peso amount per cutoff, not a percentage-based rule
5. V1 government-deduction inclusion is a simple on/off policy switch, while actual amounts stay employee-specific
6. enabled government deductions apply on every payroll run that has positive gross pay

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

1. base day amount comes from the frozen daily-rate snapshot for that attendance line
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

## Government Deductions V1

1. SSS, PhilHealth, and Pag-IBIG use employee-specific fixed amounts from the effective employee deduction row on the payroll run `payDate`
2. company payroll policy decides whether each deduction kind is included
3. enabled government deductions apply on every payroll run with positive gross pay
4. these deductions are frozen inside the payroll line at rebuild/finalization time
5. charge deductions remain separate from government deductions
6. automated government rate-table calculation is out of scope for V1

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
3. `dailyRate`
4. `halfDayFactor`
5. factual attendance inputs (`dayType`, `attendanceResult`, `workContext`, `leaveType`, `lateFlag`)

These attendance-basis snapshots must not change when future salary rows or company settings are edited.

### B. Payroll-Time Freeze

At payroll run finalization time, freeze:

1. company default values actually used
2. manager overrides actually used
3. computed `baseAttendancePay`
4. computed additions such as `attendanceIncentiveAmount`
5. computed `grossPay`
6. government-deduction snapshot used
7. selected charge deductions and linked charge-payment rows
8. final `netPay`
9. payroll status anchors such as `finalizedAt`, `paidAt`, and actor ids

After a payroll run is finalized or paid, later settings changes must not recompute it.

### C. Hybrid Interpretation Rule

1. employee-specific base pay is frozen at attendance time
2. company premium, sick-leave, and government-deduction inclusion defaults may still change before payroll finalization
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
8. `chargeDeductionAmount`
9. `statutoryDeductionAmount`
10. `totalDeductions`
11. `netPay`
12. `policySnapshot`
13. `statutoryDeductionSnapshot`
14. `managerOverrideNote`
15. `createdAt`

Rules:

1. payroll run is manager-reviewed before finalization
2. finalized run is audit-safe and immutable except formal void/adjustment flow
3. paid run must never be silently recalculated or rebundled into a later payout
4. every payroll line must resolve to one canonical `employeeId`

## Charge Deduction Contract

1. charge creation stays in the rider/cashier owner docs
2. payroll deduction review and payroll-line snapshots are employee-centered
3. `RiderCharge` already resolves directly through `riderId -> Employee.id`
4. `CashierCharge` currently originates from cashier `User` identity and must resolve `cashierId -> User -> linked Employee` before payroll aggregation, display, deduction posting, and payroll-line finalization
5. if a cashier charge cannot resolve to a linked employee, payroll must block that item from payroll-run finalization until the identity link is fixed
6. this cashier identity normalization is a payroll-foundation fix only; it must not rewrite `CashierShift`, `CashierCharge`, or variance ownership
7. only charges explicitly tagged for payroll deduction are eligible
8. manager may apply `NONE`, `PARTIAL`, or `FULL` deduction per payroll run
9. current route behavior distributes an entered deduction amount FIFO across open payroll-tagged charges for the selected employee
10. payroll deduction posts `RiderChargePayment` or `CashierChargePayment` with method `PAYROLL_DEDUCTION`
11. charge and variance statuses sync after deduction posting
12. unpaid or partially paid charges remain open for future payroll runs

## Current Implementation Anchor

1. `app/routes/store.rider-ar.tsx` and `app/routes/store.cashier-ar.tsx` tag eligible charges for payroll deduction planning
2. `app/routes/store.payroll.tsx` is the `STORE_MANAGER` payroll-run review lane for draft creation, payroll-line rebuild, policy-driven government deductions, FIFO charge deduction posting, finalization, and paid-state updates
3. `app/routes/creation/workforce/payroll-policy.tsx` and `app/routes/creation/workforce/pay-profiles.tsx` are `ADMIN` control-plane pages for company payroll policy, daily salary history, and employee-specific deduction setup
