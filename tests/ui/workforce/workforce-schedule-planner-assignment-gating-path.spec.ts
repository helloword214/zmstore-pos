import { expect, test, type Page } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENABLE_ENV,
  bootstrapWorkforceSchedulePlannerAssignmentGatingPathSession,
  cleanupWorkforceSchedulePlannerAssignmentGatingPathQaState,
  expectWorkforceSchedulePlannerAssignmentGatingPathGeneratedDbState,
  expectWorkforceSchedulePlannerAssignmentGatingPathInitialDbState,
  expectWorkforceSchedulePlannerAssignmentGatingPathPlannerRowState,
  findWorkforceSchedulePlannerAssignmentGatingPathPlannerRow,
  isWorkforceSchedulePlannerAssignmentGatingPathEnabled,
  resolveWorkforceSchedulePlannerAssignmentGatingPathBaseURL,
  resetWorkforceSchedulePlannerAssignmentGatingPathQaState,
  resolveWorkforceSchedulePlannerAssignmentGatingPathDbState,
  resolveWorkforceSchedulePlannerAssignmentGatingPathScenario,
} from "./workforce-schedule-planner-assignment-gating-path-fixture";

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

test.describe("workforce schedule planner assignment gating path", () => {
  test.skip(
    !isWorkforceSchedulePlannerAssignmentGatingPathEnabled(),
    `Run \`npm run qa:workforce:schedule-planner-assignment-gating-path:setup\` first, then set ${WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforceSchedulePlannerAssignmentGatingPathQaState();
    await bootstrapWorkforceSchedulePlannerAssignmentGatingPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupWorkforceSchedulePlannerAssignmentGatingPathQaState();
  });

  test("manager generates draft planner rows only for the tagged active assignment while excluding the ended assignment", async ({
    page,
  }) => {
    const scenario =
      await resolveWorkforceSchedulePlannerAssignmentGatingPathScenario();

    await openPlannerBoard(
      page,
      scenario.plannerRoute,
      resolveWorkforceSchedulePlannerAssignmentGatingPathBaseURL(),
    );

    const initialState =
      await resolveWorkforceSchedulePlannerAssignmentGatingPathDbState();
    expectWorkforceSchedulePlannerAssignmentGatingPathInitialDbState(
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

    const activeBlankRow =
      findWorkforceSchedulePlannerAssignmentGatingPathPlannerRow(
        page,
        scenario.activeWorkerLabel,
      );
    await expect(activeBlankRow).toBeVisible();
    await expect(activeBlankRow).not.toContainText(scenario.timeWindowLabel);
    await expect(activeBlankRow).not.toContainText(/\bDRAFT\b/);

    const endedBlankRow =
      findWorkforceSchedulePlannerAssignmentGatingPathPlannerRow(
        page,
        scenario.endedWorkerLabel,
      );
    await expect(endedBlankRow).toBeVisible();
    await expect(endedBlankRow).not.toContainText(scenario.timeWindowLabel);
    await expect(endedBlankRow).not.toContainText(/\bDRAFT\b/);

    await page
      .getByRole("button", { name: /^Generate$/i })
      .click();

    await expect(
      page.getByText("Draft rows generated from active template assignments."),
    ).toBeVisible();

    const activeRow =
      findWorkforceSchedulePlannerAssignmentGatingPathPlannerRow(
        page,
        scenario.activeWorkerLabel,
      );
    await expect(activeRow).toBeVisible();
    await expectWorkforceSchedulePlannerAssignmentGatingPathPlannerRowState(
      activeRow,
      scenario,
    );

    const endedRow =
      findWorkforceSchedulePlannerAssignmentGatingPathPlannerRow(
        page,
        scenario.endedWorkerLabel,
      );
    await expect(endedRow).toBeVisible();
    await expect(endedRow).not.toContainText(scenario.timeWindowLabel);
    await expect(endedRow).not.toContainText(/\bDRAFT\b/);

    const generatedState =
      await resolveWorkforceSchedulePlannerAssignmentGatingPathDbState();
    expectWorkforceSchedulePlannerAssignmentGatingPathGeneratedDbState(
      generatedState,
      scenario,
    );
  });
});
