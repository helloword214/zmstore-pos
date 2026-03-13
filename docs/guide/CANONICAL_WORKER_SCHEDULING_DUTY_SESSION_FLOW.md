# Canonical Worker Scheduling + Duty Session Flow

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-03-13

## Purpose

Defines one source of truth for:

1. worker schedule planning
2. staffing exception history
3. rider duty-session access gating
4. cashier schedule alignment with the existing `CashierShift` lifecycle

This document exists so scheduling, operational access, and cashier drawer accountability do not get merged into one unclear flow.

## Owns

This document owns:

1. worker schedule planning rules for `CASHIER`, `EMPLOYEE`, and rider-linked `EMPLOYEE`
2. staffing exception history through append-only schedule events
3. rider duty-session authority, lifecycle, and access-gating rules
4. the boundary between cashier schedule planning and cashier drawer shift ownership
5. real-world staffing scenarios such as absence, replacement, on-call coverage, early out, swap, and replacement no-show

## Does Not Own

This document does not own:

1. cashier drawer close/recount/variance mechanics
2. delivery -> cashier -> AR end-to-end flow
3. file upload/storage contracts for scanned attachments
4. payroll computation and deduction rules
5. leave filing, biometric attendance, or recurring schedule automation
6. final route/file/module names for future scheduling implementation

## Refer To

1. `CANONICAL_IDENTITY_ACCESS_FLOW.md` for role boundaries and route access ownership
2. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md` for cashier shift lifecycle, final close, recount, and signed paper audit handling
3. `CANONICAL_DELIVERY_CASH_AR_FLOW.md` for wider delivery/remit/cashier/AR stage flow
4. `CANONICAL_UPLOAD_STORAGE_SOT.md` for any future in-system scan/upload attachment behavior

## Scope

This document covers:

1. planned schedules for `CASHIER`, `STORE_MANAGER`, and `EMPLOYEE` workers used in store operations
2. staffing history for schedule changes and exceptions
3. manager-controlled rider duty sessions as the rider operational access gate
4. cashier schedule planning only, while preserving `CashierShift` as the cashier money-lane SoT

This document does not yet define:

1. final UI route names
2. payroll formulas
3. leave approval flows
4. biometric or GPS attendance
5. recurring schedule templates
6. non-rider employee duty-session enforcement

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

### 3. Rider Duty Session

`Rider Duty Session` is the actual rider access gate.

It answers:

1. whether a rider is currently authorized to use rider operational features
2. who opened that authorization
3. when it started and ended
4. whether the rider is covering a normal schedule, replacement, or on-call case

Schedule alone must not unlock rider features.

### 4. Cashier Shift

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
2. record staffing exceptions
3. assign replacements and on-call coverage
4. open and close rider duty sessions
5. open cashier shifts for the actual cashier on duty
6. keep staffing history auditable

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
7. `note`
8. `createdById`
9. `updatedById`
10. `publishedById`
11. `publishedAt`

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
