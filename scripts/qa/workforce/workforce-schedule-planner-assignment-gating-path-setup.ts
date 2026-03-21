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

export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_EMAIL =
  "qa.workforce.schedule.planner.active.cashier@local";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_PHONE =
  "09991234019";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_FIRST_NAME =
  "QA Workforce";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_LAST_NAME =
  "PlannerActive";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_ALIAS =
  "SCHED-PLANNER-ACTIVE";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_EMAIL =
  "qa.workforce.schedule.planner.ended.cashier@local";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_PHONE =
  "09991234020";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_FIRST_NAME =
  "QA Workforce";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_LAST_NAME =
  "PlannerEnded";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_ALIAS =
  "SCHED-PLANNER-ENDED";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_TEMPLATE_NAME =
  "QA Workforce Planner Assignment Gating Template";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_DAY_NOTE =
  "QA planner assignment gating day note";
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_START_MINUTE =
  8 * 60;
export const WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_END_MINUTE =
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
  activeAssignmentId: number;
  activeEmployeeId: number;
  activeUserId: number;
  endedAssignmentId: number;
  endedEmployeeId: number;
  endedUserId: number;
  templateId: number;
};

export type WorkforceSchedulePlannerAssignmentGatingPathScenarioContext = {
  activeWorkerEmail: string;
  activeWorkerLabel: string;
  activeWorkerPhone: string;
  defaultBranch: ReferenceOption;
  endedWorkerEmail: string;
  endedWorkerLabel: string;
  endedWorkerPhone: string;
  manager: ManagerUser;
  plannerRoute: string;
  rangeEndInput: string;
  rangeStartInput: string;
  targetDateInput: string;
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

function minuteToTimeLabel(value: number) {
  const hour = String(Math.floor(value / 60)).padStart(2, "0");
  const minute = String(value % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatWorkerLabel(args: {
  alias: string | null;
  firstName: string;
  lastName: string;
}) {
  return `${args.firstName} ${args.lastName}`.trim() +
    (args.alias ? ` (${args.alias})` : "");
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathActiveEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_EMAIL ??
      WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_EMAIL,
  );
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathActivePhone() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_PHONE ??
    WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_PHONE
  ).trim();
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathActiveFirstName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_FIRST_NAME ??
    WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_FIRST_NAME
  ).trim();
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathActiveLastName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_LAST_NAME ??
    WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_LAST_NAME
  ).trim();
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathActiveAlias() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_ALIAS ??
    WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ACTIVE_ALIAS
  ).trim();
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathEndedEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_EMAIL ??
      WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_EMAIL,
  );
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathEndedPhone() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_PHONE ??
    WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_PHONE
  ).trim();
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathEndedFirstName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_FIRST_NAME ??
    WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_FIRST_NAME
  ).trim();
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathEndedLastName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_LAST_NAME ??
    WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_LAST_NAME
  ).trim();
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathEndedAlias() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_ALIAS ??
    WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_ENDED_ALIAS
  ).trim();
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathTemplateName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_TEMPLATE_NAME ??
    WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_TEMPLATE_NAME
  ).trim();
}

export function resolveWorkforceSchedulePlannerAssignmentGatingPathRange(now: Date) {
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
      `Workforce schedule planner assignment gating path requires an active STORE_MANAGER account: ${email}`,
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
      "Workforce schedule planner assignment gating path requires at least one branch.",
    );
  }

  return branch;
}

export async function deleteWorkforceSchedulePlannerAssignmentGatingPathArtifacts(): Promise<
  DeleteSummary
> {
  const activeEmail =
    resolveWorkforceSchedulePlannerAssignmentGatingPathActiveEmail();
  const activePhone =
    resolveWorkforceSchedulePlannerAssignmentGatingPathActivePhone();
  const endedEmail =
    resolveWorkforceSchedulePlannerAssignmentGatingPathEndedEmail();
  const endedPhone =
    resolveWorkforceSchedulePlannerAssignmentGatingPathEndedPhone();
  const templateName =
    resolveWorkforceSchedulePlannerAssignmentGatingPathTemplateName();

  const employees = await db.employee.findMany({
    where: {
      OR: [
        { email: activeEmail },
        { phone: activePhone },
        { email: endedEmail },
        { phone: endedPhone },
      ],
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
    where: {
      email: {
        in: [activeEmail, endedEmail],
      },
    },
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

async function seedWorkforceSchedulePlannerAssignmentGatingPathState(
  manager: ManagerUser,
): Promise<SeedSummary> {
  const defaultBranch = await resolveDefaultBranch();
  const activeEmail =
    resolveWorkforceSchedulePlannerAssignmentGatingPathActiveEmail();
  const activePhone =
    resolveWorkforceSchedulePlannerAssignmentGatingPathActivePhone();
  const activeFirstName =
    resolveWorkforceSchedulePlannerAssignmentGatingPathActiveFirstName();
  const activeLastName =
    resolveWorkforceSchedulePlannerAssignmentGatingPathActiveLastName();
  const activeAlias =
    resolveWorkforceSchedulePlannerAssignmentGatingPathActiveAlias();
  const endedEmail =
    resolveWorkforceSchedulePlannerAssignmentGatingPathEndedEmail();
  const endedPhone =
    resolveWorkforceSchedulePlannerAssignmentGatingPathEndedPhone();
  const endedFirstName =
    resolveWorkforceSchedulePlannerAssignmentGatingPathEndedFirstName();
  const endedLastName =
    resolveWorkforceSchedulePlannerAssignmentGatingPathEndedLastName();
  const endedAlias =
    resolveWorkforceSchedulePlannerAssignmentGatingPathEndedAlias();
  const templateName =
    resolveWorkforceSchedulePlannerAssignmentGatingPathTemplateName();
  const { rangeStart, targetDate } =
    resolveWorkforceSchedulePlannerAssignmentGatingPathRange(new Date());

  return db.$transaction(async (tx) => {
    const activeEmployee = await tx.employee.create({
      data: {
        firstName: activeFirstName,
        lastName: activeLastName,
        alias: activeAlias,
        phone: activePhone,
        email: activeEmail,
        role: EmployeeRole.STAFF,
        active: true,
      },
      select: { id: true },
    });

    const activeUser = await tx.user.create({
      data: {
        email: activeEmail,
        role: UserRole.CASHIER,
        managerKind: null,
        employeeId: activeEmployee.id,
        active: true,
        authState: UserAuthState.ACTIVE,
        passwordHash: "qa-workforce-schedule-planner-gating-active-password-hash",
        pinHash: null,
        branches: {
          create: {
            branchId: defaultBranch.id,
          },
        },
      },
      select: { id: true },
    });

    const endedEmployee = await tx.employee.create({
      data: {
        firstName: endedFirstName,
        lastName: endedLastName,
        alias: endedAlias,
        phone: endedPhone,
        email: endedEmail,
        role: EmployeeRole.STAFF,
        active: true,
      },
      select: { id: true },
    });

    const endedUser = await tx.user.create({
      data: {
        email: endedEmail,
        role: UserRole.CASHIER,
        managerKind: null,
        employeeId: endedEmployee.id,
        active: true,
        authState: UserAuthState.ACTIVE,
        passwordHash: "qa-workforce-schedule-planner-gating-ended-password-hash",
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
              WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_START_MINUTE,
            endMinute:
              WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_END_MINUTE,
            note: WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_DAY_NOTE,
          },
        },
      },
      select: { id: true },
    });

    const activeAssignment = await tx.scheduleTemplateAssignment.create({
      data: {
        templateId: template.id,
        workerId: activeEmployee.id,
        effectiveFrom: rangeStart,
        effectiveTo: null,
        status: WorkerScheduleAssignmentStatus.ACTIVE,
        createdById: manager.id,
        updatedById: manager.id,
      },
      select: { id: true },
    });

    const endedAssignment = await tx.scheduleTemplateAssignment.create({
      data: {
        templateId: template.id,
        workerId: endedEmployee.id,
        effectiveFrom: rangeStart,
        effectiveTo: targetDate,
        status: WorkerScheduleAssignmentStatus.ENDED,
        createdById: manager.id,
        updatedById: manager.id,
      },
      select: { id: true },
    });

    return {
      activeAssignmentId: activeAssignment.id,
      activeEmployeeId: activeEmployee.id,
      activeUserId: activeUser.id,
      endedAssignmentId: endedAssignment.id,
      endedEmployeeId: endedEmployee.id,
      endedUserId: endedUser.id,
      templateId: template.id,
    };
  });
}

export async function resetWorkforceSchedulePlannerAssignmentGatingPathState() {
  const deleted =
    await deleteWorkforceSchedulePlannerAssignmentGatingPathArtifacts();
  const manager = await resolveScenarioManager(
    resolveWorkforceSchedulePlannerAssignmentGatingPathManagerEmail(),
  );
  const seeded =
    await seedWorkforceSchedulePlannerAssignmentGatingPathState(manager);

  return { deleted, manager, seeded };
}

export async function resolveWorkforceSchedulePlannerAssignmentGatingPathScenarioContext(): Promise<
  WorkforceSchedulePlannerAssignmentGatingPathScenarioContext
> {
  const [defaultBranch, manager] = await Promise.all([
    resolveDefaultBranch(),
    resolveScenarioManager(
      resolveWorkforceSchedulePlannerAssignmentGatingPathManagerEmail(),
    ),
  ]);
  const { rangeStart, rangeEnd, targetDate } =
    resolveWorkforceSchedulePlannerAssignmentGatingPathRange(new Date());

  return {
    activeWorkerEmail:
      resolveWorkforceSchedulePlannerAssignmentGatingPathActiveEmail(),
    activeWorkerLabel: formatWorkerLabel({
      firstName:
        resolveWorkforceSchedulePlannerAssignmentGatingPathActiveFirstName(),
      lastName:
        resolveWorkforceSchedulePlannerAssignmentGatingPathActiveLastName(),
      alias: resolveWorkforceSchedulePlannerAssignmentGatingPathActiveAlias(),
    }),
    activeWorkerPhone:
      resolveWorkforceSchedulePlannerAssignmentGatingPathActivePhone(),
    defaultBranch,
    endedWorkerEmail:
      resolveWorkforceSchedulePlannerAssignmentGatingPathEndedEmail(),
    endedWorkerLabel: formatWorkerLabel({
      firstName:
        resolveWorkforceSchedulePlannerAssignmentGatingPathEndedFirstName(),
      lastName:
        resolveWorkforceSchedulePlannerAssignmentGatingPathEndedLastName(),
      alias: resolveWorkforceSchedulePlannerAssignmentGatingPathEndedAlias(),
    }),
    endedWorkerPhone:
      resolveWorkforceSchedulePlannerAssignmentGatingPathEndedPhone(),
    manager,
    plannerRoute: "/store/workforce/schedule-planner",
    rangeEndInput: formatDateInput(rangeEnd),
    rangeStartInput: formatDateInput(rangeStart),
    targetDateInput: formatDateInput(targetDate),
    templateName:
      resolveWorkforceSchedulePlannerAssignmentGatingPathTemplateName(),
    timeWindowLabel:
      `${minuteToTimeLabel(
        WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_START_MINUTE,
      )} - ${minuteToTimeLabel(
        WORKFORCE_SCHEDULE_PLANNER_ASSIGNMENT_GATING_PATH_END_MINUTE,
      )}`,
  };
}

async function main() {
  const { deleted, manager, seeded } =
    await resetWorkforceSchedulePlannerAssignmentGatingPathState();
  const scenario =
    await resolveWorkforceSchedulePlannerAssignmentGatingPathScenarioContext();

  console.log(
    [
      "Workforce schedule planner assignment gating path setup is ready.",
      `Manager: ${manager.email ?? `user#${manager.id}`} [userId=${manager.id}]`,
      `Route: ${scenario.plannerRoute}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      `Range start: ${scenario.rangeStartInput}`,
      `Range end: ${scenario.rangeEndInput}`,
      `Target generation date: ${scenario.targetDateInput}`,
      `Template: ${scenario.templateName} [templateId=${seeded.templateId}]`,
      `Active worker: ${scenario.activeWorkerLabel} [employeeId=${seeded.activeEmployeeId}]`,
      `Active worker email: ${scenario.activeWorkerEmail}`,
      `Active worker phone: ${scenario.activeWorkerPhone}`,
      `Active assignment id: ${seeded.activeAssignmentId}`,
      `Ended worker: ${scenario.endedWorkerLabel} [employeeId=${seeded.endedEmployeeId}]`,
      `Ended worker email: ${scenario.endedWorkerEmail}`,
      `Ended worker phone: ${scenario.endedWorkerPhone}`,
      `Ended assignment id: ${seeded.endedAssignmentId}`,
      `Expected schedule window: ${scenario.timeWindowLabel}`,
      `Deleted previous tagged users: ${deleted.deletedUsers}`,
      `Deleted previous tagged employees: ${deleted.deletedEmployees}`,
      `Deleted previous tagged templates: ${deleted.deletedTemplates}`,
      `Deleted previous tagged assignments: ${deleted.deletedAssignments}`,
      `Deleted previous tagged schedules: ${deleted.deletedSchedules}`,
      "Next manual QA steps:",
      "1. Open the printed planner route as STORE_MANAGER.",
      "2. Load the printed range and click Generate Draft Rows.",
      "3. Confirm only the active tagged worker appears in DRAFT rows.",
      "4. Confirm the ended tagged worker does not appear in planner rows.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown workforce schedule planner assignment gating setup error.",
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
