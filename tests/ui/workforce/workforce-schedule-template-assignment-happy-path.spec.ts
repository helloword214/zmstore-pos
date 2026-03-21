import { expect, test } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_ENABLE_ENV,
  bootstrapWorkforceScheduleTemplateAssignmentHappyPathSession,
  cleanupWorkforceScheduleTemplateAssignmentHappyPathQaState,
  expectWorkforceScheduleTemplateAssignmentHappyPathAssignedDbState,
  expectWorkforceScheduleTemplateAssignmentHappyPathAssignmentRowState,
  expectWorkforceScheduleTemplateAssignmentHappyPathInitialDbState,
  findWorkforceScheduleTemplateAssignmentHappyPathAssignmentRow,
  findWorkforceScheduleTemplateAssignmentHappyPathWorkerOption,
  isWorkforceScheduleTemplateAssignmentHappyPathEnabled,
  openWorkforceScheduleTemplateAssignmentHappyPath,
  resetWorkforceScheduleTemplateAssignmentHappyPathQaState,
  resolveWorkforceScheduleTemplateAssignmentHappyPathDbState,
  resolveWorkforceScheduleTemplateAssignmentHappyPathScenario,
} from "./workforce-schedule-template-assignment-happy-path-fixture";

test.describe("workforce schedule template assignment happy path", () => {
  test.skip(
    !isWorkforceScheduleTemplateAssignmentHappyPathEnabled(),
    `Run \`npm run qa:workforce:schedule-template-assignment:happy-path:setup\` first, then set ${WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforceScheduleTemplateAssignmentHappyPathQaState();
    await bootstrapWorkforceScheduleTemplateAssignmentHappyPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupWorkforceScheduleTemplateAssignmentHappyPathQaState();
  });

  test("manager can assign one tagged worker to the selected weekly template without generating schedules yet", async ({
    page,
  }) => {
    const scenario =
      await resolveWorkforceScheduleTemplateAssignmentHappyPathScenario();

    await openWorkforceScheduleTemplateAssignmentHappyPath(page);

    const initialState =
      await resolveWorkforceScheduleTemplateAssignmentHappyPathDbState();
    expectWorkforceScheduleTemplateAssignmentHappyPathInitialDbState(
      initialState,
      scenario,
    );

    await expect(
      page.getByRole("heading", { name: /^Template Assignment$/i }),
    ).toBeVisible();
    await expect(
      page.getByText("No worker assignments yet.", { exact: true }),
    ).toBeVisible();

    const workerOption =
      findWorkforceScheduleTemplateAssignmentHappyPathWorkerOption(
        page,
        scenario.workerLabel,
      );
    await expect(workerOption).toBeVisible();
    await workerOption.locator('input[name="workerIds"]').check();
    await page
      .getByLabel(/^Assignment effective from$/i)
      .fill(scenario.assignmentEffectiveFromInput);

    await page.getByRole("button", { name: /^Assign selected workers$/i }).click();

    await expect(page.getByText("Workers assigned to template.")).toBeVisible();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-templates" &&
        target.searchParams.get("templateId") === String(scenario.templateId) &&
        target.searchParams.get("saved") === "assignment",
      {
        timeout: 10_000,
      },
    );

    const assignmentRow =
      findWorkforceScheduleTemplateAssignmentHappyPathAssignmentRow(
        page,
        scenario.workerLabel,
      );
    await expect(assignmentRow).toBeVisible();
    await expectWorkforceScheduleTemplateAssignmentHappyPathAssignmentRowState(
      assignmentRow,
      scenario,
    );

    const assignedState =
      await resolveWorkforceScheduleTemplateAssignmentHappyPathDbState();
    expectWorkforceScheduleTemplateAssignmentHappyPathAssignedDbState(
      assignedState,
      scenario,
    );
  });
});
