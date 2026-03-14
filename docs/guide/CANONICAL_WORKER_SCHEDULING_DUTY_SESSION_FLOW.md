# Canonical Worker Scheduling + Duty Session Flow

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-03-14

## Purpose

Defines one source of truth for:

1. worker schedule planning
2. recurring worker schedule template and assignment rules
3. staffing exception history
4. attendance / duty-result recording as payroll input
5. rider duty-session access gating
6. cashier schedule alignment with the existing `CashierShift` lifecycle

This document exists so scheduling, operational access, and cashier drawer accountability do not get merged into one unclear flow.

## Owns

This document owns:

1. worker schedule planning rules for `CASHIER`, `EMPLOYEE`, and rider-linked `EMPLOYEE`
2. recurring schedule template and assignment rules used to generate future work-day schedules
3. staffing exception history through append-only schedule events
4. attendance / duty-result facts used later by payroll
5. manager-applied suspension records that block work without deleting schedule history
6. rider duty-session authority, lifecycle, and access-gating rules
7. the boundary between cashier schedule planning and cashier drawer shift ownership
8. real-world staffing scenarios such as absence, replacement, on-call coverage, early out, swap, replacement no-show, and suspension

## Does Not Own

This document does not own:

1. cashier drawer close/recount/variance mechanics
2. delivery -> cashier -> AR end-to-end flow
3. file upload/storage contracts for scanned attachments
4. employee pay profiles, company payroll defaults, and payroll deduction rules
5. leave approval workflows, biometric attendance, or advanced rotating/alternating schedule automation
6. final route/file/module names for future scheduling implementation

## Refer To

1. `CANONICAL_IDENTITY_ACCESS_FLOW.md` for role boundaries and route access ownership
2. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md` for cashier shift lifecycle, final close, recount, and signed paper audit handling
3. `CANONICAL_DELIVERY_CASH_AR_FLOW.md` for wider delivery/remit/cashier/AR stage flow
4. `CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md` for employee pay profiles, payroll defaults, gross-pay rules, and payroll deductions
5. `CANONICAL_UPLOAD_STORAGE_SOT.md` for any future in-system scan/upload attachment behavior

## Scope

This document covers:

1. planned schedules for `CASHIER`, `STORE_MANAGER`, and `EMPLOYEE` workers used in store operations
2. recurring weekly schedule templates and employee template assignments
3. staffing history for schedule changes and exceptions
4. attendance / duty-result facts that later feed payroll
5. manager-applied suspension records for no-work periods
6. manager-controlled rider duty sessions as the rider operational access gate
7. cashier schedule planning only, while preserving `CashierShift` as the cashier money-lane SoT

This document does not yet define:

1. final UI route names
2. late-minute or hourly attendance math
3. leave approval flows
4. biometric or GPS attendance
5. advanced alternating-week or rotating template logic
6. partial-day suspension handling
7. non-rider employee duty-session enforcement

## Domain Separation (Binding)

### 1. Worker Schedule

`Worker Schedule` is the planning layer.

It answers:

1. who is expected to work
2. on what date
3. during what time window
4. in what role and assignment context

Worker schedule does not, by itself, unlock operational access.

### 2. Schedule Event Log

`Schedule Event Log` is the append-only staffing history under one planned schedule slot.

It answers:

1. what changed
2. who changed it
3. when it changed
4. why it changed

Chronology must be preserved instead of silently overwriting staffing history.

### 3. Recurring Schedule Template

`Recurring Schedule Template` is the reusable planning pattern layer.

It answers:

1. what weekly work pattern is commonly reused
2. what start/end time window should be generated for each selected work day
3. which workers may be assigned to use that pattern
4. what future schedule entries should be generated without rewriting history

Template rules must stay separate from the final generated schedule rows.

### 4. Attendance / Duty Result

`Attendance / Duty Result` is the factual record of what actually happened for the worker on that duty date.

It answers:

1. whether the date was a work day, rest day, or holiday classification
2. whether the worker rendered a whole day, half day, leave, absent, suspended-no-work, or no-work-required result
3. whether the worker served the day as regular, replacement, or on-call
4. whether a simple late flag was present for discipline/incentive review
5. what payroll should later read as factual input

This record feeds payroll, but payroll does not own or rewrite the fact layer.

### 5. Suspension Record

`Suspension Record` is the manager-applied no-work decision for a disciplinary period.

It answers:

1. who is suspended
2. what dates are covered
3. who applied or lifted it
4. what reason or note explains the action

Suspension must preserve planned schedule history instead of deleting it.

### 6. Rider Duty Session

`Rider Duty Session` is the actual rider access gate.

It answers:

1. whether a rider is currently authorized to use rider operational features
2. who opened that authorization
3. when it started and ended
4. whether the rider is covering a normal schedule, replacement, or on-call case

Schedule alone must not unlock rider features.

### 7. Cashier Shift

`CashierShift` remains the cashier drawer/accountability session and is not replaced by generic scheduling records.

It answers:

1. who owns the drawer
2. what opening float was accepted
3. what cash activity occurred under that drawer
4. what closing count was submitted
5. what manager recount and close decision finalized the shift

Cashier schedule alone must not unlock cashier money lanes.

## Authority Model

### Store Manager

`STORE_MANAGER` is the primary authority for scheduling and duty-session control.

Manager responsibilities:

1. create and publish worker schedules
2. maintain recurring templates and assign them to workers
3. record staffing exceptions
4. record attendance / duty results
5. apply or lift suspension records with reason
6. assign replacements and on-call coverage
7. open and close rider duty sessions
8. open cashier shifts for the actual cashier on duty
9. keep staffing history auditable

### Rider

Rider responsibilities:

1. view own schedule
2. use rider routes only while a manager-opened rider duty session exists
3. remain blocked when no active rider duty session exists

Rider does not self-open duty in the current canonical direction.

### Cashier

Cashier responsibilities:

1. view own schedule
2. wait for manager-opened cashier shift
3. verify opening float
4. operate only while `CashierShift.status = OPEN`
5. submit closing count once

Cashier schedule does not replace cashier shift.

### Other Employees

Non-rider `EMPLOYEE` users may be scheduled, but this document does not yet define a separate employee duty-session gate.

Current canonical direction:

1. schedule planning may cover employees
2. rider duty-session enforcement is the first operational gating target
3. any future employee duty-session model must be added explicitly and must not be inferred from rider rules

## Worker Schedule Canonical Model

Recommended planning fields:

1. `workerId`
2. `role`
3. `branchId` or assignment context
4. `scheduleDate`
5. `startAt`
6. `endAt`
7. `templateAssignmentId` nullable
8. `note`
9. `createdById`
10. `updatedById`
11. `publishedById`
12. `publishedAt`

Recommended schedule statuses:

1. `DRAFT`
2. `PUBLISHED`
3. `CANCELLED`
4. `COMPLETED`

Planning rules:

1. no overlapping published schedules for the same worker in the same time window
2. publish actions must be manager-authored and auditable
3. schedule edits must not erase prior staffing exceptions
4. schedule planning is not by itself an access grant

## Recurring Schedule Template Canonical Model

Recommended template fields:

1. `templateName`
2. `branchId`
3. `role` nullable
4. `effectiveFrom`
5. `effectiveTo` nullable
6. `status`
7. `createdById`
8. `updatedById`

Recommended template assignment fields:

1. `templateId`
2. `workerId`
3. `effectiveFrom`
4. `effectiveTo` nullable
5. `status`
6. `createdById`
7. `updatedById`

Recommended weekly work-day fields under the template:

1. `dayOfWeek`
2. `startAt`
3. `endAt`
4. `note` nullable

Recommended template statuses:

1. `ACTIVE`
2. `PAUSED`
3. `ENDED`

Recommended assignment statuses:

1. `ACTIVE`
2. `PAUSED`
3. `ENDED`

Recurring template rules:

1. V1 templates are weekly only; advanced alternating or rotating schedules are out of scope
2. one template may be assigned to many workers
3. templates generate `WORK_DAY` schedule entries only
4. dates with no generated schedule entry are treated as `REST_DAY / no duty`
5. template edits affect future generation only
6. existing generated schedules must remain unchanged unless a manager edits those schedule rows directly
7. generated schedule rows remain the per-date source of truth for attendance, payroll input, and audit history

## Attendance / Duty Result Canonical Model

Recommended factual fields:

1. `workerId`
2. `scheduleId` nullable
3. `dutyDate`
4. `dayType`
5. `attendanceResult`
6. `workContext`
7. `leaveType` nullable
8. `lateFlag`
9. `note`
10. `recordedById`
11. `recordedAt`

Recommended day types:

1. `WORK_DAY`
2. `REST_DAY`
3. `REGULAR_HOLIDAY`
4. `SPECIAL_HOLIDAY`

Recommended attendance results:

1. `WHOLE_DAY`
2. `HALF_DAY`
3. `ABSENT`
4. `LEAVE`
5. `NOT_REQUIRED`
6. `SUSPENDED_NO_WORK`

Recommended work contexts:

1. `REGULAR`
2. `REPLACEMENT`
3. `ON_CALL`

Recommended late flags:

1. `NO`
2. `YES`

V1 leave scope:

1. `SICK_LEAVE`

Key rules:

1. `REST_DAY` or holiday not worked must be recorded as `NOT_REQUIRED`, not `ABSENT`
2. replacement or on-call coverage must preserve the original `dayType` and use `workContext` to explain the staffing exception
3. `LEAVE` is separate from `ABSENT`
4. `SUSPENDED_NO_WORK` is separate from `ABSENT` and preserves the original planned schedule for audit
5. `lateFlag` is a simple `YES` / `NO` attendance fact for discipline and incentive eligibility only; it does not yet drive minute-based pay math
6. payroll consumes this factual record, but pay treatment is owned by `CANONICAL_WORKER_PAYROLL_POLICY_AND_RUN_FLOW.md`

## Suspension Record Canonical Model

Recommended suspension fields:

1. `workerId`
2. `startDate`
3. `endDate`
4. `reasonType`
5. `managerNote`
6. `status`
7. `appliedById`
8. `liftedById` nullable
9. `appliedAt`
10. `liftedAt` nullable

Recommended statuses:

1. `ACTIVE`
2. `LIFTED`
3. `ENDED`

Suspension rules:

1. V1 suspension is manager-applied only; the system must not auto-suspend based on absence or lateness counts
2. V1 suspension is whole-day only
3. active suspension must block the worker from being treated as present/on-duty on the affected date
4. existing schedule rows must not be deleted because of suspension
5. affected scheduled dates must preserve the original plan and record `attendanceResult = SUSPENDED_NO_WORK`
6. suspension reasons and manager notes must remain auditable for later employee and manager performance review

## Schedule Event Log Canonical Model

The schedule event log is append-only under a schedule slot.

Recommended event fields:

1. `scheduleId`
2. `eventType`
3. `actorUserId`
4. `subjectWorkerId`
5. `relatedWorkerId` nullable
6. `note`
7. `effectiveAt`
8. `createdAt`

Recommended event types:

1. `MARKED_ABSENT`
2. `REPLACEMENT_ASSIGNED`
3. `REPLACEMENT_REMOVED`
4. `ON_CALL_ASSIGNED`
5. `EARLY_OUT_RECORDED`
6. `EMERGENCY_LEAVE_RECORDED`
7. `SWAP_REQUESTED`
8. `SWAP_APPROVED`
9. `SWAP_DECLINED`
10. `NO_SHOW_RECORDED`
11. `SCHEDULE_CANCELLED`
12. `MANAGER_NOTE_ADDED`
13. `SUSPENSION_APPLIED`
14. `SUSPENSION_LIFTED`

Key rule:

1. staffing exceptions must be recorded as timeline events, not hidden by overwriting one schedule row

## Rider Duty Session Canonical Model

Recommended rider duty-session fields:

1. `riderId`
2. `scheduleId` nullable
3. `status`
4. `openedAt`
5. `closedAt`
6. `openedById`
7. `closedById`
8. `openReason`
9. `closeReason`
10. `note`

Recommended statuses:

1. `OPEN`
2. `CLOSED`

Recommended open reasons:

1. `SCHEDULED_START`
2. `REPLACEMENT`
3. `ON_CALL`
4. `MANUAL_MANAGER_OPEN`

Recommended close reasons:

1. `END_OF_DUTY`
2. `EARLY_OUT`
3. `EMERGENCY`
4. `FORCE_CLOSE`

Binding direction:

1. no active rider duty session = rider operational features disabled
2. only one active rider duty session per rider
3. manager is the authority to open and close rider duty sessions
4. schedule changes do not transfer access by themselves

## Cashier Schedule Boundary

Cashier-side SoT remains split:

1. schedule plans who is expected
2. schedule event log records staffing changes
3. `CashierShift` remains the actual drawer/accountability session

Current cashier shift lifecycle remains:

1. `PENDING_ACCEPT`
2. `OPEN`
3. `OPENING_DISPUTED`
4. `SUBMITTED`
5. `FINAL_CLOSED`

Legacy enum note:

1. `RECOUNT_REQUIRED` exists in schema/history but is not part of the active forward flow

Cashier boundary rules:

1. cashier schedule does not unlock cashier money lanes
2. cashier close authority remains manager-side during final recount
3. staffing changes must not silently transfer drawer accountability from one cashier to another
4. any actual cashier takeover requires a separate manager-opened cashier shift for the cashier who really reports
5. cashier mismatch acknowledgment artifact remains the signed printed recount form defined in `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`

## Real-World Scenario Handling

### 1. Scheduled worker absent

1. keep the original schedule slot
2. record `MARKED_ABSENT`
3. if replacement exists, record `REPLACEMENT_ASSIGNED`
4. if on-call worker is used, record `ON_CALL_ASSIGNED`
5. open duty or shift only for the actual worker who will perform the job

Cashier-specific note:

1. if the absent worker is a cashier, do not transfer drawer accountability
2. open a fresh cashier shift for the replacement cashier only after manager authorization

### 2. Early out / emergency

1. record `EARLY_OUT_RECORDED` or emergency leave event
2. close the active duty session or cashier shift through the proper operational path
3. if another worker takes over, record replacement or on-call event
4. open a new duty session or cashier shift for the actual replacement worker

Cashier-specific note:

1. mid-duty replacement requires the current cashier to follow close or turnover controls first
2. replacement cashier must get a new cashier shift; the previous shift is not silently reused

### 3. Planned swap

1. record `SWAP_REQUESTED`
2. manager records `SWAP_APPROVED` or `SWAP_DECLINED`
3. do not silently overwrite history
4. operational access opens only for the worker who actually reports for duty

### 4. Replacement or swap partner also no-show

1. record `NO_SHOW_RECORDED`
2. assign another replacement or on-call worker if available
3. operational access stays blocked until manager opens duty or shift for the actual worker who reports

## Non-Negotiable Rules

1. scheduling is not the same as operational access
2. rider features require an active rider duty session
3. cashier money lanes require an active cashier shift in writable state
4. staffing changes must be auditable as timeline events
5. access never transfers silently from one worker to another
6. replacement and on-call coverage always require a new manager-opened operational session for the worker who actually reports
7. cashier schedule planning must not weaken the current cashier drawer accountability model
8. payroll must consume attendance facts without redefining them
