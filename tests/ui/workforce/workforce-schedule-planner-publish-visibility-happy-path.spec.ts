import { expect, test, type Page } from "@playwright/test";
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
  resolveWorkforceSchedulePlannerPublishVisibilityHappyPathBaseURL,
  resetWorkforceSchedulePlannerPublishVisibilityHappyPathQaState,
  resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState,
  resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenario,
} from "./workforce-schedule-planner-publish-visibility-happy-path-fixture";

async function openPlannerBoard(
  page: Page,
  route: string,
  baseUrl: string,
) {
  const url = new URL(route, baseUrl).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL(
    (target) => target.pathname === "/store/workforce/schedule-planner",
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /workforce planner board/i }),
  ).toBeVisible();
}

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

    await openPlannerBoard(
      page,
      scenario.plannerRoute,
      resolveWorkforceSchedulePlannerPublishVisibilityHappyPathBaseURL(),
    );

    const initialState =
      await resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState();
    expectWorkforceSchedulePlannerPublishVisibilityHappyPathInitialDbState(
      initialState,
      scenario,
    );

    await page.getByLabel(/^Start$/i).fill(scenario.rangeStartInput);
    await page.getByLabel(/^End$/i).fill(scenario.rangeEndInput);
    await page.getByRole("button", { name: /^Load$/i }).click();

    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-planner" &&
        target.searchParams.get("rangeStart") === scenario.rangeStartInput &&
        target.searchParams.get("rangeEnd") === scenario.rangeEndInput,
      {
        timeout: 10_000,
      },
    );

    const emptyPlannerRow =
      findWorkforceSchedulePlannerPublishVisibilityHappyPathPlannerRow(
        page,
        scenario.employeeLabel,
      );
    await expect(emptyPlannerRow).toBeVisible();
    await expect(emptyPlannerRow).not.toContainText(scenario.timeWindowLabel);
    await expect(emptyPlannerRow).not.toContainText(/\bDRAFT\b/);

    await page
      .getByRole("button", { name: /^Generate$/i })
      .click();

    await expect(
      page.getByText("Draft rows generated from active template assignments."),
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

    await page.getByRole("button", { name: /^Publish$/i }).click();

    await expect(
      page.getByText("Draft rows in this window were published."),
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
