# Employee Role Switch Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

## Purpose

Validate the first employee directory role-switch flow using a seeded `CASHIER` account in `/creation/employees`.

## Scope

This checklist covers:

1. admin-only access to `/creation/employees`
2. switching a seeded cashier account to `RIDER`
3. switching the same seeded rider account back to `CASHIER`
4. user-role and employee-role sync during both switches
5. role-assignment and role-audit trail creation for both actions

## Preconditions

1. an active `ADMIN` account exists
2. at least one branch exists for default user assignment
3. at least one active province -> municipality -> barangay chain exists
4. run `npm run qa:employee:role-switch:happy-path:setup`

## Browser QA Steps

1. open `/creation/employees` as `ADMIN`
2. locate the tagged cashier row by printed email
3. confirm the row shows `CASHIER`, `ACTIVE`, `PASSWORD_READY`, and `Switch to RIDER`
4. enter the printed cashier-to-rider reason
5. click `Switch to RIDER`
6. confirm the success alert `Role switched to RIDER. User must re-login with new role lane.`
7. confirm the tagged row now shows `RIDER` and `Switch to CASHIER`
8. enter the printed rider-to-cashier reason
9. click `Switch to CASHIER`
10. confirm the success alert `Role switched to CASHIER. User must re-login with new role lane.`
11. confirm the tagged row returns to `CASHIER` and `Switch to RIDER`

## Expected Outcomes

1. `User.role` changes `CASHIER -> EMPLOYEE -> CASHIER`
2. `Employee.role` changes `STAFF -> RIDER -> STAFF`
3. the original active `UserRoleAssignment` is ended after the first switch
4. each submitted switch reason is stored on the new active `UserRoleAssignment`
5. one `UserRoleAuditEvent` is added for each switch
6. branch linkage and active-state values remain unchanged throughout
7. manager switching remains out of scope for this scenario family

## Cleanup

1. run `npm run qa:employee:role-switch:happy-path:cleanup`
2. confirm the tagged user and employee artifacts were removed
