import { WorkerScheduleAssignmentStatus } from "@prisma/client";
import { expect, test } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_STATUS_PATH_ENABLE_ENV,
  bootstrapWorkforceScheduleTemplateAssignmentStatusPathSession,
  cleanupWorkforceScheduleTemplateAssignmentStatusPathQaState,
  expectWorkforceScheduleTemplateAssignmentStatusPathAssignmentRowState,
  expectWorkforceScheduleTemplateAssignmentStatusPathInitialDbState,
  expectWorkforceScheduleTemplateAssignmentStatusPathUpdatedDbState,
  findWorkforceScheduleTemplateAssignmentStatusPathAssignmentRow,
  isWorkforceScheduleTemplateAssignmentStatusPathEnabled,
  openWorkforceScheduleTemplateAssignmentStatusPath,
  resetWorkforceScheduleTemplateAssignmentStatusPathQaState,
  resolveWorkforceScheduleTemplateAssignmentStatusPathDbState,
  resolveWorkforceScheduleTemplateAssignmentStatusPathScenario,
} from "./workforce-schedule-template-assignment-status-path-fixture";

test.describe("workforce schedule template assignment status path", () => {
  test.skip(
    !isWorkforceScheduleTemplateAssignmentStatusPathEnabled(),
    `Run \`npm run qa:workforce:schedule-template-assignment-status-path:setup\` first, then set ${WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_STATUS_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforceScheduleTemplateAssignmentStatusPathQaState();
    await bootstrapWorkforceScheduleTemplateAssignmentStatusPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupWorkforceScheduleTemplateAssignmentStatusPathQaState();
  });

  test("manager can pause and then end the same tagged assignment row without generating schedules", async ({
    page,
  }) => {
    const scenario =
      await resolveWorkforceScheduleTemplateAssignmentStatusPathScenario();

    await openWorkforceScheduleTemplateAssignmentStatusPath(page);

    const initialState =
      await resolveWorkforceScheduleTemplateAssignmentStatusPathDbState();
    expectWorkforceScheduleTemplateAssignmentStatusPathInitialDbState(
      initialState,
      scenario,
    );

    const originalAssignmentId = initialState.template?.assignments[0]?.id;
    if (!originalAssignmentId) {
      throw new Error("Expected the seeded assignment id to exist.");
    }

    let assignmentRow =
      findWorkforceScheduleTemplateAssignmentStatusPathAssignmentRow(
        page,
        scenario.workerLabel,
      );
    await expect(assignmentRow).toBeVisible();
    await expectWorkforceScheduleTemplateAssignmentStatusPathAssignmentRowState(
      assignmentRow,
      scenario,
      WorkerScheduleAssignmentStatus.ACTIVE,
    );

    await assignmentRow.locator('select[name="status"]').selectOption("PAUSED");
    await assignmentRow.getByRole("button", { name: /^Save$/i }).click();

    await expect(
      page.getByText("Assignment status updated.", { exact: true }),
    ).toBeVisible();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-templates" &&
        target.searchParams.get("templateId") === String(scenario.templateId) &&
        target.searchParams.get("saved") === "assignment-status",
      {
        timeout: 10_000,
      },
    );

    assignmentRow =
      findWorkforceScheduleTemplateAssignmentStatusPathAssignmentRow(
        page,
        scenario.workerLabel,
      );
    await expectWorkforceScheduleTemplateAssignmentStatusPathAssignmentRowState(
      assignmentRow,
      scenario,
      WorkerScheduleAssignmentStatus.PAUSED,
    );

    const pausedState =
      await resolveWorkforceScheduleTemplateAssignmentStatusPathDbState();
    expectWorkforceScheduleTemplateAssignmentStatusPathUpdatedDbState(
      pausedState,
      scenario,
      originalAssignmentId,
      WorkerScheduleAssignmentStatus.PAUSED,
    );

    await assignmentRow.locator('select[name="status"]').selectOption("ENDED");
    await assignmentRow.getByRole("button", { name: /^Save$/i }).click();

    await expect(
      page.getByText("Assignment status updated.", { exact: true }),
    ).toBeVisible();

    assignmentRow =
      findWorkforceScheduleTemplateAssignmentStatusPathAssignmentRow(
        page,
        scenario.workerLabel,
      );
    await expectWorkforceScheduleTemplateAssignmentStatusPathAssignmentRowState(
      assignmentRow,
      scenario,
      WorkerScheduleAssignmentStatus.ENDED,
    );

    const endedState =
      await resolveWorkforceScheduleTemplateAssignmentStatusPathDbState();
    expectWorkforceScheduleTemplateAssignmentStatusPathUpdatedDbState(
      endedState,
      scenario,
      originalAssignmentId,
      WorkerScheduleAssignmentStatus.ENDED,
    );
  });
});
