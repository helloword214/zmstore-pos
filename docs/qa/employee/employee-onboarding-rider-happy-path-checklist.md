# Employee Onboarding Rider Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-19

## Purpose

Validate the second employee onboarding lane using the live create form for a `RIDER` account with default vehicle, rider license metadata, primary address, and invite-ready auth state.

## Scope

This checklist covers:

1. admin-only access to `/creation/employees/new`
2. required identity and primary address capture
3. rider-specific vehicle and license field capture
4. successful employee and linked user creation
5. invite-ready password setup state after submit
6. employee directory visibility for the newly created rider row

## Preconditions

1. an active `ADMIN` account exists
2. at least one branch exists for default user assignment
3. at least one active province -> municipality -> barangay chain exists
4. at least one active vehicle exists
5. run `npm run qa:employee:onboarding-rider:happy-path:setup`

## Browser QA Steps

1. open `/creation/employees/new` as `ADMIN`
2. select `RIDER` in `Lane`
3. fill the printed tagged values for:
   `First Name`, `Last Name`, `Phone`, `Email`, `License Number`, `License Expiry`, `House/Street`
4. choose the printed `Default Vehicle`, `Province`, `Municipality / City`, and `Barangay`
5. leave compliance uploads empty for this first rider happy path
6. submit `Create Employee Account`
7. confirm the success alert that starts with `Employee account created with primary address.`
8. open `/creation/employees`
9. locate the tagged row by email and confirm:
   `RIDER`, `ACTIVE`, `PASSWORD_MISSING`, and `Resend Invite`

## Expected Outcomes

1. one active `Employee` record exists for the tagged identity
2. `Employee.role = RIDER`
3. `Employee.defaultVehicleId` matches the selected active vehicle
4. `licenseNumber` and `licenseExpiry` are saved on the employee
5. one primary `EmployeeAddress` record exists with the selected master refs and snapshot text
6. one linked `User` exists with role `EMPLOYEE`
7. `User.authState` is `PENDING_PASSWORD`
8. no password hash exists yet
9. one default `UserBranch` mapping exists
10. one active unused `PasswordResetToken` exists
11. one `UserRoleAssignment` and one `UserRoleAuditEvent` exist with reason `INITIAL_CREATE_BY_ADMIN`

## Cleanup

1. run `npm run qa:employee:onboarding-rider:happy-path:cleanup`
2. confirm the tagged rider employee and user artifacts were removed

