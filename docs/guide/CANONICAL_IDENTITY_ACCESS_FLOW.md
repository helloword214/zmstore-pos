# Canonical Identity + Access Flow

Status: LOCKED
Owner: POS Platform
Last Reviewed: 2026-02-26

## Purpose

Defines canonical role authority boundaries for:

1. identity model (`User` and `Employee`)
2. route-level access control
3. operational/commercial authority ownership

This document is the binding authority for role boundaries.

## Core Identity Model

1. `Employee` is the person/profile record used by operations (rider assignment, names, staffing metadata).
2. `User` is the authentication/access record (`email`/`password` or `pin`, role, active flag).
3. Canonical target mapping is one person to one account (`Employee` to `User` is 1:1 for active accounts).
4. `ADMIN` may exist without linked `Employee` because it is a control-plane role.

## Canonical Role Authority Matrix

| Role | Authority domain | Must never do |
| --- | --- | --- |
| `ADMIN` | Creation/control-plane only (master records, setup, account provisioning) | Enter operational money lanes, dispatch lanes, clearance decisions, remit close decisions, payroll settlement decisions |
| `STORE_MANAGER` | Operational and commercial authority (dispatch, clearance, remit, shift final-close, payroll decisions) | Delegate commercial decisions to cashier/rider/admin |
| `CASHIER` | Cash posting, remit encoding, shift submit, AR payment posting, charged-item acknowledgement | Perform manager commercial approvals or manager final-close decisions |
| `EMPLOYEE` (Rider lane) | Rider execution lanes (check-in facts, run view, shortage acknowledgement) | Perform manager/cashier approvals or commercial decisions |

## Route Group Authority (Canonical)

### A) Admin Creation/Setup Routes

Allowed role: `ADMIN` only.

Representative routes:

1. `app/routes/_index.tsx`
2. `app/routes/creation._index.tsx`
3. `app/routes/creation.employees.tsx`
4. `app/routes/creation.riders.tsx`
5. `app/routes/creation.vehicles.tsx`
6. `app/routes/creation.areas.tsx`
7. `app/routes/creation.provinces.tsx`
8. `app/routes/customers._index.tsx`
9. `app/routes/customers.new.tsx`
10. `app/routes/customers.$id.tsx`
11. `app/routes/customers.$id_.edit.tsx`
12. `app/routes/customers.$id_.pricing.tsx`
13. `app/routes/customers.$id_.pricing_.$ruleId.tsx`

### B) Manager Operational/Commercial Routes

Allowed role: `STORE_MANAGER` only.

Representative routes:

1. `app/routes/store._index.tsx`
2. `app/routes/store.dispatch.tsx`
3. `app/routes/runs.$id.dispatch.tsx`
4. `app/routes/store.clearance.tsx`
5. `app/routes/store.clearance_.$caseId.tsx`
6. `app/routes/runs.$id.remit.tsx`
7. `app/routes/store.cashier-shifts.tsx`
8. `app/routes/store.cashier-variances.tsx`
9. `app/routes/store.cashier-ar.tsx`
10. `app/routes/store.payroll.tsx`

Hard rule:

1. `ADMIN` is not allowed in this route group, including read-only access.

### C) Cashier Money Lanes

Allowed role: `CASHIER` only, unless a route-level canonical doc explicitly states otherwise.

Representative routes:

1. `app/routes/cashier.$id.tsx`
2. `app/routes/cashier.delivery._index.tsx`
3. `app/routes/cashier.delivery.$runId.tsx`
4. `app/routes/delivery-remit.$id.tsx`
5. `app/routes/cashier.shift.tsx`
6. `app/routes/cashier.charges.tsx`
7. `app/routes/ar._index.tsx`
8. `app/routes/ar.customers.$id.tsx`

### D) Rider Execution Lanes

Allowed role: `EMPLOYEE` with rider-linked employee profile.

Representative routes:

1. `app/routes/rider._index.tsx`
2. `app/routes/rider.variances.tsx`
3. `app/routes/rider.variance.$id.tsx`
4. `app/routes/runs.$id.rider-checkin.tsx`
5. `app/routes/runs.$id.summary.tsx` (`mine` rider scope)

## Employee Role Lifecycle (Binding)

1. Role switching is immediate once approved and validated.
2. Only `ADMIN` may perform role switch actions.
3. System supports single active operational role per user at any time.
4. Normal role switching allows only:
   - `CASHIER -> RIDER`
   - `RIDER -> CASHIER`
5. Any switch involving `STORE_MANAGER` is blocked in normal role switch flow.
6. Manager role assignment/revocation is a protected governance action and must use a separate secured flow.

## Manager Identity Model (Binding)

1. `STORE_MANAGER` remains a role on `User`, not a separate entity.
2. A manager may be:
   - `staff-manager`: linked to an `Employee` profile
   - `owner-manager`: no `Employee` link required
3. Both manager variants have identical operational/commercial authority.
4. Neither variant can be converted through normal cashier/rider switching flow.

## Role Switch Request Contract

Required input:

1. `employeeId`
2. `targetRole` (`CASHIER` or `RIDER`)
3. `reason`
4. `requestedByUserId` (must be `ADMIN`)

Validation rules:

1. Request actor must be `ADMIN`.
2. Source and target roles must be in `{CASHIER, RIDER}` only.
3. Source and target roles must be different.
4. If current role or target role is `STORE_MANAGER`, reject.
5. If employee or linked user is inactive, reject.

## Hard Stop Blockers (Immediate Switch)

Switch is rejected when any blocker exists:

1. Open cashier shift under target user identity.
2. Active run obligations tied to rider identity (assigned ongoing run/check-in duties).
3. Pending rider-acceptance tasks that require the current rider.
4. Any unresolved obligations defined by canonical manager/cashier/rider flow docs.

## Atomic Mutation + Audit Contract

All role switch writes must run in one transaction:

1. Close current active role assignment history row (`endedAt`).
2. Insert new role assignment history row (`startedAt`, `changedBy`, `reason`).
3. Update current active role on `User`.
4. Append immutable audit event (`beforeRole`, `afterRole`, actor, timestamp, reason).
5. Revoke active sessions for switched user (force re-login).

Failure rule:

1. If any step fails, commit nothing.

## Role Switch Flow (Canonical)

```mermaid
flowchart TD
    A["Admin submits role switch"] --> B{"Actor is ADMIN?"}
    B -- "No" --> X["Reject"]
    B -- "Yes" --> C{"Source/target in CASHIER<->RIDER only?"}
    C -- "No" --> Y["Reject (protected role path)"]
    C -- "Yes" --> D{"Any hard-stop blocker?"}
    D -- "Yes" --> Z["Reject with blocker reason"]
    D -- "No" --> E["Single transaction:\nclose old assignment\ncreate new assignment\nupdate user role\naudit log\nrevoke sessions"]
    E --> F["User re-login with new role lane"]
```

## Cross-Doc Contract

1. This role-boundary SoT must be read together with:
   - `docs/guide/Commercial Clearance System V2`
   - `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
   - `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
2. If any route-level flow doc conflicts on role authority, this file controls role/access interpretation.

## Known Implementation Drift (2026-02-26)

Canonical authority is already defined above, but current code still allows `ADMIN` access in some manager operational routes.

Access drift examples:

1. `app/routes/store._index.tsx`
2. `app/routes/store.dispatch.tsx`
3. `app/routes/runs.$id.dispatch.tsx`
4. `app/routes/store.clearance.tsx`
5. `app/routes/store.clearance_.$caseId.tsx`
6. `app/routes/runs.$id.remit.tsx`
7. `app/routes/store.cashier-shifts.tsx`
8. `app/routes/store.cashier-variances.tsx`
9. `app/routes/store.cashier-ar.tsx`
10. `app/routes/store.payroll.tsx`

Role lifecycle drift:

1. Normalized role-assignment history flow and immediate switch contract are not yet fully implemented in runtime code.

Follow-up code patch must:

1. Remove `ADMIN` from manager-route guards listed above.
2. Implement canonical immediate role switch flow (`CASHIER <-> RIDER` only, admin-only actor).
3. Enforce protected manager role handling outside normal switch flow.
