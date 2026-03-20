# Employee Profile Edit Happy Path Checklist

Status: ACTIVE
Owner: POS Platform
Last Reviewed: 2026-03-20

## Purpose

Validate the first employee profile edit flow using a seeded `RIDER` account in `/creation/employees/:employeeId/edit`.

## Scope

This checklist covers:

1. admin-only access to the employee edit route
2. updating rider identity fields
3. updating rider contact and email fields
4. updating rider license metadata and default vehicle
5. updating address detail fields without changing role or branch state

## Preconditions

1. an active `ADMIN` account exists
2. at least one branch exists for default user assignment
3. at least one active province -> municipality -> barangay chain exists
4. at least one active vehicle exists
5. run `npm run qa:employee:profile-edit:happy-path:setup`

## Browser QA Steps

1. open the printed edit route as `ADMIN`
2. confirm the page title starts with `Edit Employee -`
3. replace the printed rider profile fields with the updated values
4. click `Save Employee Profile`
5. confirm the success alert `Employee profile updated.`
6. confirm the page reflects the updated rider identity and contact values
7. open `/creation/employees`
8. confirm the tagged row now shows the updated name, alias, phone, email, and address line

## Expected Outcomes

1. `User.role` remains `EMPLOYEE`
2. `Employee.role` remains `RIDER`
3. `UserBranch` linkage remains unchanged
4. `User.email` and `Employee.email` update to the new value
5. rider license fields update correctly
6. `defaultVehicleId` updates to the selected active vehicle
7. `EmployeeAddress` stores the updated line, purok, postal code, and landmark fields
8. no new role-switch audit events are created by this edit flow

## Cleanup

1. run `npm run qa:employee:profile-edit:happy-path:cleanup`
2. confirm the tagged user and employee artifacts were removed
