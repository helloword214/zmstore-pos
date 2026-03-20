import { expect, test } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_ENABLE_ENV,
  bootstrapWorkforceSchedulePlannerPublishVisibilityHappyPathSession,
  cleanupWorkforceSchedulePlannerPublishVisibilityHappyPathQaState,
  expectWorkforceSchedulePlannerPublishVisibilityHappyPathGeneratedDbState,
  expectWorkforceSchedulePlannerPublishVisibilityHappyPathInitialDbState,
  expectWorkforceSchedulePlannerPublishVisibilityHappyPathPlannerRowState,
  expectWorkforceSchedulePlannerPublishVisibilityHappyPathPublishedDbState,
  findWorkforceSchedulePlannerPublishVisibilityHappyPathAttendanceRow,
  findWorkforceSchedulePlannerPublishVisibilityHappyPathPlannerRow,
  isWorkforceSchedulePlannerPublishVisibilityHappyPathEnabled,
  openWorkforceAttendanceReviewVisibilityPage,
  openWorkforceSchedulePlannerPublishVisibilityHappyPath,
  resetWorkforceSchedulePlannerPublishVisibilityHappyPathQaState,
  resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState,
  resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenario,
} from "./workforce-schedule-planner-publish-visibility-happy-path-fixture";

test.describe("workforce schedule planner publish visibility happy path", () => {
  test.skip(
    !isWorkforceSchedulePlannerPublishVisibilityHappyPathEnabled(),
    `Run \`npm run qa:workforce:schedule-planner-publish-visibility:happy-path:setup\` first, then set ${WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforceSchedulePlannerPublishVisibilityHappyPathQaState();
    await bootstrapWorkforceSchedulePlannerPublishVisibilityHappyPathSession(
      context,
    );
  });

  test.afterEach(async () => {
    await cleanupWorkforceSchedulePlannerPublishVisibilityHappyPathQaState();
  });

  test("manager can generate draft schedule rows, publish them, and see the worker in attendance review", async ({
    page,
  }) => {
    const scenario =
      await resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenario();

    await openWorkforceSchedulePlannerPublishVisibilityHappyPath(page);

    const initialState =
      await resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState();
    expectWorkforceSchedulePlannerPublishVisibilityHappyPathInitialDbState(
      initialState,
      scenario,
    );

    await page.getByLabel(/^Range start$/i).fill(scenario.rangeStartInput);
    await page.getByLabel(/^Range end$/i).fill(scenario.rangeEndInput);
    await page.getByRole("button", { name: /^Load range$/i }).click();

    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-planner" &&
        target.searchParams.get("rangeStart") === scenario.rangeStartInput &&
        target.searchParams.get("rangeEnd") === scenario.rangeEndInput,
      {
        timeout: 10_000,
      },
    );

    await expect(
      page.locator("tr").filter({ hasText: scenario.employeeLabel }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: /^Generate Draft Rows$/i }).click();

    await expect(
      page.getByText("Draft schedule rows generated for the selected range."),
    ).toBeVisible();

    let plannerRow =
      findWorkforceSchedulePlannerPublishVisibilityHappyPathPlannerRow(
        page,
        scenario.employeeLabel,
      );
    await expect(plannerRow).toBeVisible();
    await expectWorkforceSchedulePlannerPublishVisibilityHappyPathPlannerRowState(
      plannerRow,
      scenario,
      "DRAFT",
    );

    const generatedState =
      await resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState();
    expectWorkforceSchedulePlannerPublishVisibilityHappyPathGeneratedDbState(
      generatedState,
      scenario,
    );

    await page.getByRole("button", { name: /^Publish Draft Rows$/i }).click();

    await expect(
      page.getByText("Draft schedules published for the selected range."),
    ).toBeVisible();

    plannerRow =
      findWorkforceSchedulePlannerPublishVisibilityHappyPathPlannerRow(
        page,
        scenario.employeeLabel,
      );
    await expectWorkforceSchedulePlannerPublishVisibilityHappyPathPlannerRowState(
      plannerRow,
      scenario,
      "PUBLISHED",
    );

    const publishedState =
      await resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState();
    expectWorkforceSchedulePlannerPublishVisibilityHappyPathPublishedDbState(
      publishedState,
      scenario,
    );

    await openWorkforceAttendanceReviewVisibilityPage(page);
    await expect(
      page.getByText(`Current attendance review date: ${scenario.targetDateLabel}`),
    ).toBeVisible();

    const attendanceRow =
      findWorkforceSchedulePlannerPublishVisibilityHappyPathAttendanceRow(
        page,
        scenario.employeeLabel,
      );
    await expect(attendanceRow).toBeVisible();
    await expect(attendanceRow).toContainText("CASHIER");
    await expect(attendanceRow).toContainText(scenario.timeWindowLabel);
    await expect(
      attendanceRow.getByRole("link", { name: /^(Open|Selected)$/i }),
    ).toBeVisible();
  });
});
