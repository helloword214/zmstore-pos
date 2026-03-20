import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  WorkerScheduleRole,
  WorkerScheduleTemplateDayOfWeek,
} from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";

export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_TEMPLATE_NAME =
  "QA Workforce Template Create Edit Initial";
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_TEMPLATE_NAME =
  "QA Workforce Template Create Edit Edited";
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_EFFECTIVE_FROM_OFFSET_DAYS =
  1;
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_ROLE =
  WorkerScheduleRole.CASHIER;
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_ROLE =
  WorkerScheduleRole.EMPLOYEE;
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_DAY =
  WorkerScheduleTemplateDayOfWeek.MONDAY;
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_DAYS = [
  WorkerScheduleTemplateDayOfWeek.TUESDAY,
  WorkerScheduleTemplateDayOfWeek.THURSDAY,
] as const;
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_START_MINUTE =
  8 * 60;
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_END_MINUTE =
  17 * 60;
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_START_MINUTE =
  9 * 60 + 30;
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_END_MINUTE =
  18 * 60 + 30;
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_DAY_NOTE =
  "QA schedule template create/edit initial note";
export const WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_DAY_NOTE =
  "QA schedule template create/edit edited note";

type ManagerUser = {
  id: number;
  email: string | null;
  role: string;
  active: boolean;
};

type DeleteSummary = {
  deletedAssignments: number;
  deletedSchedules: number;
  deletedTemplates: number;
};

export type WorkforceScheduleTemplateCreateEditHappyPathScenarioContext = {
  editedTemplateName: string;
  editedTimeWindowLabel: string;
  effectiveFromInput: string;
  initialTemplateName: string;
  initialTimeWindowLabel: string;
  manager: ManagerUser;
  route: string;
};

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function toDateOnly(value: Date | string) {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date input.");
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateInput(value: Date | string) {
  const date = toDateOnly(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function minuteToTimeLabel(value: number) {
  const hour = String(Math.floor(value / 60)).padStart(2, "0");
  const minute = String(value % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatTimeWindowLabel(startMinute: number, endMinute: number) {
  return `${minuteToTimeLabel(startMinute)} - ${minuteToTimeLabel(endMinute)}`;
}

export function resolveWorkforceScheduleTemplateCreateEditHappyPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveWorkforceScheduleTemplateCreateEditHappyPathInitialTemplateName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_TEMPLATE_NAME ??
    WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_TEMPLATE_NAME
  ).trim();
}

export function resolveWorkforceScheduleTemplateCreateEditHappyPathEditedTemplateName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_TEMPLATE_NAME ??
    WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_TEMPLATE_NAME
  ).trim();
}

export function resolveWorkforceScheduleTemplateCreateEditHappyPathEffectiveFrom() {
  return addDays(
    toDateOnly(new Date()),
    WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_EFFECTIVE_FROM_OFFSET_DAYS,
  );
}

async function resolveScenarioManager(email: string) {
  const manager = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
    },
  });

  if (!manager || !manager.active || manager.role !== "STORE_MANAGER") {
    throw new Error(
      `Workforce schedule template create/edit happy path requires an active STORE_MANAGER account: ${email}`,
    );
  }

  return manager;
}

export async function deleteWorkforceScheduleTemplateCreateEditHappyPathArtifacts(): Promise<
  DeleteSummary
> {
  const templateNames = [
    resolveWorkforceScheduleTemplateCreateEditHappyPathInitialTemplateName(),
    resolveWorkforceScheduleTemplateCreateEditHappyPathEditedTemplateName(),
  ];

  const templates = await db.scheduleTemplate.findMany({
    where: {
      templateName: { in: templateNames },
    },
    select: { id: true },
  });
  const templateIds = templates.map((template) => template.id);

  if (templateIds.length === 0) {
    return {
      deletedAssignments: 0,
      deletedSchedules: 0,
      deletedTemplates: 0,
    };
  }

  const assignments = await db.scheduleTemplateAssignment.findMany({
    where: { templateId: { in: templateIds } },
    select: { id: true },
  });
  const assignmentIds = assignments.map((assignment) => assignment.id);

  const deletedSchedules =
    assignmentIds.length > 0
      ? (
          await db.workerSchedule.deleteMany({
            where: { templateAssignmentId: { in: assignmentIds } },
          })
        ).count
      : 0;

  const deletedAssignments =
    assignmentIds.length > 0
      ? (
          await db.scheduleTemplateAssignment.deleteMany({
            where: { id: { in: assignmentIds } },
          })
        ).count
      : 0;

  const deletedTemplates = (
    await db.scheduleTemplate.deleteMany({
      where: { id: { in: templateIds } },
    })
  ).count;

  return {
    deletedAssignments,
    deletedSchedules,
    deletedTemplates,
  };
}

export async function resetWorkforceScheduleTemplateCreateEditHappyPathState() {
  const deleted =
    await deleteWorkforceScheduleTemplateCreateEditHappyPathArtifacts();
  const manager = await resolveScenarioManager(
    resolveWorkforceScheduleTemplateCreateEditHappyPathManagerEmail(),
  );

  return {
    deleted,
    manager,
  };
}

export async function resolveWorkforceScheduleTemplateCreateEditHappyPathScenarioContext(): Promise<
  WorkforceScheduleTemplateCreateEditHappyPathScenarioContext
> {
  const manager = await resolveScenarioManager(
    resolveWorkforceScheduleTemplateCreateEditHappyPathManagerEmail(),
  );

  return {
    editedTemplateName:
      resolveWorkforceScheduleTemplateCreateEditHappyPathEditedTemplateName(),
    editedTimeWindowLabel: formatTimeWindowLabel(
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_START_MINUTE,
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_EDITED_END_MINUTE,
    ),
    effectiveFromInput: formatDateInput(
      resolveWorkforceScheduleTemplateCreateEditHappyPathEffectiveFrom(),
    ),
    initialTemplateName:
      resolveWorkforceScheduleTemplateCreateEditHappyPathInitialTemplateName(),
    initialTimeWindowLabel: formatTimeWindowLabel(
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_START_MINUTE,
      WORKFORCE_SCHEDULE_TEMPLATE_CREATE_EDIT_HAPPY_PATH_INITIAL_END_MINUTE,
    ),
    manager,
    route: "/store/workforce/schedule-templates",
  };
}

async function main() {
  const { deleted, manager } =
    await resetWorkforceScheduleTemplateCreateEditHappyPathState();
  const scenario =
    await resolveWorkforceScheduleTemplateCreateEditHappyPathScenarioContext();

  console.log(
    [
      "Workforce schedule template create/edit happy path setup is ready.",
      `Manager: ${manager.email ?? `user#${manager.id}`} [userId=${manager.id}]`,
      `Route: ${scenario.route}`,
      `Initial template name: ${scenario.initialTemplateName}`,
      `Edited template name: ${scenario.editedTemplateName}`,
      `Effective from: ${scenario.effectiveFromInput}`,
      `Initial time window: ${scenario.initialTimeWindowLabel}`,
      `Edited time window: ${scenario.editedTimeWindowLabel}`,
      `Deleted previous tagged templates: ${deleted.deletedTemplates}`,
      `Deleted previous tagged assignments: ${deleted.deletedAssignments}`,
      `Deleted previous tagged schedules: ${deleted.deletedSchedules}`,
      "Next manual QA steps:",
      "1. Open /store/workforce/schedule-templates as STORE_MANAGER.",
      "2. Create the printed initial template with one Monday cashier day.",
      "3. Edit the same template into the printed employee-scoped Tuesday and Thursday pattern.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown workforce schedule template create/edit setup error.",
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
