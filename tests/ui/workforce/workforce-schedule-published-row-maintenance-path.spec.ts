import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_ENABLE_ENV,
  bootstrapWorkforceSchedulePublishedRowMaintenancePathSession,
  cleanupWorkforceSchedulePublishedRowMaintenancePathQaState,
  expectWorkforceSchedulePublishedRowMaintenancePathEditedDbState,
  expectWorkforceSchedulePublishedRowMaintenancePathInitialDbState,
  findWorkforceSchedulePublishedRowMaintenancePathPlannerRow,
  isWorkforceSchedulePublishedRowMaintenancePathEnabled,
  resolveWorkforceSchedulePublishedRowMaintenancePathBaseURL,
  resetWorkforceSchedulePublishedRowMaintenancePathQaState,
  resolveWorkforceSchedulePublishedRowMaintenancePathDbState,
  resolveWorkforceSchedulePublishedRowMaintenancePathScenario,
} from "./workforce-schedule-published-row-maintenance-path-fixture";

const CLEARED_WORK_ROW_NOTE = "Planner board cleared this worker from the duty date.";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTimeWindowPattern(value: string) {
  const [start, end] = value.split("-").map((part) => part.trim());
  if (!start || !end) {
    return new RegExp(escapeRegExp(value), "i");
  }
  return new RegExp(`${escapeRegExp(start)}\\s*-\\s*${escapeRegExp(end)}`, "i");
}

function formatHalfHourOptionLabel(value: string) {
  const [hourToken, minuteToken] = value.split(":");
  const hour = Number(hourToken);
  const minute = Number(minuteToken);
  const meridiem = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

async function selectDropdownValue(page: Page, label: string, value: string) {
  await page.getByLabel(new RegExp(`^${escapeRegExp(label)}$`, "i")).click();
  await page.getByRole("option", { name: formatHalfHourOptionLabel(value) }).click();
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
    hasText: buildTimeWindowPattern(timeWindowLabel),
  }).first();
}

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

  test("manager can edit one published cell in place and then clear it back to blank while preserving DB event history", async ({
    page,
  }) => {
    const scenario =
      await resolveWorkforceSchedulePublishedRowMaintenancePathScenario();

    await openPlannerBoard(
      page,
      scenario.plannerRoute,
      resolveWorkforceSchedulePublishedRowMaintenancePathBaseURL(),
    );

    const initialState =
      await resolveWorkforceSchedulePublishedRowMaintenancePathDbState();
    expectWorkforceSchedulePublishedRowMaintenancePathInitialDbState(
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

    let plannerRow =
      findWorkforceSchedulePublishedRowMaintenancePathPlannerRow(
        page,
        scenario.workerLabel,
      );
    await expect(plannerRow).toBeVisible();
    await expect(plannerRow).toContainText(scenario.workerLabel);
    await expect(plannerRow).toContainText(/\bPUBLISHED\b/);
    await expect(plannerRow).toContainText(
      buildTimeWindowPattern(scenario.initialTimeWindowLabel),
    );

    await findScheduledCellButton(plannerRow, scenario.initialTimeWindowLabel).click();
    await expect(
      page.getByRole("heading", { name: /^Cell editor$/i }),
    ).toBeVisible();

    await selectDropdownValue(page, "Start time", scenario.editStartTimeInput);
    await selectDropdownValue(page, "End time", scenario.editEndTimeInput);
    await page.getByLabel(/^Manager note$/i).fill(scenario.editNote);
    await page.getByRole("button", { name: /^Save custom cell$/i }).click();

    await expect(
      page.getByText("Custom schedule row saved for the selected cell."),
    ).toBeVisible();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-planner" &&
        target.searchParams.get("scheduleDate") === scenario.targetDateInput &&
        target.searchParams.get("saved") === "custom-saved",
      {
        timeout: 10_000,
      },
    );

    plannerRow = findWorkforceSchedulePublishedRowMaintenancePathPlannerRow(
      page,
      scenario.workerLabel,
    );
    await expect(plannerRow).toContainText(scenario.workerLabel);
    await expect(plannerRow).toContainText(/\bPUBLISHED\b/);
    await expect(plannerRow).toContainText(
      buildTimeWindowPattern(scenario.editedTimeWindowLabel),
    );
    await expect(page.getByLabel(/^Start time$/i)).toHaveText(
      formatHalfHourOptionLabel(scenario.editStartTimeInput),
    );
    await expect(page.getByLabel(/^End time$/i)).toHaveText(
      formatHalfHourOptionLabel(scenario.editEndTimeInput),
    );
    await expect(page.getByLabel(/^Manager note$/i)).toHaveValue(scenario.editNote);

    const editedState =
      await resolveWorkforceSchedulePublishedRowMaintenancePathDbState();
    expectWorkforceSchedulePublishedRowMaintenancePathEditedDbState(
      editedState,
      scenario,
    );

    await page.getByRole("button", { name: /^Clear to blank$/i }).click();

    await expect(page.getByText("Selected cell returned to blank.")).toBeVisible();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/schedule-planner" &&
        target.searchParams.get("scheduleDate") === scenario.targetDateInput &&
        target.searchParams.get("saved") === "cell-cleared",
      {
        timeout: 10_000,
      },
    );

    await expect(page.getByRole("heading", { name: /^Cell editor$/i })).toHaveCount(0);

    plannerRow = findWorkforceSchedulePublishedRowMaintenancePathPlannerRow(
      page,
      scenario.workerLabel,
    );
    await expect(plannerRow).toBeVisible();
    await expect(plannerRow).not.toContainText(scenario.editedTimeWindowLabel);
    await expect(plannerRow).not.toContainText(/\bCANCELLED\b/);

    const cancelledState =
      await resolveWorkforceSchedulePublishedRowMaintenancePathDbState();
    expect(cancelledState.workerScheduleCount).toBe(1);
    expect(cancelledState.workerSchedule?.id).toBe(scenario.scheduleId);
    expect(cancelledState.workerSchedule?.status).toBe("CANCELLED");
    expect(cancelledState.workerSchedule?.note).toBe(CLEARED_WORK_ROW_NOTE);
    expect(cancelledState.workerSchedule?.updatedById).toBe(scenario.manager.id);
    expect(cancelledState.workerSchedule?.publishedById).toBe(scenario.manager.id);
    expect(cancelledState.workerSchedule?.publishedAt).not.toBeNull();
    expect(cancelledState.scheduleEvents).toHaveLength(2);

    const managerNoteEvent = cancelledState.scheduleEvents.find(
      (event) => event.eventType === "MANAGER_NOTE_ADDED",
    );
    const cancelledEvent = cancelledState.scheduleEvents.find(
      (event) => event.eventType === "SCHEDULE_CANCELLED",
    );

    expect(managerNoteEvent?.note).toContain(scenario.editNote);
    expect(cancelledEvent?.note).toBe(CLEARED_WORK_ROW_NOTE);
    expect(cancelledEvent?.actorUserId).toBe(scenario.manager.id);
  });
});
