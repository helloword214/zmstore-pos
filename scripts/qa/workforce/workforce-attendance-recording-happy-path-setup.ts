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
import { publishWorkerSchedules } from "~/services/worker-schedule-publication.server";
import { upsertEmployeePayProfile } from "~/services/worker-payroll-policy.server";
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";

export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_EMAIL =
  "qa.workforce.attendance.recording.cashier@local";
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_PHONE =
  "09991234041";
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_FIRST_NAME =
  "QA Workforce";
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_LAST_NAME =
  "Attendance";
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ALIAS =
  "SCHED-ATTEND";
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_TEMPLATE_NAME =
  "QA Workforce Attendance Recording Template";
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_INITIAL_NOTE =
  "QA seeded attendance review planner row note";
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DAY_NOTE =
  "QA attendance recording day note";
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ATTENDANCE_NOTE =
  "QA attendance recorded as regular whole day";
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DEFAULT_DAILY_RATE =
  610;
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR =
  0.5;
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_START_MINUTE =
  8 * 60;
export const WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_END_MINUTE =
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
  scheduleId: number;
  templateId: number;
  userId: number;
};

export type WorkforceAttendanceRecordingHappyPathScenarioContext = {
  attendanceNote: string;
  attendanceRoute: string;
  defaultBranch: ReferenceOption;
  dutyDateInput: string;
  dutyDateLabel: string;
  manager: ManagerUser;
  scheduleId: number;
  templateId: number;
  templateName: string;
  timeWindowLabel: string;
  workerEmail: string;
  workerId: number;
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

function combineDateAndMinute(date: Date, minute: number) {
  const combined = new Date(date);
  combined.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return combined;
}

function formatWorkerLabel(args: {
  firstName: string;
  lastName: string;
  alias: string | null;
}) {
  return `${args.firstName} ${args.lastName}`.trim() +
    (args.alias ? ` (${args.alias})` : "");
}

export function resolveWorkforceAttendanceRecordingHappyPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveWorkforceAttendanceRecordingHappyPathEmail() {
  return normalizeEmail(
    process.env.QA_WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_EMAIL ??
      WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_EMAIL,
  );
}

export function resolveWorkforceAttendanceRecordingHappyPathPhone() {
  return (
    process.env.QA_WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_PHONE ??
    WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_PHONE
  ).trim();
}

export function resolveWorkforceAttendanceRecordingHappyPathFirstName() {
  return (
    process.env.QA_WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_FIRST_NAME ??
    WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_FIRST_NAME
  ).trim();
}

export function resolveWorkforceAttendanceRecordingHappyPathLastName() {
  return (
    process.env.QA_WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_LAST_NAME ??
    WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_LAST_NAME
  ).trim();
}

export function resolveWorkforceAttendanceRecordingHappyPathAlias() {
  return (
    process.env.QA_WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ALIAS ??
    WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ALIAS
  ).trim();
}

export function resolveWorkforceAttendanceRecordingHappyPathTemplateName() {
  return (
    process.env.QA_WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_TEMPLATE_NAME ??
    WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_TEMPLATE_NAME
  ).trim();
}

export function resolveWorkforceAttendanceRecordingHappyPathRange(now: Date) {
  const dutyDate = startOfNextWeek(now);
  return { dutyDate };
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
      `Workforce attendance recording happy path requires an active STORE_MANAGER account: ${email}`,
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
      "Workforce attendance recording happy path requires at least one branch.",
    );
  }

  return branch;
}

export async function deleteWorkforceAttendanceRecordingHappyPathArtifacts(): Promise<
  DeleteSummary
> {
  const email = resolveWorkforceAttendanceRecordingHappyPathEmail();
  const phone = resolveWorkforceAttendanceRecordingHappyPathPhone();
  const templateName =
    resolveWorkforceAttendanceRecordingHappyPathTemplateName();

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

async function seedWorkforceAttendanceRecordingHappyPathState(
  manager: ManagerUser,
): Promise<SeedSummary> {
  const defaultBranch = await resolveDefaultBranch();
  const email = resolveWorkforceAttendanceRecordingHappyPathEmail();
  const phone = resolveWorkforceAttendanceRecordingHappyPathPhone();
  const firstName = resolveWorkforceAttendanceRecordingHappyPathFirstName();
  const lastName = resolveWorkforceAttendanceRecordingHappyPathLastName();
  const alias = resolveWorkforceAttendanceRecordingHappyPathAlias();
  const templateName = resolveWorkforceAttendanceRecordingHappyPathTemplateName();
  const { dutyDate } = resolveWorkforceAttendanceRecordingHappyPathRange(
    new Date(),
  );

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
          "qa-workforce-attendance-recording-happy-path-password-hash",
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
        effectiveFrom: dutyDate,
        effectiveTo: null,
        status: WorkerScheduleTemplateStatus.ACTIVE,
        createdById: manager.id,
        updatedById: manager.id,
        days: {
          create: {
            dayOfWeek: WorkerScheduleTemplateDayOfWeek.MONDAY,
            startMinute:
              WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_START_MINUTE,
            endMinute: WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_END_MINUTE,
            note: WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DAY_NOTE,
          },
        },
      },
      select: { id: true },
    });

    const assignment = await tx.scheduleTemplateAssignment.create({
      data: {
        templateId: template.id,
        workerId: employee.id,
        effectiveFrom: dutyDate,
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
        scheduleDate: dutyDate,
        startAt: combineDateAndMinute(
          dutyDate,
          WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_START_MINUTE,
        ),
        endAt: combineDateAndMinute(
          dutyDate,
          WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_END_MINUTE,
        ),
        templateAssignmentId: assignment.id,
        status: "DRAFT",
        note: WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_INITIAL_NOTE,
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

  await upsertEmployeePayProfile({
    employeeId: seeded.employeeId,
    dailyRate: WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DEFAULT_DAILY_RATE,
    halfDayFactor:
      WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR,
    effectiveFrom: dutyDate,
    effectiveTo: null,
    note: "QA attendance recording pay profile",
    actorUserId: manager.id,
  });

  const published = await publishWorkerSchedules({
    actorUserId: manager.id,
    scheduleIds: [seeded.scheduleId],
  });

  if (published.publishedCount !== 1) {
    throw new Error(
      `Expected exactly one published row for workforce attendance recording happy path, received ${published.publishedCount}.`,
    );
  }

  return seeded;
}

export async function resetWorkforceAttendanceRecordingHappyPathState() {
  const deleted = await deleteWorkforceAttendanceRecordingHappyPathArtifacts();
  const manager = await resolveScenarioManager(
    resolveWorkforceAttendanceRecordingHappyPathManagerEmail(),
  );
  const seeded = await seedWorkforceAttendanceRecordingHappyPathState(manager);

  return { deleted, manager, seeded };
}

export async function resolveWorkforceAttendanceRecordingHappyPathScenarioContext(): Promise<
  WorkforceAttendanceRecordingHappyPathScenarioContext
> {
  const [defaultBranch, manager] = await Promise.all([
    resolveDefaultBranch(),
    resolveScenarioManager(
      resolveWorkforceAttendanceRecordingHappyPathManagerEmail(),
    ),
  ]);
  const { dutyDate } = resolveWorkforceAttendanceRecordingHappyPathRange(
    new Date(),
  );
  const templateName = resolveWorkforceAttendanceRecordingHappyPathTemplateName();
  const email = resolveWorkforceAttendanceRecordingHappyPathEmail();

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
      "Workforce attendance recording happy path requires the tagged template to exist. Run the setup first.",
    );
  }

  const schedule = user?.employee
    ? await db.workerSchedule.findFirst({
        where: {
          workerId: user.employee.id,
          scheduleDate: dutyDate,
        },
        select: { id: true },
      })
    : null;

  if (!user?.employee || !schedule) {
    throw new Error(
      "Workforce attendance recording happy path requires the tagged published schedule row to exist. Run the setup first.",
    );
  }

  return {
    attendanceNote: WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_ATTENDANCE_NOTE,
    attendanceRoute: "/store/workforce/attendance-review",
    defaultBranch,
    dutyDateInput: formatDateInput(dutyDate),
    dutyDateLabel: formatDateLabel(dutyDate),
    manager,
    scheduleId: schedule.id,
    templateId: template.id,
    templateName,
    timeWindowLabel:
      `${minuteToTimeLabel(
        WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_START_MINUTE,
      )} - ${minuteToTimeLabel(
        WORKFORCE_ATTENDANCE_RECORDING_HAPPY_PATH_END_MINUTE,
      )}`,
    workerEmail: email,
    workerId: user.employee.id,
    workerLabel: formatWorkerLabel({
      firstName: resolveWorkforceAttendanceRecordingHappyPathFirstName(),
      lastName: resolveWorkforceAttendanceRecordingHappyPathLastName(),
      alias: resolveWorkforceAttendanceRecordingHappyPathAlias(),
    }),
    workerPhone: resolveWorkforceAttendanceRecordingHappyPathPhone(),
  };
}

async function main() {
  const { deleted, manager, seeded } =
    await resetWorkforceAttendanceRecordingHappyPathState();
  const scenario =
    await resolveWorkforceAttendanceRecordingHappyPathScenarioContext();

  console.log(
    [
      "Workforce attendance recording happy path setup is ready.",
      `Manager: ${manager.email ?? `user#${manager.id}`} [userId=${manager.id}]`,
      `Route: ${scenario.attendanceRoute}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      `Duty date: ${scenario.dutyDateInput}`,
      `Template: ${scenario.templateName} [templateId=${seeded.templateId}]`,
      `Tagged worker: ${scenario.workerLabel} [employeeId=${seeded.employeeId}]`,
      `Tagged worker email: ${scenario.workerEmail}`,
      `Tagged worker phone: ${scenario.workerPhone}`,
      `Tagged userId: ${seeded.userId}`,
      `Assignment id: ${seeded.assignmentId}`,
      `Published schedule row id: ${seeded.scheduleId}`,
      `Planned window: ${scenario.timeWindowLabel}`,
      `Attendance note: ${scenario.attendanceNote}`,
      `Deleted previous tagged users: ${deleted.deletedUsers}`,
      `Deleted previous tagged employees: ${deleted.deletedEmployees}`,
      `Deleted previous tagged templates: ${deleted.deletedTemplates}`,
      `Deleted previous tagged assignments: ${deleted.deletedAssignments}`,
      `Deleted previous tagged schedules: ${deleted.deletedSchedules}`,
      "Next manual QA steps:",
      "1. Open the printed attendance route as STORE_MANAGER.",
      "2. Confirm the tagged worker shows a published planned row and no attendance fact yet.",
      "3. Record WORK_DAY + WHOLE_DAY + REGULAR + NO late flag with the printed note.",
      "4. Confirm the row now shows WHOLE_DAY and the attendance save alert appears.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown workforce attendance recording setup error.",
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
