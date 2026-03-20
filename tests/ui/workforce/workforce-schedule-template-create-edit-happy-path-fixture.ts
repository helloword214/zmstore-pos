import "dotenv/config";

import {
  WorkerScheduleTemplateDayOfWeek,
  WorkerScheduleTemplateStatus,
} from "@prisma/client";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_DAY_NOTE,
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_DAYS,
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_END_MINUTE,
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_ROLE,
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_START_MINUTE,
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_DAY,
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_DAY_NOTE,
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_END_MINUTE,
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_ROLE,
  WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_START_MINUTE,
  deleteWorkforceScheduleTemplateCreateEditHappyPathArtifacts,
  resetWorkforceScheduleTemplateCreateEditHappyPathState,
  resolveWorkforceScheduleTemplateCreateEditHappyPathManagerEmail,
  resolveWorkforceScheduleTemplateCreateEditHappyPathScenarioContext,
} from "../../../scripts/qa/workforce/workforce-schedule-template-create-edit-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_ENABLE_ENV =
  "QA_WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_ENABLE";

type WorkforceScheduleTemplateCreateEditHappyPathScenarioContext =
  Awaited<
    ReturnType<
      typeof resolveWorkforceScheduleTemplateCreateEditHappyPathScenarioContext
    >
  >;

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the workforce schedule template QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

function minuteToTimeLabel(value: number) {
  const hour = String(Math.floor(value / 60)).padStart(2, "0");
  const minute = String(value % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function isWorkforceScheduleTemplateCreateEditHappyPathEnabled() {
  return (
    process.env[
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_ENABLE_ENV
    ] === "1"
  );
}

export function resolveWorkforceScheduleTemplateCreateEditHappyPathBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export async function resetWorkforceScheduleTemplateCreateEditHappyPathQaState() {
  return resetWorkforceScheduleTemplateCreateEditHappyPathState();
}

export async function cleanupWorkforceScheduleTemplateCreateEditHappyPathQaState() {
  return deleteWorkforceScheduleTemplateCreateEditHappyPathArtifacts();
}

export async function resolveWorkforceScheduleTemplateCreateEditHappyPathScenario() {
  return resolveWorkforceScheduleTemplateCreateEditHappyPathScenarioContext();
}

export async function bootstrapWorkforceScheduleTemplateCreateEditHappyPathSession(
  context: BrowserContext,
) {
  const baseUrl = new URL(
    resolveWorkforceScheduleTemplateCreateEditHappyPathBaseURL(),
  );
  const managerEmail =
    resolveWorkforceScheduleTemplateCreateEditHappyPathManagerEmail();
  const manager = await db.user.findUnique({
    where: { email: managerEmail },
    select: {
      id: true,
      active: true,
      role: true,
    },
  });

  if (!manager || !manager.active || manager.role !== "STORE_MANAGER") {
    throw new Error(
      `Workforce schedule template create/edit happy path requires an active STORE_MANAGER account: ${managerEmail}`,
    );
  }

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    manager.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error(
      "Workforce schedule template create/edit QA session bootstrap did not return a session cookie.",
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

export async function openWorkforceScheduleTemplateCreateEditHappyPath(page: Page) {
  const url = new URL(
    "/store/workforce/schedule-templates",
    resolveWorkforceScheduleTemplateCreateEditHappyPathBaseURL(),
  ).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL(
    (target) => target.pathname === "/store/workforce/schedule-templates",
    {
      timeout: 10_000,
    },
  );
  await expect(
    page.getByRole("heading", { name: /workforce schedule templates/i }),
  ).toBeVisible();
}

export function findWorkforceScheduleTemplateCreateEditHappyPathLibraryRow(
  page: Page,
  templateName: string,
) {
  return page.locator("tr").filter({ hasText: templateName }).first();
}

export function findWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanel(
  page: Page,
) {
  return page.locator("aside").filter({
    has: page.getByRole("heading", { name: /selected template days/i }),
  });
}

export async function resolveWorkforceScheduleTemplateCreateEditHappyPathDbState() {
  const scenario =
    await resolveWorkforceScheduleTemplateCreateEditHappyPathScenario();

  const templates = await db.scheduleTemplate.findMany({
    where: {
      templateName: {
        in: [scenario.initialTemplateName, scenario.editedTemplateName],
      },
    },
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
          id: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
          note: true,
        },
      },
      assignments: {
        select: { id: true },
      },
    },
    orderBy: [{ id: "asc" }],
  });

  return {
    template: templates[0] ?? null,
    templates,
  };
}

export function expectWorkforceScheduleTemplateCreateEditHappyPathInitialDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleTemplateCreateEditHappyPathDbState>
  >,
) {
  expect(state.templates).toHaveLength(0);
  expect(state.template).toBeNull();
}

export function expectWorkforceScheduleTemplateCreateEditHappyPathCreatedDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleTemplateCreateEditHappyPathDbState>
  >,
  scenario: WorkforceScheduleTemplateCreateEditHappyPathScenarioContext,
) {
  expect(state.templates).toHaveLength(1);
  expect(state.template?.templateName).toBe(scenario.initialTemplateName);
  expect(state.template?.branchId).toBeNull();
  expect(state.template?.role).toBe(
    WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_ROLE,
  );
  expect(state.template?.status).toBe(WorkerScheduleTemplateStatus.ACTIVE);
  expect(state.template?.createdById).toBe(scenario.manager.id);
  expect(state.template?.updatedById).toBe(scenario.manager.id);
  expect(state.template?.assignments).toHaveLength(0);
  expect(state.template?.days).toHaveLength(1);
  expect(state.template?.days[0]?.dayOfWeek).toBe(
    WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_DAY,
  );
  expect(state.template?.days[0]?.startMinute).toBe(
    WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_START_MINUTE,
  );
  expect(state.template?.days[0]?.endMinute).toBe(
    WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_END_MINUTE,
  );
  expect(state.template?.days[0]?.note).toBe(
    WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_DAY_NOTE,
  );
}

export function expectWorkforceScheduleTemplateCreateEditHappyPathEditedDbState(
  state: Awaited<
    ReturnType<typeof resolveWorkforceScheduleTemplateCreateEditHappyPathDbState>
  >,
  scenario: WorkforceScheduleTemplateCreateEditHappyPathScenarioContext,
  originalTemplateId: number,
) {
  expect(state.templates).toHaveLength(1);
  expect(state.template?.id).toBe(originalTemplateId);
  expect(state.template?.templateName).toBe(scenario.editedTemplateName);
  expect(state.template?.branchId).toBeNull();
  expect(state.template?.role).toBe(
    WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_ROLE,
  );
  expect(state.template?.status).toBe(WorkerScheduleTemplateStatus.ACTIVE);
  expect(state.template?.createdById).toBe(scenario.manager.id);
  expect(state.template?.updatedById).toBe(scenario.manager.id);
  expect(state.template?.assignments).toHaveLength(0);
  expect(state.template?.days).toHaveLength(2);

  const editedDays = state.template?.days.map((day) => day.dayOfWeek) ?? [];
  expect(editedDays).toEqual([
    ...WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_DAYS,
  ]);

  for (const day of state.template?.days ?? []) {
    expect(day.startMinute).toBe(
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_START_MINUTE,
    );
    expect(day.endMinute).toBe(
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_END_MINUTE,
    );
    expect(day.note).toBe(
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_DAY_NOTE,
    );
  }
}

export async function expectWorkforceScheduleTemplateCreateEditHappyPathLibraryRowState(
  row: Locator,
  args: {
    role: "CASHIER" | "EMPLOYEE";
    templateName: string;
    workDayCount: number;
  },
) {
  await expect(row).toContainText(args.templateName);
  await expect(row).toContainText(
    `${args.role} · ${args.workDayCount} work day(s)`,
  );
}

export async function expectWorkforceScheduleTemplateCreateEditHappyPathSelectedDaysPanelState(
  panel: Locator,
  args: {
    days: Array<WorkerScheduleTemplateDayOfWeek>;
    note: string;
    timeWindowLabel: string;
  },
) {
  for (const day of args.days) {
    await expect(panel.getByText(day, { exact: true })).toBeVisible();
    await expect(panel.getByText(args.timeWindowLabel, { exact: true })).toBeVisible();
    await expect(panel.getByText(args.note, { exact: true })).toBeVisible();
  }
}

export function resolveWorkforceScheduleTemplateCreateEditHappyPathInitialTimeInput() {
  return {
    end: minuteToTimeLabel(
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_END_MINUTE,
    ),
    start: minuteToTimeLabel(
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_START_MINUTE,
    ),
  };
}

export function resolveWorkforceScheduleTemplateCreateEditHappyPathEditedTimeInput() {
  return {
    end: minuteToTimeLabel(
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_END_MINUTE,
    ),
    start: minuteToTimeLabel(
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_START_MINUTE,
    ),
  };
}
