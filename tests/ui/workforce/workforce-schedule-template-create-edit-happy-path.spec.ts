import { expect, test, type Page } from "@playwright/test";
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

async function selectScheduleTemplateRoleScope(args: {
  page: Page;
  optionLabel: "Cashier" | "Employee";
}) {
  const trigger = args.page.locator("button#role");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(
    args.page.getByRole("option", { name: args.optionLabel, exact: true }),
  ).toBeVisible();
  await args.page
    .getByRole("option", { name: args.optionLabel, exact: true })
    .click();
  await expect(trigger).toContainText(args.optionLabel);
}

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
      scenario,
    );

    const originalExistingTemplateId = initialState.existingTemplate?.id;
    if (!originalExistingTemplateId) {
      throw new Error("Expected the pre-existing template id to exist.");
    }

    await expect(
      page.getByRole("heading", { name: /create template/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Create template$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Save template$/i }),
    ).toHaveCount(0);
    await expect(
      findWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanel(page),
    ).toHaveCount(0);
    await expect(
      page.getByText("Create or select a template first before assigning workers."),
    ).toBeVisible();
    await expect(
      findWorkforceScheduleTemplateCreateEditHappyPathLibraryRow(
        page,
        scenario.existingTemplateName,
      ),
    ).toBeVisible();

    await page.getByLabel(/^Template name$/i).fill(scenario.initialTemplateName);
    await selectScheduleTemplateRoleScope({
      page,
      optionLabel: "Cashier",
    });
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
      originalExistingTemplateId,
    );

    const originalTemplateId = createdState.template?.id;
    if (!originalTemplateId) {
      throw new Error("Expected the created template id to exist.");
    }

    await expect(
      findWorkforceScheduleTemplateCreateEditHappyPathLibraryRow(
        page,
        scenario.existingTemplateName,
      ),
    ).toBeVisible();

    await page.getByLabel(/^Template name$/i).fill(scenario.editedTemplateName);
    await selectScheduleTemplateRoleScope({
      page,
      optionLabel: "Employee",
    });
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
      originalExistingTemplateId,
    );

    await expect(
      findWorkforceScheduleTemplateCreateEditHappyPathLibraryRow(
        page,
        scenario.existingTemplateName,
      ),
    ).toBeVisible();

    await page.getByRole("link", { name: /^New template$/i }).click();
    await expect(
      page.getByRole("heading", { name: /create template/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/^Template name$/i)).toHaveValue("");
    await expect(
      findWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanel(page),
    ).toHaveCount(0);
  });
});
