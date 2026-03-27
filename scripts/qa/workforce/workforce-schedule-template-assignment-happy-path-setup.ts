import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EmployeeRole,
  UserAuthState,
  UserRole,
  WorkerScheduleRole,
  WorkerScheduleTemplateDayOfWeek,
  WorkerScheduleTemplateStatus,
} from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";

export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_EMAIL =
  "qa.workforce.schedule.assignment.cashier@local";
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_PHONE =
  "09991234017";
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_FIRST_NAME =
  "QA Workforce";
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_LAST_NAME =
  "Assignment";
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_ALIAS =
  "SCHED-ASSIGN";
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_TEMPLATE_NAME =
  "QA Workforce Template Assignment Happy Path";
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_ROLE =
  WorkerScheduleRole.CASHIER;
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_DAY =
  WorkerScheduleTemplateDayOfWeek.MONDAY;
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_START_MINUTE =
  8 * 60;
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_END_MINUTE =
  17 * 60;
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_DAY_NOTE =
  "QA schedule template assignment day note";
export const WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_EFFECTIVE_FROM_OFFSET_DAYS =
  1;

type ManagerUser = {
  id: number;
  email: string | null;
  role: UserRole;
  active: boolean;
};

type ReferenceOption = {
  id: number;
  name: string;
};

type DeleteSummary = {
  deletedAssignments: number;
  deletedEmployees: number;
  deletedSchedules: number;
  deletedTemplates: number;
  deletedUsers: number;
};

type SeedSummary = {
  employeeId: number;
  templateId: number;
  userId: number;
};

export type WorkforceScheduleTemplateAssignmentHappyPathScenarioContext = {
  assignmentEffectiveFromInput: string;
  defaultBranch: ReferenceOption;
  manager: ManagerUser;
  route: string;
  templateId: number;
  templateName: string;
  workerEmail: string;
  workerLabel: string;
  workerPhone: string;
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

function formatWorkerLabel(args: {
  alias: string | null;
  firstName: string;
  lastName: string;
}) {
  return `${args.firstName} ${args.lastName}`.trim() +
    (args.alias ? ` (${args.alias})` : "");
}

export function resolveWorkforceScheduleTemplateAssignmentHappyPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveWorkforceScheduleTemplateAssignmentHappyPathEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_EMAIL ??
      WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_EMAIL,
  );
}

export function resolveWorkforceScheduleTemplateAssignmentHappyPathPhone() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_PHONE ??
    WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_PHONE
  ).trim();
}

export function resolveWorkforceScheduleTemplateAssignmentHappyPathFirstName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_FIRST_NAME ??
    WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_FIRST_NAME
  ).trim();
}

export function resolveWorkforceScheduleTemplateAssignmentHappyPathLastName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_LAST_NAME ??
    WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_LAST_NAME
  ).trim();
}

export function resolveWorkforceScheduleTemplateAssignmentHappyPathAlias() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_ALIAS ??
    WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_ALIAS
  ).trim();
}

export function resolveWorkforceScheduleTemplateAssignmentHappyPathTemplateName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_TEMPLATE_NAME ??
    WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_TEMPLATE_NAME
  ).trim();
}

export function resolveWorkforceScheduleTemplateAssignmentHappyPathEffectiveFrom() {
  return addDays(
    toDateOnly(new Date()),
    WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_EFFECTIVE_FROM_OFFSET_DAYS,
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

  if (!manager || !manager.active || manager.role !== UserRole.STORE_MANAGER) {
    throw new Error(
      `Workforce schedule template assignment happy path requires an active STORE_MANAGER account: ${email}`,
    );
  }

  return manager;
}

async function resolveDefaultBranch() {
  const branch = await db.branch.findFirst({
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });

  if (!branch) {
    throw new Error(
      "Workforce schedule template assignment happy path requires at least one branch.",
    );
  }

  return branch;
}

export async function deleteWorkforceScheduleTemplateAssignmentHappyPathArtifacts(): Promise<
  DeleteSummary
> {
  const email = resolveWorkforceScheduleTemplateAssignmentHappyPathEmail();
  const phone = resolveWorkforceScheduleTemplateAssignmentHappyPathPhone();
  const templateName =
    resolveWorkforceScheduleTemplateAssignmentHappyPathTemplateName();

  const employees = await db.employee.findMany({
    where: {
      OR: [{ email }, { phone }],
    },
    select: { id: true },
  });
  const employeeIds = employees.map((employee) => employee.id);

  const templates = await db.scheduleTemplate.findMany({
    where: { templateName },
    select: { id: true },
  });
  const templateIds = templates.map((template) => template.id);

  let assignmentIds: number[] = [];
  if (employeeIds.length > 0 || templateIds.length > 0) {
    const assignments = await db.scheduleTemplateAssignment.findMany({
      where:
        employeeIds.length > 0 && templateIds.length > 0
          ? {
              OR: [
                { workerId: { in: employeeIds } },
                { templateId: { in: templateIds } },
              ],
            }
          : employeeIds.length > 0
            ? { workerId: { in: employeeIds } }
            : { templateId: { in: templateIds } },
      select: { id: true },
    });
    assignmentIds = assignments.map((assignment) => assignment.id);
  }

  const deletedSchedules =
    employeeIds.length > 0 || assignmentIds.length > 0
      ? (
          await db.workerSchedule.deleteMany({
            where:
              employeeIds.length > 0 && assignmentIds.length > 0
                ? {
                    OR: [
                      { workerId: { in: employeeIds } },
                      { templateAssignmentId: { in: assignmentIds } },
                    ],
                  }
                : employeeIds.length > 0
                  ? { workerId: { in: employeeIds } }
                  : { templateAssignmentId: { in: assignmentIds } },
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

  const deletedTemplates =
    templateIds.length > 0
      ? (
          await db.scheduleTemplate.deleteMany({
            where: { id: { in: templateIds } },
          })
        ).count
      : 0;

  const deletedUsers = (await db.user.deleteMany({
    where: { email },
  })).count;

  const deletedEmployees =
    employeeIds.length > 0
      ? (
          await db.employee.deleteMany({
            where: { id: { in: employeeIds } },
          })
        ).count
      : 0;

  return {
    deletedAssignments,
    deletedEmployees,
    deletedSchedules,
    deletedTemplates,
    deletedUsers,
  };
}

async function seedWorkforceScheduleTemplateAssignmentHappyPathState(
  manager: ManagerUser,
): Promise<SeedSummary> {
  const defaultBranch = await resolveDefaultBranch();
  const email = resolveWorkforceScheduleTemplateAssignmentHappyPathEmail();
  const phone = resolveWorkforceScheduleTemplateAssignmentHappyPathPhone();
  const firstName =
    resolveWorkforceScheduleTemplateAssignmentHappyPathFirstName();
  const lastName =
    resolveWorkforceScheduleTemplateAssignmentHappyPathLastName();
  const alias = resolveWorkforceScheduleTemplateAssignmentHappyPathAlias();
  const templateName =
    resolveWorkforceScheduleTemplateAssignmentHappyPathTemplateName();
  const effectiveFrom =
    resolveWorkforceScheduleTemplateAssignmentHappyPathEffectiveFrom();

  return db.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        firstName,
        lastName,
        alias,
        phone,
        email,
        role: EmployeeRole.STAFF,
        active: true,
      },
      select: { id: true },
    });

    const user = await tx.user.create({
      data: {
        email,
        role: UserRole.CASHIER,
        managerKind: null,
        employeeId: employee.id,
        active: true,
        authState: UserAuthState.ACTIVE,
        passwordHash: "qa-workforce-schedule-assignment-password-hash",
        pinHash: null,
        branches: {
          create: {
            branchId: defaultBranch.id,
          },
        },
      },
      select: { id: true },
    });

    const template = await tx.scheduleTemplate.create({
      data: {
        templateName,
        branchId: null,
        role: WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_ROLE,
        effectiveFrom,
        effectiveTo: null,
        status: WorkerScheduleTemplateStatus.ACTIVE,
        createdById: manager.id,
        updatedById: manager.id,
        days: {
          create: {
            dayOfWeek: WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_DAY,
            startMinute:
              WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_START_MINUTE,
            endMinute:
              WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_END_MINUTE,
            note: WORKFORCE_SCHEDULE_TEMPLATE_ASSIGNMENT_HAPPY_PATH_DAY_NOTE,
          },
        },
      },
      select: { id: true },
    });

    return {
      employeeId: employee.id,
      templateId: template.id,
      userId: user.id,
    };
  });
}

export async function resetWorkforceScheduleTemplateAssignmentHappyPathState() {
  const deleted =
    await deleteWorkforceScheduleTemplateAssignmentHappyPathArtifacts();
  const manager = await resolveScenarioManager(
    resolveWorkforceScheduleTemplateAssignmentHappyPathManagerEmail(),
  );
  const seeded =
    await seedWorkforceScheduleTemplateAssignmentHappyPathState(manager);

  return { deleted, manager, seeded };
}

export async function resolveWorkforceScheduleTemplateAssignmentHappyPathScenarioContext(): Promise<
  WorkforceScheduleTemplateAssignmentHappyPathScenarioContext
> {
  const [defaultBranch, manager] = await Promise.all([
    resolveDefaultBranch(),
    resolveScenarioManager(
      resolveWorkforceScheduleTemplateAssignmentHappyPathManagerEmail(),
    ),
  ]);
  const workerEmail = resolveWorkforceScheduleTemplateAssignmentHappyPathEmail();
  const templateName =
    resolveWorkforceScheduleTemplateAssignmentHappyPathTemplateName();
  const firstName =
    resolveWorkforceScheduleTemplateAssignmentHappyPathFirstName();
  const lastName =
    resolveWorkforceScheduleTemplateAssignmentHappyPathLastName();
  const alias = resolveWorkforceScheduleTemplateAssignmentHappyPathAlias();

  const template = await db.scheduleTemplate.findFirst({
    where: { templateName },
    select: { id: true },
  });

  if (!template) {
    throw new Error(
      "Workforce schedule template assignment happy path requires the tagged template to exist. Run the setup first.",
    );
  }

  return {
    assignmentEffectiveFromInput: formatDateInput(
      resolveWorkforceScheduleTemplateAssignmentHappyPathEffectiveFrom(),
    ),
    defaultBranch,
    manager,
    route: `/store/workforce/schedule-templates?templateId=${template.id}`,
    templateId: template.id,
    templateName,
    workerEmail,
    workerLabel: formatWorkerLabel({ firstName, lastName, alias }),
    workerPhone: resolveWorkforceScheduleTemplateAssignmentHappyPathPhone(),
  };
}

async function main() {
  const { deleted, manager, seeded } =
    await resetWorkforceScheduleTemplateAssignmentHappyPathState();
  const scenario =
    await resolveWorkforceScheduleTemplateAssignmentHappyPathScenarioContext();

  console.log(
    [
      "Workforce schedule template assignment happy path setup is ready.",
      `Manager: ${manager.email ?? `user#${manager.id}`} [userId=${manager.id}]`,
      `Route: ${scenario.route}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      `Tagged worker: ${scenario.workerLabel} [employeeId=${seeded.employeeId}]`,
      `Tagged worker email: ${scenario.workerEmail}`,
      `Tagged worker phone: ${scenario.workerPhone}`,
      `Seeded userId: ${seeded.userId}`,
      `Template: ${scenario.templateName} [templateId=${seeded.templateId}]`,
      `Assignment effective from: ${scenario.assignmentEffectiveFromInput}`,
      `Deleted previous tagged users: ${deleted.deletedUsers}`,
      `Deleted previous tagged employees: ${deleted.deletedEmployees}`,
      `Deleted previous tagged templates: ${deleted.deletedTemplates}`,
      `Deleted previous tagged assignments: ${deleted.deletedAssignments}`,
      `Deleted previous tagged schedules: ${deleted.deletedSchedules}`,
      "Next manual QA steps:",
      "1. Open the printed route as STORE_MANAGER.",
      "2. Select the tagged worker in the assignment form.",
      "3. Submit Assign selected workers and confirm the assignment row appears.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown workforce schedule template assignment setup error.",
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
