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
  deleteWorkforceScheduleRowUpdateOrCancelPathArtifacts,
  resetWorkforceScheduleRowUpdateOrCancelPathState,
  resolveWorkforceScheduleRowUpdateOrCancelPathScenarioContext,
} from "../../../scripts/qa/workforce/workforce-schedule-row-update-or-cancel-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const WORKFORCE_SCHEDULE_ROW_UPDATE_OR_CANCEL_PATH_ENABLE_ENV =
  "QA_WORKFORCE_SCHEDULE_ROW_UPDATE_OR_CANCEL_PATH_ENABLE";

type WorkforceScheduleRowUpdateOrCancelPathScenarioContext =
  Awaited<
    ReturnType<typeof resolveWorkforceScheduleRowUpdateOrCancelPathScenarioContext>
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
      "Invalid auth cookie returned while creating the workforce schedule row update or cancel QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

function formatTimeInput(value: Date | string) {
  const date = new Date(value);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function isWorkforceScheduleRowUpdateOrCancelPathEnabled() {
  return (
    process.env[WORKFORCE_SCHEDULE_ROW_UPDATE_OR_CANCEL_PATH_ENABLE_ENV] === "1"
  );
}

export function resolveWorkforceScheduleRowUpdateOrCancelPathBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export async function resetWorkforceScheduleRowUpdateOrCancelPathQaState() {
  return resetWorkforceScheduleRowUpdateOrCancelPathState();
}

export async function cleanupWorkforceScheduleRowUpdateOrCancelPathQaState() {
  return deleteWorkforceScheduleRowUpdateOrCancelPathArtifacts();
}

export async function resolveWorkforceScheduleRowUpdateOrCancelPathScenario() {
  return resolveWorkforceScheduleRowUpdateOrCancelPathScenarioContext();
}

export async function bootstrapWorkforceScheduleRowUpdateOrCancelPathSession(
  context: BrowserContext,
) {
  const scenario = await resolveWorkforceScheduleRowUpdateOrCancelPathScenario();
  const baseUrl = new URL(
    resolveWorkforceScheduleRowUpdateOrCancelPathBaseURL(),
  );

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.manager.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error(
      "Workforce schedule row update or cancel QA session bootstrap did not return a session cookie.",
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

export async function openWorkforceScheduleRowUpdateOrCancelPath(page: Page) {
  const scenario = await resolveWorkforceScheduleRowUpdateOrCancelPathScenario();
  const url = new URL(
    scenario.plannerRoute,
    resolveWorkforceScheduleRowUpdateOrCancelPathBaseURL(),
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

export function findWorkforceScheduleRowUpdateOrCancelPathPlannerRow(
  page: Page,
  workerLabel: string,
) {
  return page.locator("tr").filter({ hasText: workerLabel }).first();
}

export async function resolveWorkforceScheduleRowUpdateOrCancelPathDbState() {
  const scenario = await resolveWorkforceScheduleRowUpdateOrCancelPathScenario();

  const [user, template, workerSchedule, scheduleEvents] = await Promise.all([
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
    db.scheduleEvent.findMany({
      where: { scheduleId: scenario.scheduleId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        eventType: true,
        actorUserId: true,
        subjectWorkerId: true,
        note: true,
      },
    }),
  ]);

  const workerScheduleCount = user?.employee
    ? await db.workerSchedule.count({
        where: {
          workerId: user.employee.id,
          scheduleDate: toDateOnly(scenario.targetDateInput),
        },
      })
    : 0;

  return {
    scheduleEvents,
    template,
    user,
    workerSchedule,
    workerScheduleCount,
  };
}

export function expectWorkforceScheduleRowUpdateOrCancelPathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleRowUpdateOrCancelPathDbState>
  >,
  scenario: WorkforceScheduleRowUpdateOrCancelPathScenarioContext,
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
  expect(state.template?.assignments[0]?.workerId).toBe(state.user?.employee?.id);
  expect(state.template?.assignments[0]?.status).toBe(
    WorkerScheduleAssignmentStatus.ACTIVE,
  );
  expect(state.template?.assignments[0]?.createdById).toBe(scenario.manager.id);
  expect(state.template?.assignments[0]?.updatedById).toBe(scenario.manager.id);

  expect(state.workerScheduleCount).toBe(1);
  expect(state.workerSchedule).not.toBeNull();
  expect(state.workerSchedule?.id).toBe(scenario.scheduleId);
  expect(state.workerSchedule?.workerId).toBe(state.user?.employee?.id);
  expect(state.workerSchedule?.role).toBe(WorkerScheduleRole.CASHIER);
  expect(state.workerSchedule?.branchId).toBe(scenario.defaultBranch.id);
  expect(formatTimeInput(state.workerSchedule?.startAt ?? "")).toBe("08:00");
  expect(formatTimeInput(state.workerSchedule?.endAt ?? "")).toBe("17:00");
  expect(state.workerSchedule?.templateAssignmentId).toBe(
    state.template?.assignments[0]?.id,
  );
  expect(state.workerSchedule?.status).toBe(WorkerScheduleStatus.DRAFT);
  expect(state.workerSchedule?.note).toBe("QA seeded draft planner row note");
  expect(state.workerSchedule?.createdById).toBe(scenario.manager.id);
  expect(state.workerSchedule?.updatedById).toBe(scenario.manager.id);
  expect(state.workerSchedule?.publishedById).toBeNull();
  expect(state.workerSchedule?.publishedAt).toBeNull();

  expect(state.scheduleEvents).toHaveLength(0);
}

export function expectWorkforceScheduleRowUpdateOrCancelPathEditedDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleRowUpdateOrCancelPathDbState>
  >,
  scenario: WorkforceScheduleRowUpdateOrCancelPathScenarioContext,
) {
  expect(state.workerScheduleCount).toBe(1);
  expect(state.workerSchedule?.id).toBe(scenario.scheduleId);
  expect(formatTimeInput(state.workerSchedule?.startAt ?? "")).toBe(
    scenario.editStartTimeInput,
  );
  expect(formatTimeInput(state.workerSchedule?.endAt ?? "")).toBe(
    scenario.editEndTimeInput,
  );
  expect(state.workerSchedule?.status).toBe(WorkerScheduleStatus.DRAFT);
  expect(state.workerSchedule?.note).toBe(scenario.editNote);
  expect(state.workerSchedule?.updatedById).toBe(scenario.manager.id);
  expect(state.workerSchedule?.templateAssignmentId).toBe(
    state.template?.assignments[0]?.id,
  );

  expect(state.scheduleEvents).toHaveLength(1);
  expect(state.scheduleEvents[0]?.eventType).toBe(
    WorkerScheduleEventType.MANAGER_NOTE_ADDED,
  );
  expect(state.scheduleEvents[0]?.actorUserId).toBe(scenario.manager.id);
  expect(state.scheduleEvents[0]?.subjectWorkerId).toBe(state.user?.employee?.id);
  expect(state.scheduleEvents[0]?.note).toContain(scenario.editNote);
}

export function expectWorkforceScheduleRowUpdateOrCancelPathCancelledDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleRowUpdateOrCancelPathDbState>
  >,
  scenario: WorkforceScheduleRowUpdateOrCancelPathScenarioContext,
) {
  expect(state.workerScheduleCount).toBe(1);
  expect(state.workerSchedule?.id).toBe(scenario.scheduleId);
  expect(formatTimeInput(state.workerSchedule?.startAt ?? "")).toBe(
    scenario.editStartTimeInput,
  );
  expect(formatTimeInput(state.workerSchedule?.endAt ?? "")).toBe(
    scenario.editEndTimeInput,
  );
  expect(state.workerSchedule?.status).toBe(WorkerScheduleStatus.CANCELLED);
  expect(state.workerSchedule?.note).toBe(scenario.cancellationNote);
  expect(state.workerSchedule?.updatedById).toBe(scenario.manager.id);
  expect(state.workerSchedule?.templateAssignmentId).toBe(
    state.template?.assignments[0]?.id,
  );

  expect(state.scheduleEvents).toHaveLength(2);

  const managerNoteEvent = state.scheduleEvents.find(
    (event) => event.eventType === WorkerScheduleEventType.MANAGER_NOTE_ADDED,
  );
  const cancelledEvent = state.scheduleEvents.find(
    (event) => event.eventType === WorkerScheduleEventType.SCHEDULE_CANCELLED,
  );

  expect(managerNoteEvent).toBeDefined();
  expect(managerNoteEvent?.note).toContain(scenario.editNote);

  expect(cancelledEvent).toBeDefined();
  expect(cancelledEvent?.actorUserId).toBe(scenario.manager.id);
  expect(cancelledEvent?.subjectWorkerId).toBe(state.user?.employee?.id);
  expect(cancelledEvent?.note).toBe(scenario.cancellationNote);
}

export async function expectWorkforceScheduleRowUpdateOrCancelPathPlannerRowState(
  row: Locator,
  scenario: WorkforceScheduleRowUpdateOrCancelPathScenarioContext,
  expected: {
    status: "CANCELLED" | "DRAFT";
    timeWindowLabel: string;
  },
) {
  await expect(row).toContainText(scenario.workerLabel);
  await expect(row).toContainText("CASHIER");
  await expect(row).toContainText(expected.timeWindowLabel);
  await expect(row).toContainText(new RegExp(`\\b${expected.status}\\b`));
}
