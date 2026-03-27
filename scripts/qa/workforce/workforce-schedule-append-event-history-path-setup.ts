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
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";

export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_EMAIL =
  "qa.workforce.schedule.event.subject.cashier@local";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_PHONE =
  "09991234022";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_FIRST_NAME =
  "QA Workforce";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_LAST_NAME =
  "PlannerEvent";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_ALIAS =
  "SCHED-EVENT-SUBJECT";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_EMAIL =
  "qa.workforce.schedule.event.related.cashier@local";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_PHONE =
  "09991234023";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_FIRST_NAME =
  "QA Workforce";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_LAST_NAME =
  "PlannerRelated";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_ALIAS =
  "SCHED-EVENT-RELATED";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_TEMPLATE_NAME =
  "QA Workforce Planner Append Event History Template";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_INITIAL_NOTE =
  "QA seeded draft planner event row note";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_EVENT_NOTE =
  "QA replacement assignment event note";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_DAY_NOTE =
  "QA append event history day note";
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_START_MINUTE =
  8 * 60;
export const WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_END_MINUTE =
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
  relatedEmployeeId: number;
  relatedUserId: number;
  scheduleId: number;
  subjectAssignmentId: number;
  subjectEmployeeId: number;
  subjectUserId: number;
  templateId: number;
};

export type WorkforceScheduleAppendEventHistoryPathScenarioContext = {
  defaultBranch: ReferenceOption;
  eventNote: string;
  initialTimeWindowLabel: string;
  manager: ManagerUser;
  plannerRoute: string;
  rangeEndInput: string;
  rangeStartInput: string;
  relatedWorkerEmail: string;
  relatedWorkerLabel: string;
  relatedWorkerPhone: string;
  scheduleId: number;
  subjectWorkerEmail: string;
  subjectWorkerLabel: string;
  subjectWorkerPhone: string;
  targetDateInput: string;
  templateId: number;
  templateName: string;
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
  const hour = Math.floor(value / 60);
  const minute = value % 60;
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

export function resolveWorkforceScheduleAppendEventHistoryPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveWorkforceScheduleAppendEventHistoryPathEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_EMAIL ??
      WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_EMAIL,
  );
}

export function resolveWorkforceScheduleAppendEventHistoryPathPhone() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_PHONE ??
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_PHONE
  ).trim();
}

export function resolveWorkforceScheduleAppendEventHistoryPathFirstName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_FIRST_NAME ??
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_FIRST_NAME
  ).trim();
}

export function resolveWorkforceScheduleAppendEventHistoryPathLastName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_LAST_NAME ??
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_LAST_NAME
  ).trim();
}

export function resolveWorkforceScheduleAppendEventHistoryPathAlias() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_ALIAS ??
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_ALIAS
  ).trim();
}

export function resolveWorkforceScheduleAppendEventHistoryPathRelatedEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_EMAIL ??
      WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_EMAIL,
  );
}

export function resolveWorkforceScheduleAppendEventHistoryPathRelatedPhone() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_PHONE ??
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_PHONE
  ).trim();
}

export function resolveWorkforceScheduleAppendEventHistoryPathRelatedFirstName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_FIRST_NAME ??
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_FIRST_NAME
  ).trim();
}

export function resolveWorkforceScheduleAppendEventHistoryPathRelatedLastName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_LAST_NAME ??
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_LAST_NAME
  ).trim();
}

export function resolveWorkforceScheduleAppendEventHistoryPathRelatedAlias() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_ALIAS ??
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_RELATED_ALIAS
  ).trim();
}

export function resolveWorkforceScheduleAppendEventHistoryPathTemplateName() {
  return (
    process.env.QA_WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_TEMPLATE_NAME ??
    WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_TEMPLATE_NAME
  ).trim();
}

export function resolveWorkforceScheduleAppendEventHistoryPathRange(now: Date) {
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
      `Workforce schedule append event history path requires an active STORE_MANAGER account: ${email}`,
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
      "Workforce schedule append event history path requires at least one branch.",
    );
  }

  return branch;
}

export async function deleteWorkforceScheduleAppendEventHistoryPathArtifacts(): Promise<
  DeleteSummary
> {
  const subjectEmail = resolveWorkforceScheduleAppendEventHistoryPathEmail();
  const subjectPhone = resolveWorkforceScheduleAppendEventHistoryPathPhone();
  const relatedEmail =
    resolveWorkforceScheduleAppendEventHistoryPathRelatedEmail();
  const relatedPhone =
    resolveWorkforceScheduleAppendEventHistoryPathRelatedPhone();
  const templateName =
    resolveWorkforceScheduleAppendEventHistoryPathTemplateName();

  const employees = await db.employee.findMany({
    where: {
      OR: [
        { email: subjectEmail },
        { phone: subjectPhone },
        { email: relatedEmail },
        { phone: relatedPhone },
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
        in: [subjectEmail, relatedEmail],
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

async function seedWorkforceScheduleAppendEventHistoryPathState(
  manager: ManagerUser,
): Promise<SeedSummary> {
  const defaultBranch = await resolveDefaultBranch();
  const subjectEmail = resolveWorkforceScheduleAppendEventHistoryPathEmail();
  const subjectPhone = resolveWorkforceScheduleAppendEventHistoryPathPhone();
  const subjectFirstName =
    resolveWorkforceScheduleAppendEventHistoryPathFirstName();
  const subjectLastName =
    resolveWorkforceScheduleAppendEventHistoryPathLastName();
  const subjectAlias = resolveWorkforceScheduleAppendEventHistoryPathAlias();
  const relatedEmail =
    resolveWorkforceScheduleAppendEventHistoryPathRelatedEmail();
  const relatedPhone =
    resolveWorkforceScheduleAppendEventHistoryPathRelatedPhone();
  const relatedFirstName =
    resolveWorkforceScheduleAppendEventHistoryPathRelatedFirstName();
  const relatedLastName =
    resolveWorkforceScheduleAppendEventHistoryPathRelatedLastName();
  const relatedAlias =
    resolveWorkforceScheduleAppendEventHistoryPathRelatedAlias();
  const templateName =
    resolveWorkforceScheduleAppendEventHistoryPathTemplateName();
  const { rangeStart, targetDate } =
    resolveWorkforceScheduleAppendEventHistoryPathRange(new Date());

  return db.$transaction(async (tx) => {
    const subjectEmployee = await tx.employee.create({
      data: {
        firstName: subjectFirstName,
        lastName: subjectLastName,
        alias: subjectAlias,
        phone: subjectPhone,
        email: subjectEmail,
        role: EmployeeRole.STAFF,
        active: true,
      },
      select: { id: true },
    });

    const subjectUser = await tx.user.create({
      data: {
        email: subjectEmail,
        role: UserRole.CASHIER,
        managerKind: null,
        employeeId: subjectEmployee.id,
        active: true,
        authState: UserAuthState.ACTIVE,
        passwordHash: "qa-workforce-schedule-append-event-subject-password-hash",
        pinHash: null,
        branches: {
          create: {
            branchId: defaultBranch.id,
          },
        },
      },
      select: { id: true },
    });

    const relatedEmployee = await tx.employee.create({
      data: {
        firstName: relatedFirstName,
        lastName: relatedLastName,
        alias: relatedAlias,
        phone: relatedPhone,
        email: relatedEmail,
        role: EmployeeRole.STAFF,
        active: true,
      },
      select: { id: true },
    });

    const relatedUser = await tx.user.create({
      data: {
        email: relatedEmail,
        role: UserRole.CASHIER,
        managerKind: null,
        employeeId: relatedEmployee.id,
        active: true,
        authState: UserAuthState.ACTIVE,
        passwordHash: "qa-workforce-schedule-append-event-related-password-hash",
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
              WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_START_MINUTE,
            endMinute:
              WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_END_MINUTE,
            note: WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_DAY_NOTE,
          },
        },
      },
      select: { id: true },
    });

    const assignment = await tx.scheduleTemplateAssignment.create({
      data: {
        templateId: template.id,
        workerId: subjectEmployee.id,
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
        workerId: subjectEmployee.id,
        role: WorkerScheduleRole.CASHIER,
        branchId: defaultBranch.id,
        scheduleDate: targetDate,
        entryType: WorkerScheduleEntryType.WORK,
        startAt: combineDateAndMinute(
          targetDate,
          WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_START_MINUTE,
        ),
        endAt: combineDateAndMinute(
          targetDate,
          WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_END_MINUTE,
        ),
        templateAssignmentId: assignment.id,
        status: WorkerScheduleStatus.DRAFT,
        note: WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_INITIAL_NOTE,
        createdById: manager.id,
        updatedById: manager.id,
      },
      select: { id: true },
    });

    return {
      relatedEmployeeId: relatedEmployee.id,
      relatedUserId: relatedUser.id,
      scheduleId: schedule.id,
      subjectAssignmentId: assignment.id,
      subjectEmployeeId: subjectEmployee.id,
      subjectUserId: subjectUser.id,
      templateId: template.id,
    };
  });
}

export async function resetWorkforceScheduleAppendEventHistoryPathState() {
  const deleted =
    await deleteWorkforceScheduleAppendEventHistoryPathArtifacts();
  const manager = await resolveScenarioManager(
    resolveWorkforceScheduleAppendEventHistoryPathManagerEmail(),
  );
  const seeded =
    await seedWorkforceScheduleAppendEventHistoryPathState(manager);

  return { deleted, manager, seeded };
}

export async function resolveWorkforceScheduleAppendEventHistoryPathScenarioContext(): Promise<
  WorkforceScheduleAppendEventHistoryPathScenarioContext
> {
  const [defaultBranch, manager] = await Promise.all([
    resolveDefaultBranch(),
    resolveScenarioManager(
      resolveWorkforceScheduleAppendEventHistoryPathManagerEmail(),
    ),
  ]);
  const { rangeStart, rangeEnd, targetDate } =
    resolveWorkforceScheduleAppendEventHistoryPathRange(new Date());
  const templateName =
    resolveWorkforceScheduleAppendEventHistoryPathTemplateName();
  const subjectWorkerEmail =
    resolveWorkforceScheduleAppendEventHistoryPathEmail();

  const [template, subjectUser] = await Promise.all([
    db.scheduleTemplate.findFirst({
      where: { templateName },
      select: { id: true },
    }),
    db.user.findUnique({
      where: { email: subjectWorkerEmail },
      select: {
        employee: {
          select: { id: true },
        },
      },
    }),
  ]);

  if (!template) {
    throw new Error(
      "Workforce schedule append event history path requires the tagged template to exist. Run the setup first.",
    );
  }

  const schedule = subjectUser?.employee
    ? await db.workerSchedule.findFirst({
        where: {
          workerId: subjectUser.employee.id,
          entryType: WorkerScheduleEntryType.WORK,
          scheduleDate: targetDate,
          status: WorkerScheduleStatus.DRAFT,
        },
        orderBy: [{ id: "desc" }],
        select: { id: true },
      })
    : null;

  if (!schedule) {
    throw new Error(
      "Workforce schedule append event history path requires the tagged draft schedule row to exist. Run the setup first.",
    );
  }

  return {
    defaultBranch,
    eventNote: WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_EVENT_NOTE,
    initialTimeWindowLabel:
      `${minuteToTimeLabel(
        WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_START_MINUTE,
      )} - ${minuteToTimeLabel(
        WORKFORCE_SCHEDULE_APPEND_EVENT_HISTORY_PATH_END_MINUTE,
      )}`,
    manager,
    plannerRoute: "/store/workforce/schedule-planner",
    rangeEndInput: formatDateInput(rangeEnd),
    rangeStartInput: formatDateInput(rangeStart),
    relatedWorkerEmail:
      resolveWorkforceScheduleAppendEventHistoryPathRelatedEmail(),
    relatedWorkerLabel: formatWorkerLabel({
      firstName:
        resolveWorkforceScheduleAppendEventHistoryPathRelatedFirstName(),
      lastName: resolveWorkforceScheduleAppendEventHistoryPathRelatedLastName(),
      alias: resolveWorkforceScheduleAppendEventHistoryPathRelatedAlias(),
    }),
    relatedWorkerPhone:
      resolveWorkforceScheduleAppendEventHistoryPathRelatedPhone(),
    scheduleId: schedule.id,
    subjectWorkerEmail,
    subjectWorkerLabel: formatWorkerLabel({
      firstName: resolveWorkforceScheduleAppendEventHistoryPathFirstName(),
      lastName: resolveWorkforceScheduleAppendEventHistoryPathLastName(),
      alias: resolveWorkforceScheduleAppendEventHistoryPathAlias(),
    }),
    subjectWorkerPhone:
      resolveWorkforceScheduleAppendEventHistoryPathPhone(),
    targetDateInput: formatDateInput(targetDate),
    templateId: template.id,
    templateName,
  };
}

async function main() {
  const { deleted, manager, seeded } =
    await resetWorkforceScheduleAppendEventHistoryPathState();
  const scenario =
    await resolveWorkforceScheduleAppendEventHistoryPathScenarioContext();

  console.log(
    [
      "Workforce schedule append event history path setup is ready.",
      `Manager: ${manager.email ?? `user#${manager.id}`} [userId=${manager.id}]`,
      `Route: ${scenario.plannerRoute}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      `Start: ${scenario.rangeStartInput}`,
      `End: ${scenario.rangeEndInput}`,
      `Target date: ${scenario.targetDateInput}`,
      `Template: ${scenario.templateName} [templateId=${seeded.templateId}]`,
      `Subject worker: ${scenario.subjectWorkerLabel} [employeeId=${seeded.subjectEmployeeId}]`,
      `Subject worker email: ${scenario.subjectWorkerEmail}`,
      `Subject worker phone: ${scenario.subjectWorkerPhone}`,
      `Subject userId: ${seeded.subjectUserId}`,
      `Subject assignment id: ${seeded.subjectAssignmentId}`,
      `Schedule row id: ${seeded.scheduleId}`,
      `Related worker: ${scenario.relatedWorkerLabel} [employeeId=${seeded.relatedEmployeeId}]`,
      `Related worker email: ${scenario.relatedWorkerEmail}`,
      `Related worker phone: ${scenario.relatedWorkerPhone}`,
      `Related userId: ${seeded.relatedUserId}`,
      `Initial window: ${scenario.initialTimeWindowLabel}`,
      `Event note: ${scenario.eventNote}`,
      `Deleted previous tagged users: ${deleted.deletedUsers}`,
      `Deleted previous tagged employees: ${deleted.deletedEmployees}`,
      `Deleted previous tagged templates: ${deleted.deletedTemplates}`,
      `Deleted previous tagged assignments: ${deleted.deletedAssignments}`,
      `Deleted previous tagged schedules: ${deleted.deletedSchedules}`,
      "Next manual QA steps:",
      "1. Open the printed planner route as STORE_MANAGER.",
      "2. Set the printed Start and End values, click Load, then select the tagged draft cell in the board.",
      "3. In Staffing activity, append a Replacement assigned event using the printed related worker and event note.",
      "4. Confirm the new append-only entry appears in Cell history.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown workforce schedule append event history setup error.",
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
