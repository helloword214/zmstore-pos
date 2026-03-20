import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EmployeeRole,
  UserAuthState,
  UserRole,
  WorkerScheduleAssignmentStatus,
  WorkerScheduleRole,
  WorkerScheduleTemplateDayOfWeek,
  WorkerScheduleTemplateStatus,
} from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";

export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_EMAIL =
  "qa.workforce.schedule.publish.visibility.cashier@local";
export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_PHONE =
  "09991234016";
export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_FIRST_NAME =
  "QA Workforce";
export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_LAST_NAME =
  "Planner";
export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_ALIAS =
  "SCHED-PUBLISH";
export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_TEMPLATE_NAME =
  "QA Workforce Schedule Publish Visibility Template";
export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DAY_NOTE =
  "QA workforce publish visibility day note";
export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_START_MINUTE =
  8 * 60;
export const WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_END_MINUTE =
  17 * 60;

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
  assignmentId: number;
  employeeId: number;
  templateId: number;
  userId: number;
};

type ScenarioContext = {
  defaultBranch: ReferenceOption;
  employeeLabel: string;
  email: string;
  firstName: string;
  fullName: string;
  lastName: string;
  manager: ManagerUser;
  phone: string;
  plannerRoute: string;
  rangeEndInput: string;
  rangeStartInput: string;
  targetDateInput: string;
  targetDateLabel: string;
  templateName: string;
  timeWindowLabel: string;
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

function startOfNextWeek(reference: Date) {
  const current = toDateOnly(reference);
  const day = current.getDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  return addDays(current, daysUntilMonday);
}

function formatDateInput(value: Date | string) {
  const date = toDateOnly(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: Date | string) {
  return toDateOnly(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function minuteToTimeLabel(value: number) {
  const hour = String(Math.floor(value / 60)).padStart(2, "0");
  const minute = String(value % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatWorkerLabel(args: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  return `${args.firstName} ${args.lastName}`.trim() +
    (args.alias ? ` (${args.alias})` : "");
}

export function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_EMAIL ??
      WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_EMAIL,
  );
}

export function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathPhone() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_PHONE ??
    WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_PHONE
  ).trim();
}

export function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathFirstName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_FIRST_NAME ??
    WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_FIRST_NAME
  ).trim();
}

export function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathLastName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_LAST_NAME ??
    WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_LAST_NAME
  ).trim();
}

export function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathAlias() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_ALIAS ??
    WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DEFAULT_ALIAS
  ).trim();
}

export function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathTemplateName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_TEMPLATE_NAME ??
    WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_TEMPLATE_NAME
  ).trim();
}

export function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathRange(
  now: Date,
) {
  const rangeStart = startOfNextWeek(now);
  return {
    rangeEnd: addDays(rangeStart, 6),
    rangeStart,
    targetDate: rangeStart,
  };
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
      `Workforce schedule planner publish visibility happy path requires an active STORE_MANAGER account: ${email}`,
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
      "Workforce schedule planner publish visibility happy path requires at least one branch.",
    );
  }

  return branch;
}

export async function deleteWorkforceSchedulePlannerPublishVisibilityHappyPathArtifacts(): Promise<
  DeleteSummary
> {
  const email = resolveWorkforceSchedulePlannerPublishVisibilityHappyPathEmail();
  const phone = resolveWorkforceSchedulePlannerPublishVisibilityHappyPathPhone();
  const templateName =
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathTemplateName();

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
      ? await db.workerSchedule.deleteMany({
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
      : { count: 0 };

  const deletedAssignments =
    assignmentIds.length > 0
      ? await db.scheduleTemplateAssignment.deleteMany({
          where: { id: { in: assignmentIds } },
        })
      : { count: 0 };

  const deletedTemplates =
    templateIds.length > 0
      ? await db.scheduleTemplate.deleteMany({
          where: { id: { in: templateIds } },
        })
      : { count: 0 };

  const deletedUsers = await db.user.deleteMany({
    where: { email },
  });

  const deletedEmployees =
    employeeIds.length > 0
      ? await db.employee.deleteMany({
          where: { id: { in: employeeIds } },
        })
      : { count: 0 };

  return {
    deletedAssignments: deletedAssignments.count,
    deletedEmployees: deletedEmployees.count,
    deletedSchedules: deletedSchedules.count,
    deletedTemplates: deletedTemplates.count,
    deletedUsers: deletedUsers.count,
  };
}

async function seedWorkforceSchedulePlannerPublishVisibilityHappyPathState(
  manager: ManagerUser,
): Promise<SeedSummary> {
  const defaultBranch = await resolveDefaultBranch();
  const email = resolveWorkforceSchedulePlannerPublishVisibilityHappyPathEmail();
  const phone = resolveWorkforceSchedulePlannerPublishVisibilityHappyPathPhone();
  const firstName =
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathFirstName();
  const lastName =
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathLastName();
  const alias = resolveWorkforceSchedulePlannerPublishVisibilityHappyPathAlias();
  const templateName =
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathTemplateName();
  const { rangeStart } =
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathRange(new Date());

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
        passwordHash: "qa-workforce-schedule-password-hash",
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
        branchId: defaultBranch.id,
        role: WorkerScheduleRole.CASHIER,
        effectiveFrom: rangeStart,
        effectiveTo: null,
        status: WorkerScheduleTemplateStatus.ACTIVE,
        createdById: manager.id,
        updatedById: manager.id,
        days: {
          create: {
            dayOfWeek: WorkerScheduleTemplateDayOfWeek.MONDAY,
            startMinute:
              WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_START_MINUTE,
            endMinute:
              WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_END_MINUTE,
            note: WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_DAY_NOTE,
          },
        },
      },
      select: { id: true },
    });

    const assignment = await tx.scheduleTemplateAssignment.create({
      data: {
        templateId: template.id,
        workerId: employee.id,
        effectiveFrom: rangeStart,
        effectiveTo: null,
        status: WorkerScheduleAssignmentStatus.ACTIVE,
        createdById: manager.id,
        updatedById: manager.id,
      },
      select: { id: true },
    });

    return {
      assignmentId: assignment.id,
      employeeId: employee.id,
      templateId: template.id,
      userId: user.id,
    };
  });
}

export async function resetWorkforceSchedulePlannerPublishVisibilityHappyPathState() {
  const deleted =
    await deleteWorkforceSchedulePlannerPublishVisibilityHappyPathArtifacts();
  const manager = await resolveScenarioManager(
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathManagerEmail(),
  );
  const seeded =
    await seedWorkforceSchedulePlannerPublishVisibilityHappyPathState(manager);

  return { deleted, manager, seeded };
}

export async function resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext(): Promise<
  ScenarioContext
> {
  const [defaultBranch, manager] = await Promise.all([
    resolveDefaultBranch(),
    resolveScenarioManager(
      resolveWorkforceSchedulePlannerPublishVisibilityHappyPathManagerEmail(),
    ),
  ]);
  const { rangeStart, rangeEnd, targetDate } =
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathRange(new Date());
  const firstName =
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathFirstName();
  const lastName =
    resolveWorkforceSchedulePlannerPublishVisibilityHappyPathLastName();
  const alias = resolveWorkforceSchedulePlannerPublishVisibilityHappyPathAlias();

  return {
    defaultBranch,
    employeeLabel: formatWorkerLabel({ firstName, lastName, alias }),
    email: resolveWorkforceSchedulePlannerPublishVisibilityHappyPathEmail(),
    firstName,
    fullName: `${firstName} ${lastName}`.trim(),
    lastName,
    manager,
    phone: resolveWorkforceSchedulePlannerPublishVisibilityHappyPathPhone(),
    plannerRoute: "/store/workforce/schedule-planner",
    rangeEndInput: formatDateInput(rangeEnd),
    rangeStartInput: formatDateInput(rangeStart),
    targetDateInput: formatDateInput(targetDate),
    targetDateLabel: formatDateLabel(targetDate),
    templateName:
      resolveWorkforceSchedulePlannerPublishVisibilityHappyPathTemplateName(),
    timeWindowLabel:
      `${minuteToTimeLabel(
        WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_START_MINUTE,
      )} - ${minuteToTimeLabel(
        WORKFORCE_SCHEDULE_PLANNER_PUBLISH_VISIBILITY_HAPPY_PATH_END_MINUTE,
      )}`,
  };
}

async function main() {
  const { deleted, manager, seeded } =
    await resetWorkforceSchedulePlannerPublishVisibilityHappyPathState();
  const scenario =
    await resolveWorkforceSchedulePlannerPublishVisibilityHappyPathScenarioContext();

  console.log(
    [
      "Workforce schedule planner publish visibility happy path setup is ready.",
      `Manager: ${manager.email ?? `user#${manager.id}`} [userId=${manager.id}]`,
      `Planner route: ${scenario.plannerRoute}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      `Tagged worker: ${scenario.employeeLabel} [employeeId=${seeded.employeeId}]`,
      `Tagged worker email: ${scenario.email}`,
      `Tagged worker phone: ${scenario.phone}`,
      `Seeded userId: ${seeded.userId}`,
      `Template: ${scenario.templateName} [templateId=${seeded.templateId}]`,
      `Assignment id: ${seeded.assignmentId}`,
      `Range: ${scenario.rangeStartInput} to ${scenario.rangeEndInput}`,
      `Target date: ${scenario.targetDateInput} (${scenario.targetDateLabel})`,
      `Expected schedule window: ${scenario.timeWindowLabel}`,
      `Deleted previous tagged users: ${deleted.deletedUsers}`,
      `Deleted previous tagged employees: ${deleted.deletedEmployees}`,
      `Deleted previous tagged templates: ${deleted.deletedTemplates}`,
      `Deleted previous tagged assignments: ${deleted.deletedAssignments}`,
      `Deleted previous tagged schedules: ${deleted.deletedSchedules}`,
      "Next manual QA steps:",
      "1. Open /store/workforce/schedule-planner as STORE_MANAGER.",
      `2. Load range ${scenario.rangeStartInput} to ${scenario.rangeEndInput}.`,
      "3. Click Generate Draft Rows, then Publish Draft Rows.",
      `4. Confirm ${scenario.employeeLabel} appears as DRAFT then PUBLISHED.`,
      `5. Open /store/workforce/attendance-review?date=${scenario.targetDateInput} and confirm the same worker and time window are visible.`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown workforce schedule planner QA setup error.",
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
