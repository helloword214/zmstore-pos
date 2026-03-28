import { expect, test } from "@playwright/test";
import {
  EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_ENABLE_ENV,
  bootstrapEmployeeAccountManagementHappyPathSession,
  cleanupEmployeeAccountManagementHappyPathQaState,
  expectEmployeeAccountManagementHappyPathDbState,
  expectEmployeeAccountManagementHappyPathDirectoryRowState,
  findEmployeeAccountManagementHappyPathDirectoryRow,
  isEmployeeAccountManagementHappyPathEnabled,
  openEmployeeAccountManagementHappyPathDirectoryPage,
  resetEmployeeAccountManagementHappyPathQaState,
  resolveEmployeeAccountManagementHappyPathAccountState,
  resolveEmployeeAccountManagementHappyPathContext,
} from "./employee-account-management-happy-path-fixture";

test.describe("employee account management happy path", () => {
  test.skip(
    !isEmployeeAccountManagementHappyPathEnabled(),
    `Run \`npm run qa:employee:account-management:happy-path:setup\` first, then set ${EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetEmployeeAccountManagementHappyPathQaState();
  });

  test.afterEach(async () => {
    await cleanupEmployeeAccountManagementHappyPathQaState();
  });

  test("admin can resend invite then deactivate and reactivate the seeded cashier account", async ({
    browser,
  }) => {
    const scenario = await resolveEmployeeAccountManagementHappyPathContext();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await bootstrapEmployeeAccountManagementHappyPathSession(context);
      await openEmployeeAccountManagementHappyPathDirectoryPage(page);

      const initialState =
        await resolveEmployeeAccountManagementHappyPathAccountState();
      expectEmployeeAccountManagementHappyPathDbState(initialState);
      expect(initialState?.email).toBe(scenario.email);
      expect(initialState?.active).toBe(true);
      expect(initialState?.employee?.active).toBe(true);
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
      expect(initialState?.tokens).toHaveLength(1);
      expect(initialState?.tokens[0]?.usedAt).toBeNull();

      let row = findEmployeeAccountManagementHappyPathDirectoryRow(
        page,
        scenario.email,
      );
      const profileCell = row.getByRole("cell").first();
      await expect(profileCell).toContainText(scenario.fullName);
      await expect(profileCell).toContainText(scenario.line1);
      await expectEmployeeAccountManagementHappyPathDirectoryRowState(
        row,
        "ACTIVE",
      );
      await expect(row.getByRole("button", { name: /resend invite/i })).toBeVisible();
      await expect(row.getByRole("button", { name: /deactivate/i })).toBeVisible();

      await row.getByRole("button", { name: /resend invite/i }).click();
      await expect(page.getByText(/password setup link re-sent\./i)).toBeVisible();

      const postResendState =
        await resolveEmployeeAccountManagementHappyPathAccountState();
      expectEmployeeAccountManagementHappyPathDbState(postResendState);
      expect(postResendState?.tokens).toHaveLength(2);
      expect(postResendState?.tokens.filter((token) => token.usedAt === null)).toHaveLength(
        1,
      );
      expect(postResendState?.tokens.filter((token) => token.usedAt !== null)).toHaveLength(
        1,
      );
      expect(postResendState?.tokens[0]?.usedAt).not.toBeNull();
      expect(postResendState?.tokens[1]?.usedAt).toBeNull();
      expect(postResendState?.tokens[1]?.id).toBeGreaterThan(
        postResendState?.tokens[0]?.id ?? 0,
      );

      row = findEmployeeAccountManagementHappyPathDirectoryRow(page, scenario.email);
      await expectEmployeeAccountManagementHappyPathDirectoryRowState(row, "ACTIVE");
      await expect(row.getByRole("button", { name: /resend invite/i })).toBeVisible();

      await row.getByRole("button", { name: /deactivate/i }).click();
      await expect(page.getByText(/account deactivated\./i)).toBeVisible();

      const deactivatedState =
        await resolveEmployeeAccountManagementHappyPathAccountState();
      expectEmployeeAccountManagementHappyPathDbState(deactivatedState);
      expect(deactivatedState?.active).toBe(false);
      expect(deactivatedState?.employee?.active).toBe(false);
      expect(deactivatedState?.branchIds).toEqual([scenario.defaultBranch.id]);
      expect(deactivatedState?.tokens).toHaveLength(2);

      row = findEmployeeAccountManagementHappyPathDirectoryRow(page, scenario.email);
      await expectEmployeeAccountManagementHappyPathDirectoryRowState(row, "INACTIVE");
      await expect(row.getByRole("button", { name: /activate/i })).toBeVisible();

      await row.getByRole("button", { name: /activate/i }).click();
      await expect(page.getByText(/account reactivated\./i)).toBeVisible();

      const reactivatedState =
        await resolveEmployeeAccountManagementHappyPathAccountState();
      expectEmployeeAccountManagementHappyPathDbState(reactivatedState);
      expect(reactivatedState?.active).toBe(true);
      expect(reactivatedState?.employee?.active).toBe(true);
      expect(reactivatedState?.branchIds).toEqual([scenario.defaultBranch.id]);
      expect(reactivatedState?.tokens).toHaveLength(2);
      expect(reactivatedState?.tokens.filter((token) => token.usedAt === null)).toHaveLength(
        1,
      );

      row = findEmployeeAccountManagementHappyPathDirectoryRow(page, scenario.email);
      await expectEmployeeAccountManagementHappyPathDirectoryRowState(row, "ACTIVE");
      await expect(row.getByRole("button", { name: /resend invite/i })).toBeVisible();
      await expect(row.getByRole("button", { name: /deactivate/i })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
