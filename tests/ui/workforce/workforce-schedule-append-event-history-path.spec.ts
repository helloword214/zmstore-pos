import { expect, test, type Locator, type Page } from "@playwright/test";
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
  resolveWorkforceScheduleAppendEventHistoryPathBaseURL,
  resetWorkforceScheduleAppendEventHistoryPathQaState,
  resolveWorkforceScheduleAppendEventHistoryPathDbState,
  resolveWorkforceScheduleAppendEventHistoryPathScenario,
} from "./workforce-schedule-append-event-history-path-fixture";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

function findScheduledCellButton(row: Locator, timeWindowLabel: string) {
  return row.locator("td button").filter({
    hasText: new RegExp(escapeRegExp(timeWindowLabel), "i"),
  }).first();
}

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

    await openPlannerBoard(
      page,
      scenario.plannerRoute,
      resolveWorkforceScheduleAppendEventHistoryPathBaseURL(),
    );

    const initialState =
      await resolveWorkforceScheduleAppendEventHistoryPathDbState();
    expectWorkforceScheduleAppendEventHistoryPathInitialDbState(
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

    await findScheduledCellButton(
      plannerRow,
      scenario.initialTimeWindowLabel,
    ).click();
    await expect(
      page.getByRole("heading", { name: /^Cell editor$/i }),
    ).toBeVisible();

    await expect(
      page.getByText("No staffing events yet.", { exact: true }),
    ).toBeVisible();

    await page
      .locator('select[name="eventType"]')
      .selectOption("REPLACEMENT_ASSIGNED");
    await page
      .locator('select[name="relatedWorkerId"]')
      .selectOption(String(initialState.relatedUser?.employee?.id));
    await page.getByLabel(/^Event note$/i).fill(scenario.eventNote);
    await page.getByRole("button", { name: /^Append event$/i }).click();

    await expect(
      page.getByText("Schedule event appended to the selected row."),
    ).toBeVisible();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-planner" &&
        target.searchParams.get("scheduleDate") === scenario.targetDateInput &&
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
