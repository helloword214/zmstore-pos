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
3. `app/routes/creation.riders.tsx`
4. `app/routes/creation.vehicles.tsx`
5. `app/routes/creation.areas.tsx`
6. `app/routes/creation.provinces.tsx`
7. `app/routes/customers._index.tsx`
8. `app/routes/customers.new.tsx`
9. `app/routes/customers.$id.tsx`
10. `app/routes/customers.$id_.edit.tsx`
11. `app/routes/customers.$id_.pricing.tsx`
12. `app/routes/customers.$id_.pricing_.$ruleId.tsx`

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

## Cross-Doc Contract

1. This role-boundary SoT must be read together with:
   - `docs/guide/Commercial Clearance System V2`
   - `docs/guide/CANONICAL_DELIVERY_CASH_AR_FLOW.md`
   - `docs/guide/CANONICAL_CASHIER_SHIFT_VARIANCE_FLOW.md`
2. If any route-level flow doc conflicts on role authority, this file controls role/access interpretation.

## Known Implementation Drift (2026-02-26)

Canonical authority is already defined above, but current code still allows `ADMIN` access in some manager operational routes.

Current drift examples:

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

Follow-up code patch must remove `ADMIN` from those route guards to fully match this canonical doc.
