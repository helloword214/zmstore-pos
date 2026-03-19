# Employee Account Management Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

## Purpose

Validate the first post-create employee directory controls using a seeded `CASHIER` account in `/creation/employees`.

## Scope

This checklist covers:

1. admin-only access to `/creation/employees`
2. resend-invite for a `PENDING_PASSWORD` account
3. deactivate and reactivate account controls
4. user and employee active-state sync
5. password-reset token refresh behavior after resend

## Preconditions

1. an active `ADMIN` account exists
2. at least one branch exists for default user assignment
3. at least one active province -> municipality -> barangay chain exists
4. run `npm run qa:employee:account-management:happy-path:setup`

## Browser QA Steps

1. open `/creation/employees` as `ADMIN`
2. locate the tagged cashier row by printed email
3. confirm the row shows `ACTIVE`, `PASSWORD_MISSING`, `Resend Invite`, and `Deactivate`
4. click `Resend Invite`
5. confirm the success alert `Password setup link re-sent.`
6. click `Deactivate`
7. confirm the success alert `Account deactivated.`
8. confirm the tagged row now shows `INACTIVE` and `Activate`
9. click `Activate`
10. confirm the success alert `Account reactivated.`
11. confirm the tagged row returns to `ACTIVE` and `Deactivate`

## Expected Outcomes

1. the seeded user stays in lane `CASHIER`
2. `User.authState` remains `PENDING_PASSWORD`
3. `User.passwordHash` remains empty
4. resend-invite leaves exactly one active unused token and marks the older token as used
5. deactivate sets both `User.active` and linked `Employee.active` to `false`
6. reactivate sets both `User.active` and linked `Employee.active` back to `true`
7. branch mapping and role linkage remain unchanged throughout

## Cleanup

1. run `npm run qa:employee:account-management:happy-path:cleanup`
2. confirm the tagged user and employee artifacts were removed

