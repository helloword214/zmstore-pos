# Employee Onboarding Create Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

## Purpose

Validate the first stable admin employee onboarding lane using the live create form for a `CASHIER` account with primary address and invite-ready auth state.

## Scope

This checklist covers:

1. admin-only access to `/creation/employees/new`
2. required identity and primary address capture
3. successful employee and linked user creation
4. invite-ready password setup state after submit
5. employee directory visibility for the newly created row

## Preconditions

1. an active `ADMIN` account exists
2. at least one branch exists for default user assignment
3. at least one active province -> municipality -> barangay chain exists
4. run `npm run qa:employee:onboarding-create:happy-path:setup`

## Browser QA Steps

1. open `/creation/employees/new` as `ADMIN`
2. select `CASHIER` in `Lane`
3. fill the printed tagged values for:
   `First Name`, `Last Name`, `Phone`, `Email`, `House/Street`
4. choose the printed `Province`, `Municipality / City`, and `Barangay`
5. leave compliance uploads empty for this first happy path
6. submit `Create Employee Account`
7. confirm the success alert that starts with `Employee account created with primary address.`
8. open `/creation/employees`
9. locate the tagged row by email and confirm:
   `CASHIER`, `ACTIVE`, `PASSWORD_MISSING`, and `Resend Invite`

## Expected Outcomes

1. one active `Employee` record exists for the tagged identity
2. one primary `EmployeeAddress` record exists with the selected master refs and snapshot text
3. one linked `User` exists with role `CASHIER`
4. `User.authState` is `PENDING_PASSWORD`
5. no password hash exists yet
6. one default `UserBranch` mapping exists
7. one active unused `PasswordResetToken` exists
8. one `UserRoleAssignment` and one `UserRoleAuditEvent` exist with reason `INITIAL_CREATE_BY_ADMIN`

## Cleanup

1. run `npm run qa:employee:onboarding-create:happy-path:cleanup`
2. confirm the tagged employee and user artifacts were removed

