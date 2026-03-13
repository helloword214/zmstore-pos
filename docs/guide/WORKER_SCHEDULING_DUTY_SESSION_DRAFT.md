# Worker Scheduling + Duty Session Draft

Status: DRAFT
Owner: POS Platform
Last Reviewed: 2026-03-13

## Purpose

Define a draft Source-of-Truth direction for worker scheduling, staffing exceptions, and operational duty gating without disturbing the existing cashier money-lane controls.

This draft exists to separate four concepts that should not be merged:

1. worker schedule planning
2. staffing change history
3. rider/worker operational access windows
4. cashier drawer accountability

## Scope

This draft covers:

1. planned schedules for `CASHIER`, `RIDER`, and `EMPLOYEE`
2. messy real-world staffing changes:
   - absence
   - replacement
   - on-call activation
   - early out / emergency leave
   - swap
   - replacement no-show
3. rider access gating through a manager-controlled duty session
4. cashier schedule alignment with the existing `CashierShift` flow

This draft does not yet define:√

1. payroll computation rules
2. leave filing and approval
3. automatic recurring schedule generation
4. biometric attendance
5. final route/file names for new scheduling modules

## Domain Separation (Binding Direction)

### 1. Worker Schedule

`Worker Schedule` is the planning layer.

It answers:

1. who is expected to work
2. on what date
3. during what time window
4. in what role and assignment context

It does not, by itself, unlock operational access.

### 2. Schedule Event Log

`Schedule Event Log` is the append-only staffing history under one planned schedule slot.

It answers:

1. what changed
2. who changed it
3. when it changed
4. why it changed

It should preserve chronology instead of overwriting staffing history.

### 3. Rider Duty Session

`Rider Duty Session` is the actual rider access gate.

It answers:

1. is this rider currently authorized to use rider operational features
2. who opened that authorization
3. when it started and ended
4. whether the rider is covering a normal schedule, replacement, or on-call case

Schedule alone must not unlock rider features.

### 4. Cashier Shift

`CashierShift` remains the current cashier drawer/accountability session and must not be replaced by generic scheduling records.

It answers:

1. who owns the drawer
2. what opening float was accepted
3. what cash activity occurred under that drawer
4. what closing count was submitted
5. what manager recount and close decision finalized the shift

Schedule alone must not unlock cashier money lanes.

## Authority Model (Draft)

### Store Manager

`STORE_MANAGER` is the primary authority for this feature set.

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

Rider does not self-open duty in the current draft direction.

### Cashier

Cashier responsibilities:

1. view own schedule
2. wait for manager-opened cashier shift
3. verify opening float
4. operate only while `CashierShift.status = OPEN`
5. submit closing count once

Cashier schedule does not replace cashier shift.

## Worker Schedule Draft Model

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

Recommended planning rules:

1. no overlapping published schedules for the same worker in the same time window
2. publishing should be manager-authored and auditable
3. schedule edits should not erase prior staffing exceptions

## Schedule Event Log Draft Model

The event log should be append-only under a schedule slot.

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

1. staffing exceptions should be recorded as events, not hidden by overwriting a single schedule row

## Rider Duty Session Draft Model

Recommended rider duty session fields:

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

## Cashier Side: Keep Schedule and Shift Separate

Current cashier operational SoT remains:

1. schedule plans who is expected
2. schedule event log records staffing changes
3. `CashierShift` remains the actual drawer/accountability session

Current cashier shift lifecycle already implemented:

1. `PENDING_ACCEPT`
2. `OPEN`
3. `OPENING_DISPUTED`
4. `SUBMITTED`
5. `FINAL_CLOSED`

Legacy enum note:

1. `RECOUNT_REQUIRED` exists in schema/history but is not part of the active forward flow

Current cashier close rule to preserve:

1. cashier submits one closing count
2. manager recount is the final authority at close time
3. shortage decision is manager-authored during final close
4. there is no active post-submit send-back flow for cashier recount correction in the shift routes

## Cashier Paper Form Rule (Important Draft Note)

The current cashier mismatch acknowledgment artifact is paper-based.

Operational rule:

1. when manager recount detects a shortage or mismatch worth variance documentation, the A4 variance/recount form printed from `store.cashier-shifts.tsx` should be used
2. the paper should contain:
   - shift reference
   - cashier count
   - manager recount
   - variance
   - decision
   - paper reference number
   - cashier signature
   - manager signature
3. the signed paper should be scanned and attached to the corresponding shift variance audit package

Current implementation note:

1. current code already supports printing the A4 variance form and storing `paperRefNo`
2. current code does not yet expose a dedicated in-system scan/upload attachment lane for that signed paper
3. if scan attachment is implemented later, it must follow `CANONICAL_UPLOAD_STORAGE_SOT.md`

Draft audit interpretation:

1. digital final-close authority remains manager-side
2. physical signed paper is the present acknowledgment artifact for mismatch cases
3. a future in-system cashier acknowledgment step can be added later without changing the current cashier close authority model

## Real-World Scenario Handling (Draft)

### 1. Scheduled worker absent

1. keep the original schedule slot
2. record `MARKED_ABSENT`
3. if replacement exists, record `REPLACEMENT_ASSIGNED`
4. if on-call worker is used, record `ON_CALL_ASSIGNED`
5. open duty/shift only for the actual worker who will perform the job

### 2. Early out / emergency

1. record `EARLY_OUT_RECORDED` or emergency note event
2. close the active duty session or cashier shift using the proper operational path
3. if another worker takes over, record replacement/on-call event
4. open a new duty session or cashier shift for the actual replacement worker

### 3. Planned swap

1. record `SWAP_REQUESTED`
2. manager records `SWAP_APPROVED` or `SWAP_DECLINED`
3. do not silently overwrite history
4. open operational access only for the worker who actually reports for duty

### 4. Replacement or swap partner also no-show

1. record `NO_SHOW_RECORDED`
2. assign another replacement or on-call worker if available
3. operational access stays blocked until manager opens duty/shift for the actual worker who reports

## Non-Negotiable Draft Rules

1. scheduling is not the same as operational access
2. rider features require an active rider duty session
3. cashier money lanes require an active cashier shift in writable state
4. staffing changes must be auditable as timeline events
5. access never transfers silently from one worker to another
6. replacement/on-call coverage always requires a new manager-opened operational session for the worker who actually reports

## Suggested Route Targets (Draft, Subject to Approval)

These names are placeholders for future discussion only.

1. manager schedule board: `/store/worker-schedules`
2. worker self-view: `/me/schedule`
3. manager rider duty panel: `/store/rider-duty`
4. rider duty status page or resume surface: `/rider/duty`

## Relationship to Existing Canonical Docs

This draft must not override current canonical operational docs.

Current canonical authority remains in:

1. `CANONICAL_IDENTITY_ACCESS_FLOW.md`
2. `CANONICAL_DELIVERY_CASH_AR_FLOW.md`
3. `CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
4. `DIAGRAMS_DELIVERY_CSS_AR.md`

This draft should become canonical only after:

1. status and authority model are approved
2. route targets are approved
3. data model and audit requirements are confirmed
