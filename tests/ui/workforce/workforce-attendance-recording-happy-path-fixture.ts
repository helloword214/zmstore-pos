import "dotenv/config";

import {
  AttendanceDayType,
  AttendanceLateFlag,
  AttendanceResult,
  AttendanceWorkContext,
  EmployeeRole,
  UserAuthState,
  UserRole,
  WorkerScheduleAssignmentStatus,
  WorkerScheduleRole,
  WorkerScheduleStatus,
  WorkerScheduleTemplateStatus,
} from "@prisma/client";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  deleteWorkforceAttendanceRecordingHappyPathArtifacts,
  resetWorkforceAttendanceRecordingHappyPathState,
  resolveWorkforceAttendanceRecordingHappyPathScenarioContext,
  WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DEFAULT_DAILY_RATE,
  WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR,
} from "../../../scripts/qa/workforce/workforce-attendance-recording-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ENABLE_ENV =
  "QA_WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ENABLE";

type WorkforceAttendanceRecordingHappyPathScenarioContext =
  Awaited<
    ReturnType<typeof resolveWorkforceAttendanceRecordingHappyPathScenarioContext>
  >;

function toDateOnly(value: Date | string) {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the workforce attendance recording QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

export function isWorkforceAttendanceRecordingHappyPathEnabled() {
  return (
    process.env[WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ENABLE_ENV] === "1"
  );
}

export function resolveWorkforceAttendanceRecordingHappyPathBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export async function resetWorkforceAttendanceRecordingHappyPathQaState() {
  return resetWorkforceAttendanceRecordingHappyPathState();
}

export async function cleanupWorkforceAttendanceRecordingHappyPathQaState() {
  return deleteWorkforceAttendanceRecordingHappyPathArtifacts();
}

export async function resolveWorkforceAttendanceRecordingHappyPathScenario() {
  return resolveWorkforceAttendanceRecordingHappyPathScenarioContext();
}

export async function bootstrapWorkforceAttendanceRecordingHappyPathSession(
  context: BrowserContext,
) {
  const scenario = await resolveWorkforceAttendanceRecordingHappyPathScenario();
  const baseUrl = new URL(
    resolveWorkforceAttendanceRecordingHappyPathBaseURL(),
  );

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.manager.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error(
      "Workforce attendance recording QA session bootstrap did not return a session cookie.",
    );
  }

  const cookie = parseCookiePair(setCookieHeader);
  await context.clearCookies();
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: baseUrl.hostname,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
      httpOnly: true,
      secure: baseUrl.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

export async function openWorkforceAttendanceRecordingHappyPath(page: Page) {
  const scenario = await resolveWorkforceAttendanceRecordingHappyPathScenario();
  const url = new URL(
    `${scenario.attendanceRoute}?date=${encodeURIComponent(
      scenario.dutyDateInput,
    )}&workerId=${scenario.workerId}`,
    resolveWorkforceAttendanceRecordingHappyPathBaseURL(),
  ).toString();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL(
    (target) =>
      target.pathname === "/store/workforce/attendance-review" &&
      target.searchParams.get("date") === scenario.dutyDateInput &&
      target.searchParams.get("workerId") === String(scenario.workerId),
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /workforce attendance review/i }),
  ).toBeVisible();
}

export function findWorkforceAttendanceRecordingHappyPathAttendanceRow(
  page: Page,
  workerLabel: string,
) {
  return page.locator("tr").filter({ hasText: workerLabel }).first();
}

export async function resolveWorkforceAttendanceRecordingHappyPathDbState() {
  const scenario = await resolveWorkforceAttendanceRecordingHappyPathScenario();

  const [user, template, workerSchedule, attendanceRecord, scheduleEvents] =
    await Promise.all([
      db.user.findUnique({
        where: { email: scenario.workerEmail },
        select: {
          id: true,
          role: true,
          active: true,
          authState: true,
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              alias: true,
              phone: true,
              email: true,
              role: true,
              active: true,
            },
          },
          branches: {
            select: {
              branchId: true,
            },
          },
        },
      }),
      db.scheduleTemplate.findFirst({
        where: { templateName: scenario.templateName },
        select: {
          id: true,
          templateName: true,
          branchId: true,
          role: true,
          status: true,
          createdById: true,
          updatedById: true,
          assignments: {
            orderBy: [{ id: "asc" }],
            select: {
              id: true,
              workerId: true,
              status: true,
              effectiveFrom: true,
              effectiveTo: true,
              createdById: true,
              updatedById: true,
            },
          },
        },
      }),
      db.workerSchedule.findUnique({
        where: { id: scenario.scheduleId },
        select: {
          id: true,
          workerId: true,
          role: true,
          branchId: true,
          scheduleDate: true,
          startAt: true,
          endAt: true,
          templateAssignmentId: true,
          status: true,
          note: true,
          createdById: true,
          updatedById: true,
          publishedById: true,
          publishedAt: true,
        },
      }),
      db.attendanceDutyResult.findUnique({
        where: {
          workerId_dutyDate: {
            workerId: scenario.workerId,
            dutyDate: toDateOnly(scenario.dutyDateInput),
          },
        },
        select: {
          id: true,
          workerId: true,
          scheduleId: true,
          dutyDate: true,
          dayType: true,
          attendanceResult: true,
          workContext: true,
          leaveType: true,
          lateFlag: true,
          note: true,
          recordedById: true,
          recordedAt: true,
          dailyRate: true,
          halfDayFactor: true,
        },
      }),
      db.scheduleEvent.findMany({
        where: { scheduleId: scenario.scheduleId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
        },
      }),
    ]);

  const [attendanceCount, activeSuspensionCount] = await Promise.all([
    db.attendanceDutyResult.count({
      where: {
        workerId: scenario.workerId,
        dutyDate: toDateOnly(scenario.dutyDateInput),
      },
    }),
    db.suspensionRecord.count({
      where: {
        workerId: scenario.workerId,
        status: "ACTIVE",
        startDate: { lte: toDateOnly(scenario.dutyDateInput) },
        endDate: { gte: toDateOnly(scenario.dutyDateInput) },
      },
    }),
  ]);

  return {
    activeSuspensionCount,
    attendanceCount,
    attendanceRecord,
    scheduleEvents,
    template,
    user,
    workerSchedule,
  };
}

export function expectWorkforceAttendanceRecordingHappyPathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceAttendanceRecordingHappyPathDbState>
  >,
  scenario: WorkforceAttendanceRecordingHappyPathScenarioContext,
) {
  expect(state.user).not.toBeNull();
  expect(state.user?.role).toBe(UserRole.CASHIER);
  expect(state.user?.active).toBe(true);
  expect(state.user?.authState).toBe(UserAuthState.ACTIVE);
  expect(state.user?.employee).not.toBeNull();
  expect(state.user?.employee?.role).toBe(EmployeeRole.STAFF);
  expect(state.user?.employee?.active).toBe(true);
  expect(state.user?.employee?.phone).toBe(scenario.workerPhone);
  expect(state.user?.branches.map((branch) => branch.branchId)).toEqual([
    scenario.defaultBranch.id,
  ]);

  expect(state.template).not.toBeNull();
  expect(state.template?.id).toBe(scenario.templateId);
  expect(state.template?.templateName).toBe(scenario.templateName);
  expect(state.template?.branchId).toBe(scenario.defaultBranch.id);
  expect(state.template?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(state.template?.status).toBe(WorkerScheduleTemplateStatus.ACTIVE);
  expect(state.template?.createdById).toBe(scenario.manager.id);
  expect(state.template?.updatedById).toBe(scenario.manager.id);
  expect(state.template?.assignments).toHaveLength(1);
  expect(state.template?.assignments[0]?.workerId).toBe(scenario.workerId);
  expect(state.template?.assignments[0]?.status).toBe(
    WorkerScheduleAssignmentStatus.ACTIVE,
  );

  expect(state.workerSchedule).not.toBeNull();
  expect(state.workerSchedule?.id).toBe(scenario.scheduleId);
  expect(state.workerSchedule?.workerId).toBe(scenario.workerId);
  expect(state.workerSchedule?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(state.workerSchedule?.branchId).toBe(scenario.defaultBranch.id);
  expect(state.workerSchedule?.templateAssignmentId).toBe(
    state.template?.assignments[0]?.id,
  );
  expect(state.workerSchedule?.status).toBe(WorkerScheduleStatus.PUBLISHED);
  expect(state.workerSchedule?.publishedById).toBe(scenario.manager.id);
  expect(state.workerSchedule?.publishedAt).not.toBeNull();

  expect(state.attendanceCount).toBe(0);
  expect(state.attendanceRecord).toBeNull();
  expect(state.scheduleEvents).toHaveLength(0);
  expect(state.activeSuspensionCount).toBe(0);
}

export function expectWorkforceAttendanceRecordingHappyPathRecordedDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceAttendanceRecordingHappyPathDbState>
  >,
  scenario: WorkforceAttendanceRecordingHappyPathScenarioContext,
) {
  expect(state.attendanceCount).toBe(1);
  expect(state.attendanceRecord).not.toBeNull();
  expect(state.attendanceRecord?.workerId).toBe(scenario.workerId);
  expect(state.attendanceRecord?.scheduleId).toBe(scenario.scheduleId);
  expect(state.attendanceRecord?.dayType).toBe(AttendanceDayType.WORK_DAY);
  expect(state.attendanceRecord?.attendanceResult).toBe(
    AttendanceResult.WHOLE_DAY,
  );
  expect(state.attendanceRecord?.workContext).toBe(
    AttendanceWorkContext.REGULAR,
  );
  expect(state.attendanceRecord?.leaveType).toBeNull();
  expect(state.attendanceRecord?.lateFlag).toBe(AttendanceLateFlag.NO);
  expect(state.attendanceRecord?.note).toBe(scenario.attendanceNote);
  expect(state.attendanceRecord?.recordedById).toBe(scenario.manager.id);
  expect(state.attendanceRecord?.recordedAt).not.toBeNull();
  expect(Number(state.attendanceRecord?.dailyRate ?? 0)).toBe(
    WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DEFAULT_DAILY_RATE,
  );
  expect(Number(state.attendanceRecord?.halfDayFactor ?? 0)).toBe(
    WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR,
  );

  expect(state.workerSchedule?.status).toBe(WorkerScheduleStatus.PUBLISHED);
  expect(state.workerSchedule?.publishedById).toBe(scenario.manager.id);
  expect(state.workerSchedule?.publishedAt).not.toBeNull();

  expect(state.scheduleEvents).toHaveLength(0);
  expect(state.activeSuspensionCount).toBe(0);
}

export async function expectWorkforceAttendanceRecordingHappyPathAttendanceRowState(
  row: Locator,
  scenario: WorkforceAttendanceRecordingHappyPathScenarioContext,
  expected: {
    attendanceSummary: string;
    attendanceDetail: string;
  },
) {
  await expect(row).toContainText(scenario.workerLabel);
  await expect(row).toContainText("CASHIER");
  await expect(row).toContainText(scenario.timeWindowLabel);
  await expect(row).toContainText(expected.attendanceSummary);
  await expect(row).toContainText(expected.attendanceDetail);
}
