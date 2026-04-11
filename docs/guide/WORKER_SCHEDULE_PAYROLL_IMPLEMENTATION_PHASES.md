# Worker Schedule + Payroll Implementation Phases

Status: SUPPORTING
Owner: POS Platform
Last Reviewed: 2026-03-14

## Purpose

Turns the canonical worker schedule and payroll owner docs into one practical implementation order for V1.

This guide exists so we can build the feature in controlled phases without mixing schema foundation, manager operations, payroll computation, and dashboard hookup into one risky patch.

## Owns

This guide owns:

1. phase-by-phase execution order for worker schedule + payroll V1
2. dependency notes between schema, services, manager UI, and payroll UI
3. suggested route/page buckets for implementation planning
4. naming guardrails applied to this feature's future files, routes, and services
5. must-have versus out-of-scope checklist for the 2-3 day V1 target

## Does Not Own

This guide does not own:

1. canonical business rules for worker scheduling
2. canonical business rules for payroll computation and deductions
3. cashier shift lifecycle or cashier variance authority
4. rider shortage or cashier charge creation rules
5. final route authority once implementation starts

## Refer To

1. `CANONICAL_WORKER_SCHEDULING_DUTY_SESSION_FLOW.md`
2. `CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md`
3. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
4. `RIDER_SHORTAGE_WORKFLOW.md`
5. `docs/Chat Operating Rules/Chat Execution Rules.md`

## Planning Assumptions

1. V1 target is 2-3 working days if scope stays limited to the currently locked canonical rules.
2. Existing `RiderCharge`, `CashierCharge`, and payroll deduction posting remain in place and are integrated instead of rewritten.
3. `CashierShift` stays separate from worker schedule and must not be refactored into the generic scheduling model.
4. V1 remains day-based only:
   - no hourly math
   - no late-minute deductions
   - no rotating staffing patterns
   - no leave families beyond `SICK_LEAVE`
   - no government deduction formulas

## Naming Convention Guardrail

Follow the owner rule in `docs/Chat Operating Rules/Chat Execution Rules.md`.

Feature-specific reminder:

1. all new routes, files, components, and services for this feature must use domain-scoped names
2. avoid broad single-word names such as `policy`, `settings`, `schedule`, `attendance`, `manager`, or `payroll` when used alone
3. prefer names that include both domain and intent, such as:
   - `worker-schedule-template`
   - `worker-schedule-planner`
   - `worker-attendance-review`
   - `worker-suspension-record`
   - `worker-payroll-policy`
   - `worker-payroll-run`
4. prefer route buckets under `/store/workforce/...` for manager operations so they do not collide with cashier-shift, AR, or other store modules
5. if an existing broad route is reused temporarily, do not silently rename it later without explicit approval

## Suggested Route / Page Map (Implementation Planning Only)

These are suggested implementation buckets, not final canonical route authority.

| Concern | Suggested route/page bucket | Notes |
| --- | --- | --- |
| Manager staffing pattern library | `/store/workforce/schedule-templates` | Create, pause, end, and assign reusable weekly named staffing patterns |
| Manager schedule planner / publication | `/store/workforce/schedule-planner` | Generate future schedules, review one-off edits, publish |
| Manager attendance review | `/store/workforce/attendance-review` | Record `WHOLE_DAY`, `HALF_DAY`, `ABSENT`, `LEAVE`, `NOT_REQUIRED`, `SUSPENDED_NO_WORK`, and `lateFlag` |
| Manager suspension records | `/store/workforce/suspension-records` | Apply/lift suspension without deleting planned schedules |
| Manager payroll runs | `/store/workforce/payroll-runs` | Gross pay, additions, deductions, net pay, finalize payout |
| Admin payroll policy | `/creation/workforce/payroll-policy` | Control-plane defaults only |
| Admin employee pay profiles | `/creation/workforce/pay-profiles` | Effective-dated employee pay setup |
| Employee self-view (later) | `/me/work-schedule`, `/me/work-attendance`, `/me/payroll-releases` | Hook up only after manager-side data becomes real |

Current-route constraint:

1. `app/routes/store.payroll.tsx` already exists and currently owns deduction posting only.
2. V1 may extend that route first to reduce churn.
3. If a later rename to a more domain-scoped route is desired, treat it as a separate approved rename task.

## Phase 1: Foundation / Schema / Services

Goal:

Build the data foundation and service layer that every manager and payroll UI depends on.

Must-have deliverables:

1. add Prisma models/enums for:
   - `ScheduleTemplate`
   - `ScheduleTemplateAssignment`
   - `WorkerSchedule`
   - `ScheduleEvent`
   - `AttendanceDutyResult`
   - `SuspensionRecord`
   - `EmployeePayProfile`
   - `CompanyPayrollPolicy`
   - `PayrollRun`
   - `PayrollRunLine`
2. add attendance-time snapshot fields for employee pay basis
3. add payroll-time snapshot fields for gross pay, additions, deductions, and net pay
4. add service modules for:
   - schedule generation from named staffing patterns
   - attendance recording
   - suspension overlay
   - gross-pay computation
   - attendance-incentive eligibility
   - payroll deduction application
5. add payroll identity normalization:
   - `RiderCharge` already resolves through `Employee`
   - `CashierCharge` must resolve `cashierId -> User -> linked Employee`
   - payroll finalization must block unresolved cashier-user-to-employee mismatches
6. preserve current `CashierShift`, `CashierCharge`, and `RiderCharge` ownership without schema rewrites that change their operational SoT

Suggested domain-scoped file/service buckets:

1. `app/services/worker-schedule-template.server.ts`
2. `app/services/worker-schedule-publication.server.ts`
3. `app/services/worker-attendance-duty-result.server.ts`
4. `app/services/worker-suspension-record.server.ts`
5. `app/services/worker-payroll-policy.server.ts`
6. `app/services/worker-payroll-run.server.ts`
7. `app/services/worker-payroll-identity.server.ts`

Dependency note:

1. do not start manager schedule UI or payroll UI before this foundation exists
2. this phase is the correct place to fix the cashier payroll identity mismatch

## Phase 2: Manager Schedule + Attendance Operations

Goal:

Make store-manager schedule planning and attendance recording real.

Must-have deliverables:

1. staffing pattern create/edit/pause/end UI
2. staffing pattern assignment UI for many employees
3. schedule generation UI for next week / next cutoff / next month
4. schedule review and publish flow
5. one-off daily schedule edit/cancel flow that preserves event history
6. attendance review UI for:
   - `dayType`
   - `attendanceResult`
   - `workContext`
   - `leaveType`
   - `lateFlag`
7. suspension record UI:
   - apply whole-day suspension
   - keep planned schedule rows
   - write `SUSPENDED_NO_WORK`
8. append-only schedule event logging for changes that matter operationally

Suggested route/page buckets:

1. `/store/workforce/schedule-templates`
2. `/store/workforce/schedule-planner`
3. `/store/workforce/attendance-review`
4. `/store/workforce/suspension-records`

Dependency note:

1. this phase should end with manager-owned schedule and attendance data being real
2. employee dashboards may still stay placeholder until Phase 4

## Phase 3: Payroll Run V1

Goal:

Turn attendance facts into real gross pay, additions, deductions, and net pay.

Must-have deliverables:

1. admin/control-plane payroll policy page
2. admin/control-plane employee pay-profile page with effective dates
3. payroll run header and per-employee payroll line storage
4. gross pay computation from attendance facts
5. rest-day and holiday premium application from company defaults with manager override support
6. `SICK_LEAVE` paid/unpaid treatment from company defaults with manager override support
7. fixed-peso attendance incentive evaluation and payroll-line addition
8. payroll review page that shows:
   - `baseAttendancePay`
   - additions
   - selected charge deductions
   - `grossPay`
   - `netPay`
9. reuse existing payroll-tagged charge deduction flow instead of recreating rider/cashier charge settlement logic
10. payroll finalization freeze for snapshot safety

Suggested route/page buckets:

1. `/store/workforce/payroll-runs`
2. `/creation/workforce/payroll-policy`
3. `/creation/workforce/pay-profiles`

Dependency note:

1. do not finalize payroll-run design until cashier identity normalization from Phase 1 is in place
2. existing `app/routes/store.payroll.tsx` can be evolved first, then split later only if approved

## Phase 4: Dashboard Hookup, Access Gating, and QA

Goal:

Replace placeholders, tighten operational access, and verify frozen payroll behavior.

Must-have deliverables:

1. replace placeholder schedule/attendance/payroll cards in:
   - `app/routes/rider._index.tsx`
   - `app/routes/cashier._index.tsx`
2. hook dashboards to real schedule, attendance, and payroll summary data
3. ensure rider "on-duty" state is no longer hardcoded and reflects real duty-session controls when included in V1
4. verify payroll history does not drift when policy defaults change later
5. verify partial, full, or skipped charge deductions across payroll runs
6. verify suspension excludes attendance incentive eligibility
7. verify `HALF_DAY = 50%` in gross-pay and payroll snapshots
8. run regression checks so `CashierShift` drawer flow remains separate and unaffected

## V1 Must-Have Summary

1. manager can create weekly named staffing patterns and assign them to many employees
2. manager can generate and publish real work schedules
3. manager can record attendance, late flag, and suspension
4. payroll can compute day-based gross pay from attendance facts
5. payroll can add fixed attendance incentive
6. payroll can deduct existing tagged rider/cashier charges with none/partial/full manager decision
7. payroll snapshots freeze safely for historical records

## V1 Out of Scope

1. hourly payroll math
2. late-minute deductions
3. undertime/grace rules
4. rotating/alternating staffing patterns
5. leave families beyond `SICK_LEAVE`
6. tax and government remittance formulas
7. final self-service payroll portal polish

## Suggested 2-3 Day Execution Order

### Day 1

1. finish Phase 1 foundation
2. include cashier payroll identity normalization in the same foundation work
3. start Phase 2 manager staffing pattern library and planner flows if schema/services finish early

### Day 2

1. finish Phase 2 manager attendance and suspension flows
2. start Phase 3 payroll run header, payroll line storage, and gross-pay computation
3. keep existing charge deduction posting in place and connect it to payroll review

### Day 3

1. finish Phase 3 payroll review/finalization
2. complete Phase 4 dashboard hookup and gating cleanup
3. run focused QA on snapshot freeze, deductions, and cashier-shift separation

Execution shortcut:

1. if time becomes tight, do not skip Phase 1
2. the highest-risk shortcut is trying to build payroll UI before identity normalization and snapshot storage exist
