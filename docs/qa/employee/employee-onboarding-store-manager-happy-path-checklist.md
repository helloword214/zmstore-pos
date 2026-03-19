# Employee Onboarding Store Manager Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

## Purpose

Validate the third employee onboarding lane using the live create form for a `STORE_MANAGER` account with primary address, protected-lane directory state, and invite-ready auth flow.

## Scope

This checklist covers:

1. admin-only access to `/creation/employees/new`
2. required identity and primary address capture
3. successful employee and linked store-manager user creation
4. invite-ready password setup state after submit
5. protected-lane directory visibility for the newly created manager row

## Preconditions

1. an active `ADMIN` account exists
2. at least one branch exists for default user assignment
3. at least one active province -> municipality -> barangay chain exists
4. run `npm run qa:employee:onboarding-store-manager:happy-path:setup`

## Browser QA Steps

1. open `/creation/employees/new` as `ADMIN`
2. select `STORE_MANAGER (staff)` in `Lane`
3. fill the printed tagged values for:
   `First Name`, `Last Name`, `Phone`, `Email`, `House/Street`
4. choose the printed `Province`, `Municipality / City`, and `Barangay`
5. leave compliance uploads empty for this first store-manager happy path
6. submit `Create Employee Account`
7. confirm the success alert that starts with `Employee account created with primary address.`
8. open `/creation/employees`
9. locate the tagged row by email and confirm:
   `STORE_MANAGER (STAFF)`, `ACTIVE`, `PASSWORD_MISSING`, `Resend Invite`, and `Protected lane. Manager switch is blocked here.`

## Expected Outcomes

1. one active `Employee` record exists for the tagged identity
2. `Employee.role = MANAGER`
3. one primary `EmployeeAddress` record exists with the selected master refs and snapshot text
4. one linked `User` exists with role `STORE_MANAGER`
5. `User.managerKind = STAFF`
6. `User.authState` is `PENDING_PASSWORD`
7. no password hash exists yet
8. no default vehicle assignment exists for this onboarding lane
9. one default `UserBranch` mapping exists
10. one active unused `PasswordResetToken` exists
11. one `UserRoleAssignment` and one `UserRoleAuditEvent` exist with reason `INITIAL_CREATE_BY_ADMIN`

## Cleanup

1. run `npm run qa:employee:onboarding-store-manager:happy-path:cleanup`
2. confirm the tagged store-manager employee and user artifacts were removed

