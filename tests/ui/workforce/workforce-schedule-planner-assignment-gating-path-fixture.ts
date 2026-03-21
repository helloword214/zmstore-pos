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
  deleteWorkforceSchedulePlannerAssignmentGatingPathArtifacts,
  resetWorkforceSchedulePlannerAssignmentGatingPathState,
  resolveWorkforceSchedulePlannerAssignmentGatingPathScenarioContext,
} from "../../../scripts/qa/workforce/workforce-schedule-planner-assignment-gating-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENABLE_ENV =
  "QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENABLE";

type WorkforceSchedulePlannerAssignmentGatingPathScenarioContext =
  Awaited<
    ReturnType<
      typeof resolveWorkforceSchedulePlannerAssignmentGatingPathScenarioContext
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
      "Invalid auth cookie returned while creating the workforce schedule planner assignment gating QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

export function isWorkforceSchedulePlannerAssignmentGatingPathEnabled() {
  return (
    process.env[
      WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENABLE_ENV
    ] === "1"
  );
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export async function resetWorkforceSchedulePlannerAssignmentGatingPathQaState() {
  return resetWorkforceSchedulePlannerAssignmentGatingPathState();
}

export async function cleanupWorkforceSchedulePlannerAssignmentGatingPathQaState() {
  return deleteWorkforceSchedulePlannerAssignmentGatingPathArtifacts();
}

export async function resolveWorkforceSchedulePlannerAssignmentGatingPathScenario() {
  return resolveWorkforceSchedulePlannerAssignmentGatingPathScenarioContext();
}

export async function bootstrapWorkforceSchedulePlannerAssignmentGatingPathSession(
  context: BrowserContext,
) {
  const scenario =
    await resolveWorkforceSchedulePlannerAssignmentGatingPathScenario();
  const baseUrl = new URL(
    resolveWorkforceSchedulePlannerAssignmentGatingPathBaseURL(),
  );

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.manager.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error(
      "Workforce schedule planner assignment gating QA session bootstrap did not return a session cookie.",
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

export async function openWorkforceSchedulePlannerAssignmentGatingPath(page: Page) {
  const scenario =
    await resolveWorkforceSchedulePlannerAssignmentGatingPathScenario();
  const url = new URL(
    scenario.plannerRoute,
    resolveWorkforceSchedulePlannerAssignmentGatingPathBaseURL(),
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

export function findWorkforceSchedulePlannerAssignmentGatingPathPlannerRow(
  page: Page,
  workerLabel: string,
) {
  return page.locator("tr").filter({ hasText: workerLabel }).first();
}

export async function resolveWorkforceSchedulePlannerAssignmentGatingPathDbState() {
  const scenario =
    await resolveWorkforceSchedulePlannerAssignmentGatingPathScenario();

  const [activeUser, endedUser, template] = await Promise.all([
    db.user.findUnique({
      where: { email: scenario.activeWorkerEmail },
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
    db.user.findUnique({
      where: { email: scenario.endedWorkerEmail },
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
  ]);

  const workerIds = [
    activeUser?.employee?.id,
    endedUser?.employee?.id,
  ].filter((value): value is number => typeof value === "number");

  const workerSchedules =
    workerIds.length > 0
      ? await db.workerSchedule.findMany({
          where: {
            workerId: { in: workerIds },
            scheduleDate: toDateOnly(scenario.targetDateInput),
          },
          orderBy: [{ workerId: "asc" }, { id: "asc" }],
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
      : [];

  return {
    activeUser,
    endedUser,
    template,
    workerSchedules,
  };
}

export function expectWorkforceSchedulePlannerAssignmentGatingPathInitialDbState(
  state: Awaited<
    ReturnType<
      typeof resolveWorkforceSchedulePlannerAssignmentGatingPathDbState
    >
  >,
  scenario: WorkforceSchedulePlannerAssignmentGatingPathScenarioContext,
) {
  expect(state.activeUser).not.toBeNull();
  expect(state.activeUser?.role).toBe(UserRole.CASHIER);
  expect(state.activeUser?.active).toBe(true);
  expect(state.activeUser?.authState).toBe(UserAuthState.ACTIVE);
  expect(state.activeUser?.employee).not.toBeNull();
  expect(state.activeUser?.employee?.role).toBe(EmployeeRole.STAFF);
  expect(state.activeUser?.employee?.active).toBe(true);
  expect(state.activeUser?.employee?.phone).toBe(scenario.activeWorkerPhone);
  expect(
    state.activeUser?.branches.map((branch) => branch.branchId),
  ).toEqual([scenario.defaultBranch.id]);

  expect(state.endedUser).not.toBeNull();
  expect(state.endedUser?.role).toBe(UserRole.CASHIER);
  expect(state.endedUser?.active).toBe(true);
  expect(state.endedUser?.authState).toBe(UserAuthState.ACTIVE);
  expect(state.endedUser?.employee).not.toBeNull();
  expect(state.endedUser?.employee?.role).toBe(EmployeeRole.STAFF);
  expect(state.endedUser?.employee?.active).toBe(true);
  expect(state.endedUser?.employee?.phone).toBe(scenario.endedWorkerPhone);
  expect(
    state.endedUser?.branches.map((branch) => branch.branchId),
  ).toEqual([scenario.defaultBranch.id]);

  expect(state.template).not.toBeNull();
  expect(state.template?.templateName).toBe(scenario.templateName);
  expect(state.template?.branchId).toBe(scenario.defaultBranch.id);
  expect(state.template?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(state.template?.status).toBe(WorkerScheduleTemplateStatus.ACTIVE);
  expect(state.template?.createdById).toBe(scenario.manager.id);
  expect(state.template?.updatedById).toBe(scenario.manager.id);
  expect(state.template?.assignments).toHaveLength(2);

  const activeAssignment = state.template?.assignments.find(
    (assignment) => assignment.workerId === state.activeUser?.employee?.id,
  );
  const endedAssignment = state.template?.assignments.find(
    (assignment) => assignment.workerId === state.endedUser?.employee?.id,
  );

  expect(activeAssignment).toBeDefined();
  expect(activeAssignment?.status).toBe(WorkerScheduleAssignmentStatus.ACTIVE);
  expect(activeAssignment?.createdById).toBe(scenario.manager.id);
  expect(activeAssignment?.updatedById).toBe(scenario.manager.id);

  expect(endedAssignment).toBeDefined();
  expect(endedAssignment?.status).toBe(WorkerScheduleAssignmentStatus.ENDED);
  expect(endedAssignment?.createdById).toBe(scenario.manager.id);
  expect(endedAssignment?.updatedById).toBe(scenario.manager.id);

  expect(state.workerSchedules).toHaveLength(0);
}

export function expectWorkforceSchedulePlannerAssignmentGatingPathGeneratedDbState(
  state: Awaited<
    ReturnType<
      typeof resolveWorkforceSchedulePlannerAssignmentGatingPathDbState
    >
  >,
  scenario: WorkforceSchedulePlannerAssignmentGatingPathScenarioContext,
) {
  expect(state.workerSchedules).toHaveLength(1);

  const activeAssignment = state.template?.assignments.find(
    (assignment) => assignment.workerId === state.activeUser?.employee?.id,
  );
  const activeSchedule = state.workerSchedules[0];

  expect(activeSchedule?.workerId).toBe(state.activeUser?.employee?.id);
  expect(activeSchedule?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(activeSchedule?.status).toBe(WorkerScheduleStatus.DRAFT);
  expect(activeSchedule?.branchId).toBe(scenario.defaultBranch.id);
  expect(activeSchedule?.templateAssignmentId).toBe(activeAssignment?.id);
  expect(activeSchedule?.publishedById).toBeNull();
  expect(activeSchedule?.publishedAt).toBeNull();
  expect(activeSchedule?.createdById).toBe(scenario.manager.id);
  expect(activeSchedule?.updatedById).toBe(scenario.manager.id);

  const endedWorkerSchedule = state.workerSchedules.find(
    (schedule) => schedule.workerId === state.endedUser?.employee?.id,
  );
  expect(endedWorkerSchedule).toBeUndefined();
}

export async function expectWorkforceSchedulePlannerAssignmentGatingPathPlannerRowState(
  row: Locator,
  scenario: WorkforceSchedulePlannerAssignmentGatingPathScenarioContext,
) {
  await expect(row).toContainText(scenario.activeWorkerLabel);
  await expect(row).toContainText("CASHIER");
  await expect(row).toContainText(scenario.timeWindowLabel);
  await expect(row).toContainText(/\bDRAFT\b/);
}
