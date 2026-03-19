import { expect, test } from "@playwright/test";
import {
  EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_ENABLE_ENV,
  bootstrapEmployeeOnboardingStoreManagerHappyPathSession,
  expectEmployeeOnboardingStoreManagerHappyPathDbState,
  expectEmployeeOnboardingStoreManagerHappyPathDirectoryRowState,
  expectEmployeeOnboardingStoreManagerHappyPathSuccessAlert,
  findEmployeeOnboardingStoreManagerHappyPathDirectoryRow,
  isEmployeeOnboardingStoreManagerHappyPathEnabled,
  openEmployeeOnboardingStoreManagerHappyPathCreatePage,
  openEmployeeOnboardingStoreManagerHappyPathDirectoryPage,
  resetEmployeeOnboardingStoreManagerHappyPathQaState,
  resolveEmployeeOnboardingStoreManagerHappyPathAccountState,
  resolveEmployeeOnboardingStoreManagerHappyPathContext,
  selectEmployeeOnboardingStoreManagerHappyPathOption,
} from "./employee-onboarding-store-manager-happy-path-fixture";

test.describe("employee onboarding store manager happy path", () => {
  test.skip(
    !isEmployeeOnboardingStoreManagerHappyPathEnabled(),
    `Run \`npm run qa:employee:onboarding-store-manager:happy-path:setup\` first, then set ${EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetEmployeeOnboardingStoreManagerHappyPathQaState();
  });

  test.afterEach(async () => {
    await resetEmployeeOnboardingStoreManagerHappyPathQaState();
  });

  test("admin can create a store manager employee account with protected-lane directory state", async ({
    browser,
  }) => {
    const scenario =
      await resolveEmployeeOnboardingStoreManagerHappyPathContext();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await bootstrapEmployeeOnboardingStoreManagerHappyPathSession(context);
      await openEmployeeOnboardingStoreManagerHappyPathCreatePage(page);

      await selectEmployeeOnboardingStoreManagerHappyPathOption(
        page,
        "Lane",
        "STORE_MANAGER (staff)",
      );
      await page.getByLabel(/^First Name$/i).fill(scenario.firstName);
      await page.getByLabel(/^Last Name$/i).fill(scenario.lastName);
      await page.getByLabel(/^Phone$/i).fill(scenario.phone);
      await page.getByLabel(/^Email$/i).fill(scenario.email);
      await page.getByLabel(/^House\/Street$/i).fill(scenario.line1);
      await selectEmployeeOnboardingStoreManagerHappyPathOption(
        page,
        "Province",
        scenario.province.name,
      );
      await selectEmployeeOnboardingStoreManagerHappyPathOption(
        page,
        "Municipality / City",
        scenario.municipality.name,
      );
      await selectEmployeeOnboardingStoreManagerHappyPathOption(
        page,
        "Barangay",
        scenario.barangay.name,
      );

      await page.getByRole("button", { name: /create employee account/i }).click();

      await expect(page).toHaveURL(/\/creation\/employees\/new$/);
      await expectEmployeeOnboardingStoreManagerHappyPathSuccessAlert(page);

      const accountState =
        await resolveEmployeeOnboardingStoreManagerHappyPathAccountState();
      expectEmployeeOnboardingStoreManagerHappyPathDbState(accountState);
      expect(accountState?.email).toBe(scenario.email);
      expect(accountState?.branchIds).toEqual([scenario.defaultBranch.id]);
      expect(accountState?.roleAssignment?.changedById).toBe(scenario.admin.id);
      expect(accountState?.roleAuditEvent?.changedById).toBe(scenario.admin.id);
      expect(accountState?.passwordResetTokenExpiresAt).not.toBeNull();
      expect(accountState?.passwordResetTokenExpiresAt?.getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(accountState?.employee?.firstName).toBe(scenario.firstName);
      expect(accountState?.employee?.lastName).toBe(scenario.lastName);
      expect(accountState?.employee?.email).toBe(scenario.email);
      expect(accountState?.employee?.phone).toBe(scenario.phone);
      expect(accountState?.employee?.address?.line1).toBe(scenario.line1);
      expect(accountState?.employee?.address?.provinceId).toBe(
        scenario.province.id,
      );
      expect(accountState?.employee?.address?.municipalityId).toBe(
        scenario.municipality.id,
      );
      expect(accountState?.employee?.address?.barangayId).toBe(
        scenario.barangay.id,
      );
      expect(accountState?.employee?.address?.province).toBe(
        scenario.province.name,
      );
      expect(accountState?.employee?.address?.city).toBe(
        scenario.municipality.name,
      );
      expect(accountState?.employee?.address?.barangay).toBe(
        scenario.barangay.name,
      );

      await openEmployeeOnboardingStoreManagerHappyPathDirectoryPage(page);
      const row = findEmployeeOnboardingStoreManagerHappyPathDirectoryRow(
        page,
        scenario.email,
      );
      await expect(row).toContainText(scenario.fullName);
      await expect(row).toContainText(scenario.line1);
      await expectEmployeeOnboardingStoreManagerHappyPathDirectoryRowState(row);
    } finally {
      await context.close();
    }
  });
});

