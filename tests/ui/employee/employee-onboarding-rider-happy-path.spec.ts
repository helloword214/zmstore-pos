import { expect, test } from "@playwright/test";
import {
  EMPLOYEE_ONBOARDING_RIDER_HAPPY_PATH_ENABLE_ENV,
  bootstrapEmployeeOnboardingRiderHappyPathSession,
  expectEmployeeOnboardingRiderHappyPathDbState,
  expectEmployeeOnboardingRiderHappyPathDirectoryRowState,
  expectEmployeeOnboardingRiderHappyPathSuccessAlert,
  findEmployeeOnboardingRiderHappyPathDirectoryRow,
  isEmployeeOnboardingRiderHappyPathEnabled,
  openEmployeeOnboardingRiderHappyPathCreatePage,
  openEmployeeOnboardingRiderHappyPathDirectoryPage,
  resetEmployeeOnboardingRiderHappyPathQaState,
  resolveEmployeeOnboardingRiderHappyPathAccountState,
  resolveEmployeeOnboardingRiderHappyPathContext,
  selectEmployeeOnboardingRiderHappyPathOption,
} from "./employee-onboarding-rider-happy-path-fixture";

test.describe("employee onboarding rider happy path", () => {
  test.skip(
    !isEmployeeOnboardingRiderHappyPathEnabled(),
    `Run \`npm run qa:employee:onboarding-rider:happy-path:setup\` first, then set ${EMPLOYEE_ONBOARDING_RIDER_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetEmployeeOnboardingRiderHappyPathQaState();
  });

  test.afterEach(async () => {
    await resetEmployeeOnboardingRiderHappyPathQaState();
  });

  test("admin can create a rider employee account with vehicle and invite-ready auth state", async ({
    browser,
  }) => {
    const scenario = await resolveEmployeeOnboardingRiderHappyPathContext();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await bootstrapEmployeeOnboardingRiderHappyPathSession(context);
      await openEmployeeOnboardingRiderHappyPathCreatePage(page);

      await selectEmployeeOnboardingRiderHappyPathOption(page, "Lane", "RIDER");
      await page.getByLabel(/^First Name$/i).fill(scenario.firstName);
      await page.getByLabel(/^Last Name$/i).fill(scenario.lastName);
      await page.getByLabel(/^Phone$/i).fill(scenario.phone);
      await page.getByLabel(/^Email$/i).fill(scenario.email);
      await page.getByLabel(/^License Number \(optional\)$/i).fill(
        scenario.licenseNumber,
      );
      await page.getByLabel(/^License Expiry \(optional\)$/i).fill(
        scenario.licenseExpiryInput,
      );
      await selectEmployeeOnboardingRiderHappyPathOption(
        page,
        "Default Vehicle (Rider only)",
        scenario.vehicle.label,
      );
      await page.getByLabel(/^House\/Street$/i).fill(scenario.line1);
      await selectEmployeeOnboardingRiderHappyPathOption(
        page,
        "Province",
        scenario.province.name,
      );
      await selectEmployeeOnboardingRiderHappyPathOption(
        page,
        "Municipality / City",
        scenario.municipality.name,
      );
      await selectEmployeeOnboardingRiderHappyPathOption(
        page,
        "Barangay",
        scenario.barangay.name,
      );

      await page.getByRole("button", { name: /create employee account/i }).click();

      await expect(page).toHaveURL(/\/creation\/employees\/new$/);
      await expectEmployeeOnboardingRiderHappyPathSuccessAlert(page);

      const accountState = await resolveEmployeeOnboardingRiderHappyPathAccountState();
      expectEmployeeOnboardingRiderHappyPathDbState(accountState);
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
      expect(accountState?.employee?.defaultVehicleId).toBe(scenario.vehicle.id);
      expect(accountState?.employee?.licenseNumber).toBe(scenario.licenseNumber);
      expect(accountState?.employee?.licenseExpiry).toBe(
        scenario.licenseExpiryInput,
      );
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

      await openEmployeeOnboardingRiderHappyPathDirectoryPage(page);
      const row = findEmployeeOnboardingRiderHappyPathDirectoryRow(
        page,
        scenario.email,
      );
      await expect(row).toContainText(scenario.fullName);
      await expect(row).toContainText(scenario.line1);
      await expectEmployeeOnboardingRiderHappyPathDirectoryRowState(row);
    } finally {
      await context.close();
    }
  });
});

