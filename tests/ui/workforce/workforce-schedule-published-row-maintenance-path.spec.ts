import { expect, test } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_ENABLE_ENV,
  bootstrapWorkforceSchedulePublishedRowMaintenancePathSession,
  cleanupWorkforceSchedulePublishedRowMaintenancePathQaState,
  expectWorkforceSchedulePublishedRowMaintenancePathCancelledDbState,
  expectWorkforceSchedulePublishedRowMaintenancePathEditedDbState,
  expectWorkforceSchedulePublishedRowMaintenancePathInitialDbState,
  expectWorkforceSchedulePublishedRowMaintenancePathPlannerRowState,
  findWorkforceSchedulePublishedRowMaintenancePathHistoryEntry,
  findWorkforceSchedulePublishedRowMaintenancePathPlannerRow,
  isWorkforceSchedulePublishedRowMaintenancePathEnabled,
  openWorkforceSchedulePublishedRowMaintenancePath,
  resetWorkforceSchedulePublishedRowMaintenancePathQaState,
  resolveWorkforceSchedulePublishedRowMaintenancePathDbState,
  resolveWorkforceSchedulePublishedRowMaintenancePathScenario,
} from "./workforce-schedule-published-row-maintenance-path-fixture";

test.describe("workforce schedule published row maintenance path", () => {
  test.skip(
    !isWorkforceSchedulePublishedRowMaintenancePathEnabled(),
    `Run \`npm run qa:workforce:schedule-published-row-maintenance-path:setup\` first, then set ${WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforceSchedulePublishedRowMaintenancePathQaState();
    await bootstrapWorkforceSchedulePublishedRowMaintenancePathSession(context);
  });

  test.afterEach(async () => {
    await cleanupWorkforceSchedulePublishedRowMaintenancePathQaState();
  });

  test("manager can edit one published row in place and then cancel it with event history preserved", async ({
    page,
  }) => {
    const scenario =
      await resolveWorkforceSchedulePublishedRowMaintenancePathScenario();

    await openWorkforceSchedulePublishedRowMaintenancePath(page);

    const initialState =
      await resolveWorkforceSchedulePublishedRowMaintenancePathDbState();
    expectWorkforceSchedulePublishedRowMaintenancePathInitialDbState(
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

    let plannerRow =
      findWorkforceSchedulePublishedRowMaintenancePathPlannerRow(
        page,
        scenario.workerLabel,
      );
    await expect(plannerRow).toBeVisible();
    await expectWorkforceSchedulePublishedRowMaintenancePathPlannerRowState(
      plannerRow,
      scenario,
      {
        status: "PUBLISHED",
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
      page.getByText("No schedule events yet.", { exact: true }),
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

    plannerRow = findWorkforceSchedulePublishedRowMaintenancePathPlannerRow(
      page,
      scenario.workerLabel,
    );
    await expectWorkforceSchedulePublishedRowMaintenancePathPlannerRowState(
      plannerRow,
      scenario,
      {
        status: "PUBLISHED",
        timeWindowLabel: scenario.editedTimeWindowLabel,
      },
    );

    const managerNoteEntry =
      findWorkforceSchedulePublishedRowMaintenancePathHistoryEntry(
        page,
        scenario.editNote,
      );
    await expect(managerNoteEntry).toBeVisible();
    await expect(managerNoteEntry).toContainText("MANAGER_NOTE_ADDED");

    const editedState =
      await resolveWorkforceSchedulePublishedRowMaintenancePathDbState();
    expectWorkforceSchedulePublishedRowMaintenancePathEditedDbState(
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

    plannerRow = findWorkforceSchedulePublishedRowMaintenancePathPlannerRow(
      page,
      scenario.workerLabel,
    );
    await expectWorkforceSchedulePublishedRowMaintenancePathPlannerRowState(
      plannerRow,
      scenario,
      {
        status: "CANCELLED",
        timeWindowLabel: scenario.editedTimeWindowLabel,
      },
    );

    const cancelledEntry =
      findWorkforceSchedulePublishedRowMaintenancePathHistoryEntry(
        page,
        scenario.cancellationNote,
      );
    await expect(cancelledEntry).toBeVisible();
    await expect(cancelledEntry).toContainText("SCHEDULE_CANCELLED");

    const cancelledState =
      await resolveWorkforceSchedulePublishedRowMaintenancePathDbState();
    expectWorkforceSchedulePublishedRowMaintenancePathCancelledDbState(
      cancelledState,
      scenario,
    );
  });
});
