import { expect, test } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENABLE_ENV,
  bootstrapWorkforceSchedulePlannerAssignmentGatingPathSession,
  cleanupWorkforceSchedulePlannerAssignmentGatingPathQaState,
  expectWorkforceSchedulePlannerAssignmentGatingPathGeneratedDbState,
  expectWorkforceSchedulePlannerAssignmentGatingPathInitialDbState,
  expectWorkforceSchedulePlannerAssignmentGatingPathPlannerRowState,
  findWorkforceSchedulePlannerAssignmentGatingPathPlannerRow,
  isWorkforceSchedulePlannerAssignmentGatingPathEnabled,
  openWorkforceSchedulePlannerAssignmentGatingPath,
  resetWorkforceSchedulePlannerAssignmentGatingPathQaState,
  resolveWorkforceSchedulePlannerAssignmentGatingPathDbState,
  resolveWorkforceSchedulePlannerAssignmentGatingPathScenario,
} from "./workforce-schedule-planner-assignment-gating-path-fixture";

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

    await openWorkforceSchedulePlannerAssignmentGatingPath(page);

    const initialState =
      await resolveWorkforceSchedulePlannerAssignmentGatingPathDbState();
    expectWorkforceSchedulePlannerAssignmentGatingPathInitialDbState(
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
      page.locator("tr").filter({ hasText: scenario.activeWorkerLabel }),
    ).toHaveCount(0);
    await expect(
      page.locator("tr").filter({ hasText: scenario.endedWorkerLabel }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: /^Generate Draft Rows$/i }).click();

    await expect(
      page.getByText("Draft schedule rows generated for the selected range."),
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

    await expect(
      page.locator("tr").filter({ hasText: scenario.endedWorkerLabel }),
    ).toHaveCount(0);

    const generatedState =
      await resolveWorkforceSchedulePlannerAssignmentGatingPathDbState();
    expectWorkforceSchedulePlannerAssignmentGatingPathGeneratedDbState(
      generatedState,
      scenario,
    );
  });
});
