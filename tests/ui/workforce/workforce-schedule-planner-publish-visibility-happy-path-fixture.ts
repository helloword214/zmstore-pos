import "dotenv/config";

import {
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
  deleteWorkforceSchedulePlannerPublishVisibilityHappyPathArtifacts,
  resetWorkforceSchedulePlannerPublishVisibilityHappyPathState,
  resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext,
} from "../../../scripts/qa/workforce/workforce-schedule-planner-publish-visibility-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_ENABLE_ENV =
  "QA_WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_ENABLE";

type WorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext =
  Awaited<
    ReturnType<
      typeof resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext
    >
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
      "Invalid auth cookie returned while creating the workforce schedule planner QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

export function isWorkforceSchedulePlannerPublishVisibilityHappyPathEnabled() {
  return (
    process.env[
      WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_ENABLE_ENV
    ] === "1"
  );
}

export function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export async function resetWorkforceSchedulePlannerPublishVisibilityHappyPathQaState() {
  return resetWorkforceSchedulePlannerPublishVisibilityHappyPathState();
}

export async function cleanupWorkforceSchedulePlannerPublishVisibilityHappyPathQaState() {
  return deleteWorkforceSchedulePlannerPublishVisibilityHappyPathArtifacts();
}

export async function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenario() {
  return resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext();
}

export async function bootstrapWorkforceSchedulePlannerPublishVisibilityHappyPathSession(
  context: BrowserContext,
) {
  const scenario =
    await resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenario();
  const baseUrl = new URL(
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathBaseURL(),
  );

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.manager.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error(
      "Workforce schedule planner QA session bootstrap did not return a session cookie.",
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

export async function openWorkforceSchedulePlannerPublishVisibilityHappyPath(
  page: Page,
) {
  const url = new URL(
    "/store/workforce/schedule-planner",
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathBaseURL(),
  ).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL(
    (target) => target.pathname === "/store/workforce/schedule-planner",
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /workforce schedule planner/i }),
  ).toBeVisible();
}

export async function openWorkforceAttendanceReviewVisibilityPage(page: Page) {
  const scenario =
    await resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenario();
  const url = new URL(
    `/store/workforce/attendance-review?date=${encodeURIComponent(
      scenario.targetDateInput,
    )}`,
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathBaseURL(),
  ).toString();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL(
    (target) => target.pathname === "/store/workforce/attendance-review",
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /workforce attendance review/i }),
  ).toBeVisible();
}

export function findWorkforceSchedulePlannerPublishVisibilityHappyPathPlannerRow(
  page: Page,
  employeeLabel: string,
) {
  return page.locator("tr").filter({ hasText: employeeLabel }).first();
}

export function findWorkforceSchedulePlannerPublishVisibilityHappyPathAttendanceRow(
  page: Page,
  employeeLabel: string,
) {
  return page.locator("tr").filter({ hasText: employeeLabel }).first();
}

export async function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState() {
  const scenario =
    await resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenario();

  const user = await db.user.findUnique({
    where: { email: scenario.email },
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
  });

  const template = await db.scheduleTemplate.findFirst({
    where: { templateName: scenario.templateName },
    select: {
      id: true,
      templateName: true,
      branchId: true,
      role: true,
      status: true,
      effectiveFrom: true,
      effectiveTo: true,
      createdById: true,
      updatedById: true,
      days: {
        orderBy: { dayOfWeek: "asc" },
        select: {
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
          note: true,
        },
      },
      assignments: {
        orderBy: { id: "asc" },
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
  });

  const workerSchedule = user?.employee
    ? await db.workerSchedule.findFirst({
        where: {
          workerId: user.employee.id,
          scheduleDate: toDateOnly(scenario.targetDateInput),
        },
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
      })
    : null;

  return {
    template,
    user,
    workerSchedule,
  };
}

export function expectWorkforceSchedulePlannerPublishVisibilityHappyPathInitialDbState(
  state: Awaited<
    ReturnType<
      typeof resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState
    >
  >,
  scenario: WorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext,
) {
  expect(state.user).not.toBeNull();
  expect(state.user?.role).toBe(UserRole.CASHIER);
  expect(state.user?.active).toBe(true);
  expect(state.user?.authState).toBe(UserAuthState.ACTIVE);
  expect(state.user?.employee).not.toBeNull();
  expect(state.user?.employee?.role).toBe(EmployeeRole.STAFF);
  expect(state.user?.employee?.active).toBe(true);
  expect(state.user?.employee?.firstName).toBe(scenario.firstName);
  expect(state.user?.employee?.lastName).toBe(scenario.lastName);
  expect(state.user?.employee?.phone).toBe(scenario.phone);
  expect(state.user?.branches.map((branch) => branch.branchId)).toEqual([
    scenario.defaultBranch.id,
  ]);

  expect(state.template).not.toBeNull();
  expect(state.template?.templateName).toBe(scenario.templateName);
  expect(state.template?.branchId).toBe(scenario.defaultBranch.id);
  expect(state.template?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(state.template?.status).toBe(WorkerScheduleTemplateStatus.ACTIVE);
  expect(state.template?.createdById).toBe(scenario.manager.id);
  expect(state.template?.updatedById).toBe(scenario.manager.id);
  expect(state.template?.days).toHaveLength(1);
  expect(state.template?.assignments).toHaveLength(1);
  expect(state.template?.assignments[0]?.workerId).toBe(
    state.user?.employee?.id,
  );
  expect(state.template?.assignments[0]?.status).toBe(
    WorkerScheduleAssignmentStatus.ACTIVE,
  );
  expect(state.template?.assignments[0]?.createdById).toBe(scenario.manager.id);
  expect(state.template?.assignments[0]?.updatedById).toBe(scenario.manager.id);

  expect(state.workerSchedule).toBeNull();
}

export function expectWorkforceSchedulePlannerPublishVisibilityHappyPathGeneratedDbState(
  state: Awaited<
    ReturnType<
      typeof resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState
    >
  >,
  scenario: WorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext,
) {
  expect(state.workerSchedule).not.toBeNull();
  expect(state.workerSchedule?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(state.workerSchedule?.status).toBe(WorkerScheduleStatus.DRAFT);
  expect(state.workerSchedule?.branchId).toBe(scenario.defaultBranch.id);
  expect(state.workerSchedule?.templateAssignmentId).toBe(
    state.template?.assignments[0]?.id,
  );
  expect(state.workerSchedule?.publishedById).toBeNull();
  expect(state.workerSchedule?.publishedAt).toBeNull();
  expect(state.workerSchedule?.createdById).toBe(scenario.manager.id);
  expect(state.workerSchedule?.updatedById).toBe(scenario.manager.id);
}

export function expectWorkforceSchedulePlannerPublishVisibilityHappyPathPublishedDbState(
  state: Awaited<
    ReturnType<
      typeof resolveWorkforceSchedulePlannerPublishVisibilityHappyPathDbState
    >
  >,
  scenario: WorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext,
) {
  expect(state.workerSchedule).not.toBeNull();
  expect(state.workerSchedule?.status).toBe(WorkerScheduleStatus.PUBLISHED);
  expect(state.workerSchedule?.publishedById).toBe(scenario.manager.id);
  expect(state.workerSchedule?.publishedAt).not.toBeNull();
  expect(state.workerSchedule?.templateAssignmentId).toBe(
    state.template?.assignments[0]?.id,
  );
}

export async function expectWorkforceSchedulePlannerPublishVisibilityHappyPathPlannerRowState(
  row: Locator,
  scenario: WorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext,
  expectedStatus: "DRAFT" | "PUBLISHED",
) {
  await expect(row).toContainText(scenario.employeeLabel);
  await expect(row).toContainText("CASHIER");
  await expect(row).toContainText(scenario.timeWindowLabel);
  await expect(row).toContainText(new RegExp(`\\b${expectedStatus}\\b`));
}
