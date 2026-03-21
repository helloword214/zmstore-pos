import { expect, test } from "@playwright/test";
import {
  WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ENABLE_ENV,
  bootstrapWorkforceAttendanceRecordingHappyPathSession,
  cleanupWorkforceAttendanceRecordingHappyPathQaState,
  expectWorkforceAttendanceRecordingHappyPathAttendanceRowState,
  expectWorkforceAttendanceRecordingHappyPathInitialDbState,
  expectWorkforceAttendanceRecordingHappyPathRecordedDbState,
  findWorkforceAttendanceRecordingHappyPathAttendanceRow,
  isWorkforceAttendanceRecordingHappyPathEnabled,
  openWorkforceAttendanceRecordingHappyPath,
  resetWorkforceAttendanceRecordingHappyPathQaState,
  resolveWorkforceAttendanceRecordingHappyPathDbState,
  resolveWorkforceAttendanceRecordingHappyPathScenario,
} from "./workforce-attendance-recording-happy-path-fixture";

test.describe("workforce attendance recording happy path", () => {
  test.skip(
    !isWorkforceAttendanceRecordingHappyPathEnabled(),
    `Run \`npm run qa:workforce:attendance-recording:happy-path:setup\` first, then set ${WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforceAttendanceRecordingHappyPathQaState();
    await bootstrapWorkforceAttendanceRecordingHappyPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupWorkforceAttendanceRecordingHappyPathQaState();
  });

  test("manager can record a regular whole-day attendance fact for a published row", async ({
    page,
  }) => {
    const scenario = await resolveWorkforceAttendanceRecordingHappyPathScenario();

    await openWorkforceAttendanceRecordingHappyPath(page);

    const initialState =
      await resolveWorkforceAttendanceRecordingHappyPathDbState();
    expectWorkforceAttendanceRecordingHappyPathInitialDbState(
      initialState,
      scenario,
    );

    const attendanceRow =
      findWorkforceAttendanceRecordingHappyPathAttendanceRow(
        page,
        scenario.workerLabel,
      );
    await expect(attendanceRow).toBeVisible();
    await expect(attendanceRow).toContainText("Scheduled");
    await expect(attendanceRow).toContainText(scenario.timeWindowLabel);
    await expect(attendanceRow).toContainText("Not recorded yet");
    await expect(
      page.getByText(`Current attendance review date: ${scenario.dutyDateLabel}`),
    ).toBeVisible();
    await expect(
      page.getByText(`Planned row: ${scenario.timeWindowLabel}`),
    ).toBeVisible();

    await page.locator('select[name="dayType"]').selectOption("WORK_DAY");
    await page
      .locator('select[name="attendanceResult"]')
      .selectOption("WHOLE_DAY");
    await page.locator('select[name="workContext"]').selectOption("REGULAR");
    await page.locator('select[name="lateFlag"]').selectOption("NO");
    await page.getByLabel(/^Manager note$/i).fill(scenario.attendanceNote);
    await page.getByRole("button", { name: /^Save attendance fact$/i }).click();

    await expect(page.getByText("Attendance record saved.")).toBeVisible();
    await page.waitForURL(
      (target) =>
        target.pathname === "/store/workforce/attendance-review" &&
        target.searchParams.get("date") === scenario.dutyDateInput &&
        target.searchParams.get("workerId") === String(scenario.workerId) &&
        target.searchParams.get("saved") === "attendance",
      {
        timeout: 10_000,
      },
    );

    await expectWorkforceAttendanceRecordingHappyPathAttendanceRowState(
      attendanceRow,
      scenario,
      {
        attendanceSummary: "WHOLE_DAY",
        attendanceDetail: "WORK_DAY · REGULAR",
      },
    );
    await expect(page.getByText("WHOLE_DAY").first()).toBeVisible();

    const recordedState =
      await resolveWorkforceAttendanceRecordingHappyPathDbState();
    expectWorkforceAttendanceRecordingHappyPathRecordedDbState(
      recordedState,
      scenario,
    );
  });
});
