import { expect, test } from "@playwright/test";
import {
  EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_ENABLE_ENV,
  bootstrapEmployeeProfileEditHappyPathSession,
  cleanupEmployeeProfileEditHappyPathQaState,
  expectEmployeeProfileEditHappyPathDirectoryRowState,
  expectEmployeeProfileEditHappyPathInitialDbState,
  expectEmployeeProfileEditHappyPathPostedDbState,
  findEmployeeProfileEditHappyPathDirectoryRow,
  isEmployeeProfileEditHappyPathEnabled,
  openEmployeeProfileEditHappyPathDirectoryPage,
  openEmployeeProfileEditHappyPathEditPage,
  resetEmployeeProfileEditHappyPathQaState,
  resolveEmployeeProfileEditHappyPathAccountState,
  resolveEmployeeProfileEditHappyPathContext,
  selectEmployeeProfileEditHappyPathOption,
} from "./employee-profile-edit-happy-path-fixture";

test.describe("employee profile edit happy path", () => {
  test.skip(
    !isEmployeeProfileEditHappyPathEnabled(),
    `Run \`npm run qa:employee:profile-edit:happy-path:setup\` first, then set ${EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetEmployeeProfileEditHappyPathQaState();
  });

  test.afterEach(async () => {
    await cleanupEmployeeProfileEditHappyPathQaState();
  });

  test("admin can update a seeded rider profile without mutating role or branch state", async ({
    browser,
  }) => {
    const scenario = await resolveEmployeeProfileEditHappyPathContext();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await bootstrapEmployeeProfileEditHappyPathSession(context);
      await openEmployeeProfileEditHappyPathEditPage(page);

      const initialState = await resolveEmployeeProfileEditHappyPathAccountState();
      expectEmployeeProfileEditHappyPathInitialDbState(initialState, scenario);

      await page.getByLabel(/^First Name$/i).fill(scenario.updated.firstName);
      await page.getByLabel(/^Middle Name \(optional\)$/i).fill(
        scenario.updated.middleName,
      );
      await page.getByLabel(/^Last Name$/i).fill(scenario.updated.lastName);
      await page.getByLabel(/^Alias \(optional\)$/i).fill(scenario.updated.alias);
      await page.getByLabel(/^Phone$/i).fill(scenario.updated.phone);
      await page.getByLabel(/^Email$/i).fill(scenario.updated.email);
      await page.getByLabel(/^SSS Number \(optional\)$/i).fill(
        scenario.updated.sssNumber,
      );
      await page.getByLabel(/^Pag-IBIG Number \(optional\)$/i).fill(
        scenario.updated.pagIbigNumber,
      );
      await page.getByLabel(/^License Number \(optional\)$/i).fill(
        scenario.updated.licenseNumber,
      );
      await page.getByLabel(/^License Expiry \(optional\)$/i).fill(
        scenario.updated.licenseExpiryInput,
      );
      await selectEmployeeProfileEditHappyPathOption(
        page,
        "Default Vehicle (Rider lane)",
        scenario.vehicle.label,
      );
      await page.getByLabel(/^House\/Street$/i).fill(scenario.updated.line1);
      await page.getByLabel(/^Purok \(text, optional\)$/i).fill(
        scenario.updated.purok,
      );
      await page.getByLabel(/^Postal Code \(optional\)$/i).fill(
        scenario.updated.postalCode,
      );
      await page.getByLabel(/^Landmark \(text, optional\)$/i).fill(
        scenario.updated.landmark,
      );

      await page
        .getByRole("button", { name: /^Save Employee Profile$/i })
        .click();

      await expect(
        page.getByText(/^Employee profile updated\./i),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: new RegExp(`Edit Employee - ${scenario.updated.fullName}`, "i"),
        }),
      ).toBeVisible();
      await expect(page.getByLabel(/^Email$/i)).toHaveValue(scenario.updated.email);
      await expect(page.getByLabel(/^Phone$/i)).toHaveValue(scenario.updated.phone);
      await expect(page.getByLabel(/^House\/Street$/i)).toHaveValue(
        scenario.updated.line1,
      );

      await openEmployeeProfileEditHappyPathDirectoryPage(page);

      const row = findEmployeeProfileEditHappyPathDirectoryRow(
        page,
        scenario.updated.email,
      );
      await expectEmployeeProfileEditHappyPathDirectoryRowState(row, scenario);

      const postedState = await resolveEmployeeProfileEditHappyPathAccountState();
      expectEmployeeProfileEditHappyPathPostedDbState(postedState, scenario);
    } finally {
      await context.close();
    }
  });
});
