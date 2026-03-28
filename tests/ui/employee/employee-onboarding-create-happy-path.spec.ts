import { expect, test } from "@playwright/test";
import {
  EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_ENABLE_ENV,
  bootstrapEmployeeOnboardingCreateHappyPathSession,
  expectEmployeeOnboardingCreateHappyPathDbState,
  expectEmployeeOnboardingCreateHappyPathDirectoryRowState,
  expectEmployeeOnboardingCreateHappyPathSuccessAlert,
  findEmployeeOnboardingCreateHappyPathDirectoryRow,
  isEmployeeOnboardingCreateHappyPathEnabled,
  openEmployeeOnboardingCreateHappyPathCreatePage,
  openEmployeeOnboardingCreateHappyPathDirectoryPage,
  resetEmployeeOnboardingCreateHappyPathQaState,
  resolveEmployeeOnboardingCreateHappyPathAccountState,
  resolveEmployeeOnboardingCreateHappyPathContext,
  selectEmployeeOnboardingCreateHappyPathOption,
} from "./employee-onboarding-create-happy-path-fixture";

test.describe("employee onboarding create happy path", () => {
  test.skip(
    !isEmployeeOnboardingCreateHappyPathEnabled(),
    `Run \`npm run qa:employee:onboarding-create:happy-path:setup\` first, then set ${EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetEmployeeOnboardingCreateHappyPathQaState();
  });

  test.afterEach(async () => {
    await resetEmployeeOnboardingCreateHappyPathQaState();
  });

  test("admin can create a cashier employee account with primary address and invite-ready auth state", async ({
    browser,
  }) => {
    const scenario = await resolveEmployeeOnboardingCreateHappyPathContext();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await bootstrapEmployeeOnboardingCreateHappyPathSession(context);
      await openEmployeeOnboardingCreateHappyPathCreatePage(page);

      await selectEmployeeOnboardingCreateHappyPathOption(page, "Lane", "CASHIER");
      await page.getByLabel(/^First Name$/i).fill(scenario.firstName);
      await page.getByLabel(/^Last Name$/i).fill(scenario.lastName);
      await page.getByLabel(/^Phone$/i).fill(scenario.phone);
      await page.getByLabel(/^Email$/i).fill(scenario.email);
      await page.getByLabel(/^House\/Street$/i).fill(scenario.line1);
      await selectEmployeeOnboardingCreateHappyPathOption(
        page,
        "Province",
        scenario.province.name,
      );
      await selectEmployeeOnboardingCreateHappyPathOption(
        page,
        "Municipality / City",
        scenario.municipality.name,
      );
      await selectEmployeeOnboardingCreateHappyPathOption(
        page,
        "Barangay",
        scenario.barangay.name,
      );

      await page.getByRole("button", { name: /create employee account/i }).click();

      await expect(page).toHaveURL(/\/creation\/employees\/new$/);
      await expectEmployeeOnboardingCreateHappyPathSuccessAlert(page);

      const accountState =
        await resolveEmployeeOnboardingCreateHappyPathAccountState();
      expectEmployeeOnboardingCreateHappyPathDbState(accountState);
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
      expect(accountState?.employee?.address?.provinceId).toBe(scenario.province.id);
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

      await openEmployeeOnboardingCreateHappyPathDirectoryPage(page);
      const row = findEmployeeOnboardingCreateHappyPathDirectoryRow(
        page,
        scenario.email,
      );
      const profileCell = row.getByRole("cell").first();
      await expect(profileCell).toContainText(scenario.fullName);
      await expect(profileCell).toContainText(scenario.line1);
      await expectEmployeeOnboardingCreateHappyPathDirectoryRowState(row);
    } finally {
      await context.close();
    }
  });
});
