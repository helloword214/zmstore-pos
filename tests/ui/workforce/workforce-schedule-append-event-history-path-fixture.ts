import "dotenv/config";

import {
  EmployeeRole,
  UserAuthState,
  UserRole,
  WorkerScheduleAssignmentStatus,
  WorkerScheduleEventType,
  WorkerScheduleRole,
  WorkerScheduleStatus,
  WorkerScheduleTemplateStatus,
} from "@prisma/client";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_INITIAL_NOTE,
  deleteWorkforceScheduleAppendEventHistoryPathArtifacts,
  resetWorkforceScheduleAppendEventHistoryPathState,
  resolveWorkforceScheduleAppendEventHistoryPathScenarioContext,
} from "../../../scripts/qa/workforce/workforce-schedule-append-event-history-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_ENABLE_ENV =
  "QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_ENABLE";

type WorkforceScheduleAppendEventHistoryPathScenarioContext = Awaited<
  ReturnType<typeof resolveWorkforceScheduleAppendEventHistoryPathScenarioContext>
>;

function toDateOnly(value: Date | string) {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function formatTimeInput(value: Date | string) {
  const date = new Date(value);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the workforce schedule append event history QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

export function isWorkforceScheduleAppendEventHistoryPathEnabled() {
  return (
    process.env[
      WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_ENABLE_ENV
    ] === "1"
  );
}

export function resolveWorkforceScheduleAppendEventHistoryPathBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export async function resetWorkforceScheduleAppendEventHistoryPathQaState() {
  return resetWorkforceScheduleAppendEventHistoryPathState();
}

export async function cleanupWorkforceScheduleAppendEventHistoryPathQaState() {
  return deleteWorkforceScheduleAppendEventHistoryPathArtifacts();
}

export async function resolveWorkforceScheduleAppendEventHistoryPathScenario() {
  return resolveWorkforceScheduleAppendEventHistoryPathScenarioContext();
}

export async function bootstrapWorkforceScheduleAppendEventHistoryPathSession(
  context: BrowserContext,
) {
  const scenario =
    await resolveWorkforceScheduleAppendEventHistoryPathScenario();
  const baseUrl = new URL(
    resolveWorkforceScheduleAppendEventHistoryPathBaseURL(),
  );

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.manager.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error(
      "Workforce schedule append event history QA session bootstrap did not return a session cookie.",
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

export async function openWorkforceScheduleAppendEventHistoryPath(page: Page) {
  const scenario =
    await resolveWorkforceScheduleAppendEventHistoryPathScenario();
  const url = new URL(
    scenario.plannerRoute,
    resolveWorkforceScheduleAppendEventHistoryPathBaseURL(),
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

export function findWorkforceScheduleAppendEventHistoryPathPlannerRow(
  page: Page,
  workerLabel: string,
) {
  return page.locator("tr").filter({ hasText: workerLabel }).first();
}

export function findWorkforceScheduleAppendEventHistoryPathHistoryEntry(
  page: Page,
  eventNote: string,
) {
  return page.locator("div").filter({ hasText: eventNote }).first();
}

export async function resolveWorkforceScheduleAppendEventHistoryPathDbState() {
  const scenario =
    await resolveWorkforceScheduleAppendEventHistoryPathScenario();

  const [subjectUser, relatedUser, template, workerSchedule, scheduleEvents] =
    await Promise.all([
      db.user.findUnique({
        where: { email: scenario.subjectWorkerEmail },
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
        where: { email: scenario.relatedWorkerEmail },
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
      db.scheduleEvent.findMany({
        where: { scheduleId: scenario.scheduleId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          eventType: true,
          actorUserId: true,
          subjectWorkerId: true,
          relatedWorkerId: true,
          note: true,
        },
      }),
    ]);

  const workerScheduleCount = subjectUser?.employee
    ? await db.workerSchedule.count({
        where: {
          workerId: subjectUser.employee.id,
          scheduleDate: toDateOnly(scenario.targetDateInput),
        },
      })
    : 0;

  return {
    relatedUser,
    scheduleEvents,
    subjectUser,
    template,
    workerSchedule,
    workerScheduleCount,
  };
}

export function expectWorkforceScheduleAppendEventHistoryPathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleAppendEventHistoryPathDbState>
  >,
  scenario: WorkforceScheduleAppendEventHistoryPathScenarioContext,
) {
  expect(state.subjectUser).not.toBeNull();
  expect(state.subjectUser?.role).toBe(UserRole.CASHIER);
  expect(state.subjectUser?.active).toBe(true);
  expect(state.subjectUser?.authState).toBe(UserAuthState.ACTIVE);
  expect(state.subjectUser?.employee).not.toBeNull();
  expect(state.subjectUser?.employee?.role).toBe(EmployeeRole.STAFF);
  expect(state.subjectUser?.employee?.active).toBe(true);
  expect(state.subjectUser?.employee?.phone).toBe(scenario.subjectWorkerPhone);
  expect(
    state.subjectUser?.branches.map((branch) => branch.branchId),
  ).toEqual([scenario.defaultBranch.id]);

  expect(state.relatedUser).not.toBeNull();
  expect(state.relatedUser?.role).toBe(UserRole.CASHIER);
  expect(state.relatedUser?.active).toBe(true);
  expect(state.relatedUser?.authState).toBe(UserAuthState.ACTIVE);
  expect(state.relatedUser?.employee).not.toBeNull();
  expect(state.relatedUser?.employee?.role).toBe(EmployeeRole.STAFF);
  expect(state.relatedUser?.employee?.active).toBe(true);
  expect(state.relatedUser?.employee?.phone).toBe(scenario.relatedWorkerPhone);
  expect(
    state.relatedUser?.branches.map((branch) => branch.branchId),
  ).toEqual([scenario.defaultBranch.id]);

  expect(state.template).not.toBeNull();
  expect(state.template?.id).toBe(scenario.templateId);
  expect(state.template?.templateName).toBe(scenario.templateName);
  expect(state.template?.branchId).toBe(scenario.defaultBranch.id);
  expect(state.template?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(state.template?.status).toBe(WorkerScheduleTemplateStatus.ACTIVE);
  expect(state.template?.createdById).toBe(scenario.manager.id);
  expect(state.template?.updatedById).toBe(scenario.manager.id);
  expect(state.template?.assignments).toHaveLength(1);
  expect(state.template?.assignments[0]?.workerId).toBe(
    state.subjectUser?.employee?.id,
  );
  expect(state.template?.assignments[0]?.status).toBe(
    WorkerScheduleAssignmentStatus.ACTIVE,
  );

  expect(state.workerScheduleCount).toBe(1);
  expect(state.workerSchedule).not.toBeNull();
  expect(state.workerSchedule?.id).toBe(scenario.scheduleId);
  expect(state.workerSchedule?.workerId).toBe(state.subjectUser?.employee?.id);
  expect(state.workerSchedule?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(state.workerSchedule?.branchId).toBe(scenario.defaultBranch.id);
  expect(formatTimeInput(state.workerSchedule?.startAt ?? "")).toBe("08:00");
  expect(formatTimeInput(state.workerSchedule?.endAt ?? "")).toBe("17:00");
  expect(state.workerSchedule?.templateAssignmentId).toBe(
    state.template?.assignments[0]?.id,
  );
  expect(state.workerSchedule?.status).toBe(WorkerScheduleStatus.DRAFT);
  expect(state.workerSchedule?.note).toBe(
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_INITIAL_NOTE,
  );
  expect(state.workerSchedule?.createdById).toBe(scenario.manager.id);
  expect(state.workerSchedule?.updatedById).toBe(scenario.manager.id);
  expect(state.scheduleEvents).toHaveLength(0);
}

export function expectWorkforceScheduleAppendEventHistoryPathAppendedDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleAppendEventHistoryPathDbState>
  >,
  scenario: WorkforceScheduleAppendEventHistoryPathScenarioContext,
) {
  expect(state.workerScheduleCount).toBe(1);
  expect(state.workerSchedule?.id).toBe(scenario.scheduleId);
  expect(state.workerSchedule?.status).toBe(WorkerScheduleStatus.DRAFT);
  expect(formatTimeInput(state.workerSchedule?.startAt ?? "")).toBe("08:00");
  expect(formatTimeInput(state.workerSchedule?.endAt ?? "")).toBe("17:00");
  expect(state.workerSchedule?.note).toBe(
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_INITIAL_NOTE,
  );
  expect(state.workerSchedule?.templateAssignmentId).toBe(
    state.template?.assignments[0]?.id,
  );
  expect(state.workerSchedule?.updatedById).toBe(scenario.manager.id);

  expect(state.scheduleEvents).toHaveLength(1);
  expect(state.scheduleEvents[0]?.eventType).toBe(
    WorkerScheduleEventType.REPLACEMENT_ASSIGNED,
  );
  expect(state.scheduleEvents[0]?.actorUserId).toBe(scenario.manager.id);
  expect(state.scheduleEvents[0]?.subjectWorkerId).toBe(
    state.subjectUser?.employee?.id,
  );
  expect(state.scheduleEvents[0]?.relatedWorkerId).toBe(
    state.relatedUser?.employee?.id,
  );
  expect(state.scheduleEvents[0]?.note).toBe(scenario.eventNote);
}

export async function expectWorkforceScheduleAppendEventHistoryPathPlannerRowState(
  row: Locator,
  scenario: WorkforceScheduleAppendEventHistoryPathScenarioContext,
) {
  await expect(row).toContainText(scenario.subjectWorkerLabel);
  await expect(row).toContainText("CASHIER");
  await expect(row).toContainText(scenario.initialTimeWindowLabel);
  await expect(row).toContainText(/\bDRAFT\b/);
}
