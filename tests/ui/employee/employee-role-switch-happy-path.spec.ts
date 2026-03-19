import {
  EmployeeRole,
  UserRole,
} from "@prisma/client";
import { expect, test } from "@playwright/test";
import {
  EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_ENABLE_ENV,
  bootstrapEmployeeRoleSwitchHappyPathSession,
  cleanupEmployeeRoleSwitchHappyPathQaState,
  expectEmployeeRoleSwitchHappyPathDirectoryRowState,
  expectEmployeeRoleSwitchHappyPathInitialDbState,
  findEmployeeRoleSwitchHappyPathDirectoryRow,
  isEmployeeRoleSwitchHappyPathEnabled,
  openEmployeeRoleSwitchHappyPathDirectoryPage,
  resetEmployeeRoleSwitchHappyPathQaState,
  resolveEmployeeRoleSwitchHappyPathAccountState,
  resolveEmployeeRoleSwitchHappyPathContext,
} from "./employee-role-switch-happy-path-fixture";

test.describe("employee role switch happy path", () => {
  test.skip(
    !isEmployeeRoleSwitchHappyPathEnabled(),
    `Run \`npm run qa:employee:role-switch:happy-path:setup\` first, then set ${EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetEmployeeRoleSwitchHappyPathQaState();
  });

  test.afterEach(async () => {
    await cleanupEmployeeRoleSwitchHappyPathQaState();
  });

  test("admin can switch a seeded employee from cashier to rider and back to cashier", async ({
    browser,
  }) => {
    const scenario = await resolveEmployeeRoleSwitchHappyPathContext();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await bootstrapEmployeeRoleSwitchHappyPathSession(context);
      await openEmployeeRoleSwitchHappyPathDirectoryPage(page);

      const initialState =
        await resolveEmployeeRoleSwitchHappyPathAccountState();
      expectEmployeeRoleSwitchHappyPathInitialDbState(initialState);
      expect(initialState?.email).toBe(scenario.email);
      expect(initialState?.branchIds).toEqual([scenario.defaultBranch.id]);
      expect(initialState?.employee?.firstName).toBe(scenario.firstName);
      expect(initialState?.employee?.lastName).toBe(scenario.lastName);
      expect(initialState?.employee?.phone).toBe(scenario.phone);
      expect(initialState?.employee?.address?.line1).toBe(scenario.line1);
      expect(initialState?.employee?.address?.provinceId).toBe(
        scenario.province.id,
      );
      expect(initialState?.employee?.address?.municipalityId).toBe(
        scenario.municipality.id,
      );
      expect(initialState?.employee?.address?.barangayId).toBe(
        scenario.barangay.id,
      );
      expect(initialState?.roleAssignments[0]?.reason).toBe(
        scenario.initialReason,
      );
      expect(initialState?.roleAssignments[0]?.changedById).toBe(
        scenario.admin.id,
      );
      expect(initialState?.roleAuditEvents[0]?.reason).toBe(
        scenario.initialReason,
      );
      expect(initialState?.roleAuditEvents[0]?.changedById).toBe(
        scenario.admin.id,
      );

      let row = findEmployeeRoleSwitchHappyPathDirectoryRow(
        page,
        scenario.email,
      );
      await expect(row).toContainText(scenario.fullName);
      await expectEmployeeRoleSwitchHappyPathDirectoryRowState(row, "CASHIER");
      await expect(
        row.getByRole("button", { name: /switch to rider/i }),
      ).toBeVisible();

      await row.getByPlaceholder(/switch reason/i).fill(
        scenario.cashierToRiderReason,
      );
      await row.getByRole("button", { name: /switch to rider/i }).click();

      await expect(
        page.getByText(/role switched to rider\. user must re-login with new role lane\./i),
      ).toBeVisible();

      const riderState =
        await resolveEmployeeRoleSwitchHappyPathAccountState();
      expect(riderState?.role).toBe(UserRole.EMPLOYEE);
      expect(riderState?.employee?.role).toBe(EmployeeRole.RIDER);
      expect(riderState?.active).toBe(true);
      expect(riderState?.employee?.active).toBe(true);
      expect(riderState?.branchIds).toEqual([scenario.defaultBranch.id]);
      expect(riderState?.roleAssignments).toHaveLength(2);
      expect(riderState?.roleAssignments[0]?.role).toBe(UserRole.CASHIER);
      expect(riderState?.roleAssignments[0]?.endedAt).not.toBeNull();
      expect(riderState?.roleAssignments[1]?.role).toBe(UserRole.EMPLOYEE);
      expect(riderState?.roleAssignments[1]?.reason).toBe(
        scenario.cashierToRiderReason,
      );
      expect(riderState?.roleAssignments[1]?.changedById).toBe(
        scenario.admin.id,
      );
      expect(riderState?.roleAssignments[1]?.endedAt).toBeNull();
      expect(riderState?.roleAuditEvents).toHaveLength(2);
      expect(riderState?.roleAuditEvents[1]?.beforeRole).toBe(UserRole.CASHIER);
      expect(riderState?.roleAuditEvents[1]?.afterRole).toBe(UserRole.EMPLOYEE);
      expect(riderState?.roleAuditEvents[1]?.reason).toBe(
        scenario.cashierToRiderReason,
      );
      expect(riderState?.roleAuditEvents[1]?.changedById).toBe(
        scenario.admin.id,
      );

      row = findEmployeeRoleSwitchHappyPathDirectoryRow(page, scenario.email);
      await expectEmployeeRoleSwitchHappyPathDirectoryRowState(row, "RIDER");
      await expect(
        row.getByRole("button", { name: /switch to cashier/i }),
      ).toBeVisible();

      await row.getByPlaceholder(/switch reason/i).fill(
        scenario.riderToCashierReason,
      );
      await row.getByRole("button", { name: /switch to cashier/i }).click();

      await expect(
        page.getByText(/role switched to cashier\. user must re-login with new role lane\./i),
      ).toBeVisible();

      const cashierState =
        await resolveEmployeeRoleSwitchHappyPathAccountState();
      expect(cashierState?.role).toBe(UserRole.CASHIER);
      expect(cashierState?.employee?.role).toBe(EmployeeRole.STAFF);
      expect(cashierState?.active).toBe(true);
      expect(cashierState?.employee?.active).toBe(true);
      expect(cashierState?.branchIds).toEqual([scenario.defaultBranch.id]);
      expect(cashierState?.roleAssignments).toHaveLength(3);
      expect(cashierState?.roleAssignments[1]?.role).toBe(UserRole.EMPLOYEE);
      expect(cashierState?.roleAssignments[1]?.endedAt).not.toBeNull();
      expect(cashierState?.roleAssignments[2]?.role).toBe(UserRole.CASHIER);
      expect(cashierState?.roleAssignments[2]?.reason).toBe(
        scenario.riderToCashierReason,
      );
      expect(cashierState?.roleAssignments[2]?.changedById).toBe(
        scenario.admin.id,
      );
      expect(cashierState?.roleAssignments[2]?.endedAt).toBeNull();
      expect(cashierState?.roleAuditEvents).toHaveLength(3);
      expect(cashierState?.roleAuditEvents[2]?.beforeRole).toBe(UserRole.EMPLOYEE);
      expect(cashierState?.roleAuditEvents[2]?.afterRole).toBe(UserRole.CASHIER);
      expect(cashierState?.roleAuditEvents[2]?.reason).toBe(
        scenario.riderToCashierReason,
      );
      expect(cashierState?.roleAuditEvents[2]?.changedById).toBe(
        scenario.admin.id,
      );

      row = findEmployeeRoleSwitchHappyPathDirectoryRow(page, scenario.email);
      await expectEmployeeRoleSwitchHappyPathDirectoryRowState(row, "CASHIER");
      await expect(
        row.getByRole("button", { name: /switch to rider/i }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
