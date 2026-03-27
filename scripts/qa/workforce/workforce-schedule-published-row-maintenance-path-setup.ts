import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EmployeeRole,
  UserAuthState,
  UserRole,
  WorkerScheduleAssignmentStatus,
  WorkerScheduleEntryType,
  WorkerScheduleRole,
  WorkerScheduleStatus,
  WorkerScheduleTemplateDayOfWeek,
  WorkerScheduleTemplateStatus,
} from "@prisma/client";
import { publishWorkerSchedules } from "~/services/worker-schedule-publication.server";
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";

export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EMAIL =
  "qa.workforce.schedule.published.row.cashier@local";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_PHONE =
  "09991234031";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_FIRST_NAME =
  "QA Workforce";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_LAST_NAME =
  "PublishedRow";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_ALIAS =
  "SCHED-PUB-MAINT";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_TEMPLATE_NAME =
  "QA Workforce Published Row Maintenance Template";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_INITIAL_NOTE =
  "QA seeded published planner row note";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EDIT_NOTE =
  "QA published row edit note";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_CANCELLATION_NOTE =
  "QA cancel published schedule row note";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_DAY_NOTE =
  "QA published row maintenance day note";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_START_MINUTE =
  8 * 60;
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_END_MINUTE =
  17 * 60;
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EDIT_START_TIME =
  "10:00";
export const WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EDIT_END_TIME =
  "18:30";

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
  scheduleId: number;
  templateId: number;
  userId: number;
};

export type WorkforceSchedulePublishedRowMaintenancePathScenarioContext = {
  cancellationNote: string;
  defaultBranch: ReferenceOption;
  editEndTimeInput: string;
  editNote: string;
  editStartTimeInput: string;
  editedTimeWindowLabel: string;
  initialTimeWindowLabel: string;
  manager: ManagerUser;
  plannerRoute: string;
  rangeEndInput: string;
  rangeStartInput: string;
  scheduleId: number;
  targetDateInput: string;
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

function toPrismaDateFieldSafeValue(value: Date | string) {
  const date = toDateOnly(value);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    12,
    0,
    0,
    0,
  );
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
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  const meridiem = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function timeInputToLabel(value: string) {
  const [hourToken, minuteToken] = value.trim().split(":");
  const hour = Number(hourToken);
  const minute = Number(minuteToken);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return value;
  }
  const meridiem = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function combineDateAndMinute(date: Date, minute: number) {
  const combined = new Date(date);
  combined.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return combined;
}

function formatWorkerLabel(args: {
  alias: string | null;
  firstName: string;
  lastName: string;
}) {
  return `${args.firstName} ${args.lastName}`.trim() +
    (args.alias ? ` (${args.alias})` : "");
}

export function resolveWorkforceSchedulePublishedRowMaintenancePathManagerEmail() {
  return normalizeEmail(
    process.env
      .QA_WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveWorkforceSchedulePublishedRowMaintenancePathEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EMAIL ??
      WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EMAIL,
  );
}

export function resolveWorkforceSchedulePublishedRowMaintenancePathPhone() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_PHONE ??
    WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_PHONE
  ).trim();
}

export function resolveWorkforceSchedulePublishedRowMaintenancePathFirstName() {
  return (
    process.env
      .QA_WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_FIRST_NAME ??
    WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_FIRST_NAME
  ).trim();
}

export function resolveWorkforceSchedulePublishedRowMaintenancePathLastName() {
  return (
    process.env
      .QA_WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_LAST_NAME ??
    WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_LAST_NAME
  ).trim();
}

export function resolveWorkforceSchedulePublishedRowMaintenancePathAlias() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_ALIAS ??
    WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_ALIAS
  ).trim();
}

export function resolveWorkforceSchedulePublishedRowMaintenancePathTemplateName() {
  return (
    process.env
      .QA_WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_TEMPLATE_NAME ??
    WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_TEMPLATE_NAME
  ).trim();
}

export function resolveWorkforceSchedulePublishedRowMaintenancePathRange(
  now: Date,
) {
  const rangeStart = startOfNextWeek(now);
  return {
    rangeEnd: addDays(rangeStart, 6),
    rangeStart,
    targetDate: toPrismaDateFieldSafeValue(rangeStart),
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
      `Workforce schedule published row maintenance path requires an active STORE_MANAGER account: ${email}`,
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
      "Workforce schedule published row maintenance path requires at least one branch.",
    );
  }

  return branch;
}

export async function deleteWorkforceSchedulePublishedRowMaintenancePathArtifacts(): Promise<
  DeleteSummary
> {
  const email = resolveWorkforceSchedulePublishedRowMaintenancePathEmail();
  const phone = resolveWorkforceSchedulePublishedRowMaintenancePathPhone();
  const templateName =
    resolveWorkforceSchedulePublishedRowMaintenancePathTemplateName();

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

async function seedWorkforceSchedulePublishedRowMaintenancePathState(
  manager: ManagerUser,
): Promise<SeedSummary> {
  const defaultBranch = await resolveDefaultBranch();
  const email = resolveWorkforceSchedulePublishedRowMaintenancePathEmail();
  const phone = resolveWorkforceSchedulePublishedRowMaintenancePathPhone();
  const firstName =
    resolveWorkforceSchedulePublishedRowMaintenancePathFirstName();
  const lastName = resolveWorkforceSchedulePublishedRowMaintenancePathLastName();
  const alias = resolveWorkforceSchedulePublishedRowMaintenancePathAlias();
  const templateName =
    resolveWorkforceSchedulePublishedRowMaintenancePathTemplateName();
  const { rangeStart, targetDate } =
    resolveWorkforceSchedulePublishedRowMaintenancePathRange(new Date());

  const seeded = await db.$transaction(async (tx) => {
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
        passwordHash:
          "qa-workforce-schedule-published-row-maintenance-password-hash",
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
              WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_START_MINUTE,
            endMinute:
              WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_END_MINUTE,
            note: WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_DAY_NOTE,
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

    const schedule = await tx.workerSchedule.create({
      data: {
        workerId: employee.id,
        role: WorkerScheduleRole.CASHIER,
        branchId: defaultBranch.id,
        scheduleDate: targetDate,
        entryType: WorkerScheduleEntryType.WORK,
        startAt: combineDateAndMinute(
          targetDate,
          WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_START_MINUTE,
        ),
        endAt: combineDateAndMinute(
          targetDate,
          WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_END_MINUTE,
        ),
        templateAssignmentId: assignment.id,
        status: WorkerScheduleStatus.DRAFT,
        note: WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_INITIAL_NOTE,
        createdById: manager.id,
        updatedById: manager.id,
      },
      select: { id: true },
    });

    return {
      assignmentId: assignment.id,
      employeeId: employee.id,
      scheduleId: schedule.id,
      templateId: template.id,
      userId: user.id,
    };
  });

  const published = await publishWorkerSchedules({
    actorUserId: manager.id,
    scheduleIds: [seeded.scheduleId],
  });

  if (published.publishedCount !== 1) {
    throw new Error(
      `Expected exactly one published row for workforce schedule published row maintenance path, received ${published.publishedCount}.`,
    );
  }

  return seeded;
}

export async function resetWorkforceSchedulePublishedRowMaintenancePathState() {
  const deleted =
    await deleteWorkforceSchedulePublishedRowMaintenancePathArtifacts();
  const manager = await resolveScenarioManager(
    resolveWorkforceSchedulePublishedRowMaintenancePathManagerEmail(),
  );
  const seeded =
    await seedWorkforceSchedulePublishedRowMaintenancePathState(manager);

  return { deleted, manager, seeded };
}

export async function resolveWorkforceSchedulePublishedRowMaintenancePathScenarioContext(): Promise<
  WorkforceSchedulePublishedRowMaintenancePathScenarioContext
> {
  const [defaultBranch, manager] = await Promise.all([
    resolveDefaultBranch(),
    resolveScenarioManager(
      resolveWorkforceSchedulePublishedRowMaintenancePathManagerEmail(),
    ),
  ]);
  const { rangeStart, rangeEnd, targetDate } =
    resolveWorkforceSchedulePublishedRowMaintenancePathRange(new Date());
  const templateName =
    resolveWorkforceSchedulePublishedRowMaintenancePathTemplateName();
  const email = resolveWorkforceSchedulePublishedRowMaintenancePathEmail();

  const [template, user] = await Promise.all([
    db.scheduleTemplate.findFirst({
      where: { templateName },
      select: { id: true },
    }),
    db.user.findUnique({
      where: { email },
      select: {
        employee: {
          select: { id: true },
        },
      },
    }),
  ]);

  if (!template) {
    throw new Error(
      "Workforce schedule published row maintenance path requires the tagged template to exist. Run the setup first.",
    );
  }

  const schedule = user?.employee
    ? await db.workerSchedule.findFirst({
        where: {
          workerId: user.employee.id,
          entryType: WorkerScheduleEntryType.WORK,
          scheduleDate: targetDate,
          status: WorkerScheduleStatus.PUBLISHED,
        },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      })
    : null;

  if (!schedule) {
    throw new Error(
      "Workforce schedule published row maintenance path requires the tagged published schedule row to exist. Run the setup first.",
    );
  }

  return {
    cancellationNote:
      WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_CANCELLATION_NOTE,
    defaultBranch,
    editEndTimeInput:
      WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EDIT_END_TIME,
    editNote: WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EDIT_NOTE,
    editStartTimeInput:
      WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EDIT_START_TIME,
    editedTimeWindowLabel:
      `${timeInputToLabel(WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EDIT_START_TIME)} - ${timeInputToLabel(WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_EDIT_END_TIME)}`,
    initialTimeWindowLabel:
      `${minuteToTimeLabel(
        WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_START_MINUTE,
      )} - ${minuteToTimeLabel(
        WORKFORCE_SCHEDULE_PUBLISHED_ROW_MAINTENANCE_PATH_END_MINUTE,
      )}`,
    manager,
    plannerRoute: "/store/workforce/schedule-planner",
    rangeEndInput: formatDateInput(rangeEnd),
    rangeStartInput: formatDateInput(rangeStart),
    scheduleId: schedule.id,
    targetDateInput: formatDateInput(targetDate),
    templateId: template.id,
    templateName,
    workerEmail: email,
    workerLabel: formatWorkerLabel({
      firstName: resolveWorkforceSchedulePublishedRowMaintenancePathFirstName(),
      lastName: resolveWorkforceSchedulePublishedRowMaintenancePathLastName(),
      alias: resolveWorkforceSchedulePublishedRowMaintenancePathAlias(),
    }),
    workerPhone: resolveWorkforceSchedulePublishedRowMaintenancePathPhone(),
  };
}

async function main() {
  const { deleted, manager, seeded } =
    await resetWorkforceSchedulePublishedRowMaintenancePathState();
  const scenario =
    await resolveWorkforceSchedulePublishedRowMaintenancePathScenarioContext();

  console.log(
    [
      "Workforce schedule published row maintenance path setup is ready.",
      `Manager: ${manager.email ?? `user#${manager.id}`} [userId=${manager.id}]`,
      `Route: ${scenario.plannerRoute}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      `Start: ${scenario.rangeStartInput}`,
      `End: ${scenario.rangeEndInput}`,
      `Target date: ${scenario.targetDateInput}`,
      `Template: ${scenario.templateName} [templateId=${seeded.templateId}]`,
      `Tagged worker: ${scenario.workerLabel} [employeeId=${seeded.employeeId}]`,
      `Tagged worker email: ${scenario.workerEmail}`,
      `Tagged worker phone: ${scenario.workerPhone}`,
      `Tagged userId: ${seeded.userId}`,
      `Assignment id: ${seeded.assignmentId}`,
      `Schedule row id: ${seeded.scheduleId}`,
      `Initial window: ${scenario.initialTimeWindowLabel}`,
      `Edited window: ${scenario.editedTimeWindowLabel}`,
      `Edit note: ${scenario.editNote}`,
      `Deleted previous tagged users: ${deleted.deletedUsers}`,
      `Deleted previous tagged employees: ${deleted.deletedEmployees}`,
      `Deleted previous tagged templates: ${deleted.deletedTemplates}`,
      `Deleted previous tagged assignments: ${deleted.deletedAssignments}`,
      `Deleted previous tagged schedules: ${deleted.deletedSchedules}`,
      "Next manual QA steps:",
      "1. Open the printed planner route as STORE_MANAGER.",
      "2. Set the printed Start and End values, click Load, then select the tagged published cell in the board.",
      "3. Save the printed custom time values from the dropdowns and confirm the selected cell stays PUBLISHED.",
      "4. Click Clear to blank and confirm the selected cell returns to BLANK.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown workforce schedule published row maintenance setup error.",
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
