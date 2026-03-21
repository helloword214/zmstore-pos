import "dotenv/config";

import {
  EmployeeRole,
  UserAuthState,
  UserRole,
  WorkerScheduleAssignmentStatus,
  WorkerScheduleRole,
  WorkerScheduleTemplateStatus,
} from "@prisma/client";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  deleteWorkforceScheduleTemplateAssignmentStatusPathArtifacts,
  resetWorkforceScheduleTemplateAssignmentStatusPathState,
  resolveWorkforceScheduleTemplateAssignmentStatusPathManagerEmail,
  resolveWorkforceScheduleTemplateAssignmentStatusPathScenarioContext,
} from "../../../scripts/qa/workforce/workforce-schedule-template-assignment-status-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_STATUS_PATH_ENABLE_ENV =
  "QA_WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_STATUS_PATH_ENABLE";

type WorkforceScheduleTemplateAssignmentStatusPathScenarioContext =
  Awaited<
    ReturnType<
      typeof resolveWorkforceScheduleTemplateAssignmentStatusPathScenarioContext
    >
  >;

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the workforce schedule template assignment status QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

export function isWorkforceScheduleTemplateAssignmentStatusPathEnabled() {
  return (
    process.env[
      WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_STATUS_PATH_ENABLE_ENV
    ] === "1"
  );
}

export function resolveWorkforceScheduleTemplateAssignmentStatusPathBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export async function resetWorkforceScheduleTemplateAssignmentStatusPathQaState() {
  return resetWorkforceScheduleTemplateAssignmentStatusPathState();
}

export async function cleanupWorkforceScheduleTemplateAssignmentStatusPathQaState() {
  return deleteWorkforceScheduleTemplateAssignmentStatusPathArtifacts();
}

export async function resolveWorkforceScheduleTemplateAssignmentStatusPathScenario() {
  return resolveWorkforceScheduleTemplateAssignmentStatusPathScenarioContext();
}

export async function bootstrapWorkforceScheduleTemplateAssignmentStatusPathSession(
  context: BrowserContext,
) {
  const baseUrl = new URL(
    resolveWorkforceScheduleTemplateAssignmentStatusPathBaseURL(),
  );
  const managerEmail =
    resolveWorkforceScheduleTemplateAssignmentStatusPathManagerEmail();
  const manager = await db.user.findUnique({
    where: { email: managerEmail },
    select: {
      id: true,
      active: true,
      role: true,
    },
  });

  if (!manager || !manager.active || manager.role !== UserRole.STORE_MANAGER) {
    throw new Error(
      `Workforce schedule template assignment status path requires an active STORE_MANAGER account: ${managerEmail}`,
    );
  }

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    manager.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error(
      "Workforce schedule template assignment status QA session bootstrap did not return a session cookie.",
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

export async function openWorkforceScheduleTemplateAssignmentStatusPath(page: Page) {
  const scenario =
    await resolveWorkforceScheduleTemplateAssignmentStatusPathScenario();
  const url = new URL(
    scenario.route,
    resolveWorkforceScheduleTemplateAssignmentStatusPathBaseURL(),
  ).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL(
    (target) =>
      target.pathname === "/store/workforce/schedule-templates" &&
      target.searchParams.get("templateId") === String(scenario.templateId),
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /workforce schedule templates/i }),
  ).toBeVisible();
}

export function findWorkforceScheduleTemplateAssignmentStatusPathAssignmentRow(
  page: Page,
  workerLabel: string,
) {
  return page.locator("tr").filter({ hasText: workerLabel }).first();
}

export async function resolveWorkforceScheduleTemplateAssignmentStatusPathDbState() {
  const scenario =
    await resolveWorkforceScheduleTemplateAssignmentStatusPathScenario();

  const user = await db.user.findUnique({
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
  });

  const template = await db.scheduleTemplate.findFirst({
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
  });

  const workerSchedulesCount = user?.employee
    ? await db.workerSchedule.count({
        where: { workerId: user.employee.id },
      })
    : 0;

  return {
    template,
    user,
    workerSchedulesCount,
  };
}

export function expectWorkforceScheduleTemplateAssignmentStatusPathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleTemplateAssignmentStatusPathDbState>
  >,
  scenario: WorkforceScheduleTemplateAssignmentStatusPathScenarioContext,
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
  expect(state.template?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(state.template?.status).toBe(WorkerScheduleTemplateStatus.ACTIVE);
  expect(state.template?.createdById).toBe(scenario.manager.id);
  expect(state.template?.updatedById).toBe(scenario.manager.id);
  expect(state.template?.assignments).toHaveLength(1);
  expect(state.template?.assignments[0]?.workerId).toBe(state.user?.employee?.id);
  expect(state.template?.assignments[0]?.status).toBe(
    WorkerScheduleAssignmentStatus.ACTIVE,
  );
  expect(String(state.template?.assignments[0]?.effectiveFrom).slice(0, 10)).toBe(
    scenario.assignmentEffectiveFromInput,
  );
  expect(state.template?.assignments[0]?.effectiveTo).toBeNull();
  expect(state.template?.assignments[0]?.createdById).toBe(scenario.manager.id);
  expect(state.template?.assignments[0]?.updatedById).toBe(scenario.manager.id);
  expect(state.workerSchedulesCount).toBe(0);
}

export function expectWorkforceScheduleTemplateAssignmentStatusPathUpdatedDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleTemplateAssignmentStatusPathDbState>
  >,
  scenario: WorkforceScheduleTemplateAssignmentStatusPathScenarioContext,
  originalAssignmentId: number,
  status: WorkerScheduleAssignmentStatus,
) {
  expect(state.user).not.toBeNull();
  expect(state.user?.employee).not.toBeNull();
  expect(state.template).not.toBeNull();
  expect(state.template?.assignments).toHaveLength(1);
  expect(state.template?.assignments[0]?.id).toBe(originalAssignmentId);
  expect(state.template?.assignments[0]?.workerId).toBe(state.user?.employee?.id);
  expect(state.template?.assignments[0]?.status).toBe(status);
  expect(String(state.template?.assignments[0]?.effectiveFrom).slice(0, 10)).toBe(
    scenario.assignmentEffectiveFromInput,
  );
  expect(state.template?.assignments[0]?.effectiveTo).toBeNull();
  expect(state.template?.assignments[0]?.createdById).toBe(scenario.manager.id);
  expect(state.template?.assignments[0]?.updatedById).toBe(scenario.manager.id);
  expect(state.workerSchedulesCount).toBe(0);
}

export async function expectWorkforceScheduleTemplateAssignmentStatusPathAssignmentRowState(
  row: Locator,
  scenario: WorkforceScheduleTemplateAssignmentStatusPathScenarioContext,
  status: WorkerScheduleAssignmentStatus,
) {
  await expect(row).toContainText(scenario.workerLabel);
  await expect(row).toContainText("CASHIER");
  await expect(row).toContainText(
    `${scenario.assignmentEffectiveFromInput} -> open`,
  );
  await expect(row).toContainText(status);
}
