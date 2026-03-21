import { expect, test } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_ENABLE_ENV,
  bootstrapWorkforceScheduleAppendEventHistoryPathSession,
  cleanupWorkforceScheduleAppendEventHistoryPathQaState,
  expectWorkforceScheduleAppendEventHistoryPathAppendedDbState,
  expectWorkforceScheduleAppendEventHistoryPathInitialDbState,
  expectWorkforceScheduleAppendEventHistoryPathPlannerRowState,
  findWorkforceScheduleAppendEventHistoryPathHistoryEntry,
  findWorkforceScheduleAppendEventHistoryPathPlannerRow,
  isWorkforceScheduleAppendEventHistoryPathEnabled,
  openWorkforceScheduleAppendEventHistoryPath,
  resetWorkforceScheduleAppendEventHistoryPathQaState,
  resolveWorkforceScheduleAppendEventHistoryPathDbState,
  resolveWorkforceScheduleAppendEventHistoryPathScenario,
} from "./workforce-schedule-append-event-history-path-fixture";

test.describe("workforce schedule append event history path", () => {
  test.skip(
    !isWorkforceScheduleAppendEventHistoryPathEnabled(),
    `Run \`npm run qa:workforce:schedule-append-event-history-path:setup\` first, then set ${WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforceScheduleAppendEventHistoryPathQaState();
    await bootstrapWorkforceScheduleAppendEventHistoryPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupWorkforceScheduleAppendEventHistoryPathQaState();
  });

  test("manager can append a replacement-assigned event to the tagged draft row and see it in event history", async ({
    page,
  }) => {
    const scenario =
      await resolveWorkforceScheduleAppendEventHistoryPathScenario();

    await openWorkforceScheduleAppendEventHistoryPath(page);

    const initialState =
      await resolveWorkforceScheduleAppendEventHistoryPathDbState();
    expectWorkforceScheduleAppendEventHistoryPathInitialDbState(
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

    const plannerRow =
      findWorkforceScheduleAppendEventHistoryPathPlannerRow(
        page,
        scenario.subjectWorkerLabel,
      );
    await expect(plannerRow).toBeVisible();
    await expectWorkforceScheduleAppendEventHistoryPathPlannerRowState(
      plannerRow,
      scenario,
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

    await page
      .locator('select[name="eventType"]')
      .selectOption("REPLACEMENT_ASSIGNED");
    await page
      .locator('select[name="relatedWorkerId"]')
      .selectOption(String(initialState.relatedUser?.employee?.id));
    await page.getByLabel(/^Event note$/i).fill(scenario.eventNote);
    await page.getByRole("button", { name: /^Append event$/i }).click();

    await expect(page.getByText("Schedule event appended.")).toBeVisible();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-planner" &&
        target.searchParams.get("scheduleId") === String(scenario.scheduleId) &&
        target.searchParams.get("saved") === "event-added",
      {
        timeout: 10_000,
      },
    );

    const historyEntry =
      findWorkforceScheduleAppendEventHistoryPathHistoryEntry(
        page,
        scenario.eventNote,
      );
    await expect(historyEntry).toBeVisible();
    await expect(historyEntry).toContainText("REPLACEMENT_ASSIGNED");
    await expect(historyEntry).toContainText(scenario.eventNote);
    await expect(historyEntry).toContainText(
      `Related worker: ${scenario.relatedWorkerLabel}`,
    );

    const appendedState =
      await resolveWorkforceScheduleAppendEventHistoryPathDbState();
    expectWorkforceScheduleAppendEventHistoryPathAppendedDbState(
      appendedState,
      scenario,
    );
  });
});
