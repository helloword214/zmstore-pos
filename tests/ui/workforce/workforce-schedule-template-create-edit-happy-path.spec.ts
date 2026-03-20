import { expect, test } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_ENABLE_ENV,
  bootstrapWorkforceScheduleTemplateCreateEditHappyPathSession,
  cleanupWorkforceScheduleTemplateCreateEditHappyPathQaState,
  expectWorkforceScheduleTemplateCreateEditHappyPathCreatedDbState,
  expectWorkforceScheduleTemplateCreateEditHappyPathEditedDbState,
  expectWorkforceScheduleTemplateCreateEditHappyPathInitialDbState,
  expectWorkforceScheduleTemplateCreateEditHappyPathLibraryRowState,
  expectWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanelState,
  findWorkforceScheduleTemplateCreateEditHappyPathLibraryRow,
  findWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanel,
  isWorkforceScheduleTemplateCreateEditHappyPathEnabled,
  openWorkforceScheduleTemplateCreateEditHappyPath,
  resetWorkforceScheduleTemplateCreateEditHappyPathQaState,
  resolveWorkforceScheduleTemplateCreateEditHappyPathDbState,
  resolveWorkforceScheduleTemplateCreateEditHappyPathEditedTimeInput,
  resolveWorkforceScheduleTemplateCreateEditHappyPathInitialTimeInput,
  resolveWorkforceScheduleTemplateCreateEditHappyPathScenario,
} from "./workforce-schedule-template-create-edit-happy-path-fixture";

test.describe("workforce schedule template create/edit happy path", () => {
  test.skip(
    !isWorkforceScheduleTemplateCreateEditHappyPathEnabled(),
    `Run \`npm run qa:workforce:schedule-template-create-edit:happy-path:setup\` first, then set ${WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforceScheduleTemplateCreateEditHappyPathQaState();
    await bootstrapWorkforceScheduleTemplateCreateEditHappyPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupWorkforceScheduleTemplateCreateEditHappyPathQaState();
  });

  test("manager can create and edit the same weekly schedule template without creating duplicates", async ({
    page,
  }) => {
    const scenario =
      await resolveWorkforceScheduleTemplateCreateEditHappyPathScenario();
    const initialTimeInput =
      resolveWorkforceScheduleTemplateCreateEditHappyPathInitialTimeInput();
    const editedTimeInput =
      resolveWorkforceScheduleTemplateCreateEditHappyPathEditedTimeInput();

    await openWorkforceScheduleTemplateCreateEditHappyPath(page);

    const initialState =
      await resolveWorkforceScheduleTemplateCreateEditHappyPathDbState();
    expectWorkforceScheduleTemplateCreateEditHappyPathInitialDbState(
      initialState,
    );

    await page.getByLabel(/^Template name$/i).fill(scenario.initialTemplateName);
    await page.getByLabel(/^Role scope$/i).selectOption("CASHIER");
    await page.getByLabel(/^Effective from$/i).fill(scenario.effectiveFromInput);
    await page.locator('input[name="day_MONDAY_enabled"]').check();
    await page
      .locator('input[name="day_MONDAY_start"]')
      .fill(initialTimeInput.start);
    await page.locator('input[name="day_MONDAY_end"]').fill(initialTimeInput.end);
    await page
      .locator('input[name="day_MONDAY_note"]')
      .fill("QA schedule template create/edit initial note");
    await page.getByRole("button", { name: /^Create template$/i }).click();

    await expect(page.getByText("Schedule template saved.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /edit template/i }),
    ).toBeVisible();

    let libraryRow =
      findWorkforceScheduleTemplateCreateEditHappyPathLibraryRow(
        page,
        scenario.initialTemplateName,
      );
    await expect(libraryRow).toBeVisible();
    await expectWorkforceScheduleTemplateCreateEditHappyPathLibraryRowState(
      libraryRow,
      {
        role: "CASHIER",
        templateName: scenario.initialTemplateName,
        workDayCount: 1,
      },
    );

    let selectedDaysPanel =
      findWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanel(page);
    await expect(selectedDaysPanel).toBeVisible();
    await expectWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanelState(
      selectedDaysPanel,
      {
        days: ["MONDAY"],
        note: "QA schedule template create/edit initial note",
        timeWindowLabel: scenario.initialTimeWindowLabel,
      },
    );

    const createdState =
      await resolveWorkforceScheduleTemplateCreateEditHappyPathDbState();
    expectWorkforceScheduleTemplateCreateEditHappyPathCreatedDbState(
      createdState,
      scenario,
    );

    const originalTemplateId = createdState.template?.id;
    if (!originalTemplateId) {
      throw new Error("Expected the created template id to exist.");
    }

    await page.getByLabel(/^Template name$/i).fill(scenario.editedTemplateName);
    await page.getByLabel(/^Role scope$/i).selectOption("EMPLOYEE");
    await page.locator('input[name="day_MONDAY_enabled"]').uncheck();
    await page.locator('input[name="day_TUESDAY_enabled"]').check();
    await page.locator('input[name="day_TUESDAY_start"]').fill(editedTimeInput.start);
    await page.locator('input[name="day_TUESDAY_end"]').fill(editedTimeInput.end);
    await page
      .locator('input[name="day_TUESDAY_note"]')
      .fill("QA schedule template create/edit edited note");
    await page.locator('input[name="day_THURSDAY_enabled"]').check();
    await page
      .locator('input[name="day_THURSDAY_start"]')
      .fill(editedTimeInput.start);
    await page.locator('input[name="day_THURSDAY_end"]').fill(editedTimeInput.end);
    await page
      .locator('input[name="day_THURSDAY_note"]')
      .fill("QA schedule template create/edit edited note");
    await page.getByRole("button", { name: /^Save template$/i }).click();

    await expect(page.getByText("Schedule template saved.")).toBeVisible();

    libraryRow =
      findWorkforceScheduleTemplateCreateEditHappyPathLibraryRow(
        page,
        scenario.editedTemplateName,
      );
    await expect(libraryRow).toBeVisible();
    await expectWorkforceScheduleTemplateCreateEditHappyPathLibraryRowState(
      libraryRow,
      {
        role: "EMPLOYEE",
        templateName: scenario.editedTemplateName,
        workDayCount: 2,
      },
    );
    await expect(
      findWorkforceScheduleTemplateCreateEditHappyPathLibraryRow(
        page,
        scenario.initialTemplateName,
      ),
    ).toHaveCount(0);

    selectedDaysPanel =
      findWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanel(page);
    await expect(selectedDaysPanel).toBeVisible();
    await expect(selectedDaysPanel.getByText("MONDAY", { exact: true })).toHaveCount(0);
    await expectWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanelState(
      selectedDaysPanel,
      {
        days: ["THURSDAY", "TUESDAY"],
        note: "QA schedule template create/edit edited note",
        timeWindowLabel: scenario.editedTimeWindowLabel,
      },
    );

    const editedState =
      await resolveWorkforceScheduleTemplateCreateEditHappyPathDbState();
    expectWorkforceScheduleTemplateCreateEditHappyPathEditedDbState(
      editedState,
      scenario,
      originalTemplateId,
    );
  });
});
