import { expect, test } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_ROW_UPDATE_OR_CANCEL_PATH_ENABLE_ENV,
  bootstrapWorkforceScheduleRowUpdateOrCancelPathSession,
  cleanupWorkforceScheduleRowUpdateOrCancelPathQaState,
  expectWorkforceScheduleRowUpdateOrCancelPathCancelledDbState,
  expectWorkforceScheduleRowUpdateOrCancelPathEditedDbState,
  expectWorkforceScheduleRowUpdateOrCancelPathInitialDbState,
  expectWorkforceScheduleRowUpdateOrCancelPathPlannerRowState,
  findWorkforceScheduleRowUpdateOrCancelPathPlannerRow,
  isWorkforceScheduleRowUpdateOrCancelPathEnabled,
  openWorkforceScheduleRowUpdateOrCancelPath,
  resetWorkforceScheduleRowUpdateOrCancelPathQaState,
  resolveWorkforceScheduleRowUpdateOrCancelPathDbState,
  resolveWorkforceScheduleRowUpdateOrCancelPathScenario,
} from "./workforce-schedule-row-update-or-cancel-path-fixture";

test.describe("workforce schedule row update or cancel path", () => {
  test.skip(
    !isWorkforceScheduleRowUpdateOrCancelPathEnabled(),
    `Run \`npm run qa:workforce:schedule-row-update-or-cancel-path:setup\` first, then set ${WORKFORCE_SCHEDULE_ROW_UPDATE_OR_CANCEL_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforceScheduleRowUpdateOrCancelPathQaState();
    await bootstrapWorkforceScheduleRowUpdateOrCancelPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupWorkforceScheduleRowUpdateOrCancelPathQaState();
  });

  test("manager can save a one-off edit on the tagged draft row and then cancel that same row without duplication", async ({
    page,
  }) => {
    const scenario = await resolveWorkforceScheduleRowUpdateOrCancelPathScenario();

    await openWorkforceScheduleRowUpdateOrCancelPath(page);

    const initialState = await resolveWorkforceScheduleRowUpdateOrCancelPathDbState();
    expectWorkforceScheduleRowUpdateOrCancelPathInitialDbState(
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

    let plannerRow = findWorkforceScheduleRowUpdateOrCancelPathPlannerRow(
      page,
      scenario.workerLabel,
    );
    await expect(plannerRow).toBeVisible();
    await expectWorkforceScheduleRowUpdateOrCancelPathPlannerRowState(
      plannerRow,
      scenario,
      {
        status: "DRAFT",
        timeWindowLabel: scenario.initialTimeWindowLabel,
      },
    );

    await plannerRow.getByRole("link", { name: /^Open$/i }).click();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-planner" &&
        target.searchParams.get("scheduleId") === String(scenario.scheduleId),
      {
        timeout: 10_000,
      },
    );

    await expect(
      page.getByRole("heading", { name: /^Selected schedule$/i }),
    ).toBeVisible();

    await page.getByLabel(/^Start time$/i).fill(scenario.editStartTimeInput);
    await page.getByLabel(/^End time$/i).fill(scenario.editEndTimeInput);
    await page.getByLabel(/^Manager note$/i).fill(scenario.editNote);
    await page.getByRole("button", { name: /^Save one-off edit$/i }).click();

    await expect(page.getByText("One-off schedule row updated.")).toBeVisible();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-planner" &&
        target.searchParams.get("scheduleId") === String(scenario.scheduleId) &&
        target.searchParams.get("saved") === "schedule-updated",
      {
        timeout: 10_000,
      },
    );

    plannerRow = findWorkforceScheduleRowUpdateOrCancelPathPlannerRow(
      page,
      scenario.workerLabel,
    );
    await expectWorkforceScheduleRowUpdateOrCancelPathPlannerRowState(
      plannerRow,
      scenario,
      {
        status: "DRAFT",
        timeWindowLabel: scenario.editedTimeWindowLabel,
      },
    );

    const editedState = await resolveWorkforceScheduleRowUpdateOrCancelPathDbState();
    expectWorkforceScheduleRowUpdateOrCancelPathEditedDbState(
      editedState,
      scenario,
    );

    await page
      .getByLabel(/^Cancellation note$/i)
      .fill(scenario.cancellationNote);
    await page.getByRole("button", { name: /^Cancel schedule row$/i }).click();

    await expect(
      page.getByText("Schedule row cancelled with event history preserved."),
    ).toBeVisible();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-planner" &&
        target.searchParams.get("scheduleId") === String(scenario.scheduleId) &&
        target.searchParams.get("saved") === "schedule-cancelled",
      {
        timeout: 10_000,
      },
    );

    plannerRow = findWorkforceScheduleRowUpdateOrCancelPathPlannerRow(
      page,
      scenario.workerLabel,
    );
    await expectWorkforceScheduleRowUpdateOrCancelPathPlannerRowState(
      plannerRow,
      scenario,
      {
        status: "CANCELLED",
        timeWindowLabel: scenario.editedTimeWindowLabel,
      },
    );

    const cancelledState =
      await resolveWorkforceScheduleRowUpdateOrCancelPathDbState();
    expectWorkforceScheduleRowUpdateOrCancelPathCancelledDbState(
      cancelledState,
      scenario,
    );
  });
});
