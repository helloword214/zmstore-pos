import "dotenv/config";

import {
  EmployeeRole,
  UserAuthState,
  UserRole,
} from "@prisma/client";
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  deleteEmployeeProfileEditHappyPathArtifacts,
  resolveEmployeeProfileEditHappyPathScenarioContext,
  resetEmployeeProfileEditHappyPathState,
} from "../../../scripts/qa/employee/employee-profile-edit-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_ENABLE_ENV =
  "QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_ENABLE";

export type EmployeeProfileEditHappyPathScenario =
  Awaited<ReturnType<typeof resolveEmployeeProfileEditHappyPathScenarioContext>>;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the employee profile-edit QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveCurrentScenarioEmails(scenario: EmployeeProfileEditHappyPathScenario) {
  return [scenario.initial.email, scenario.updated.email];
}

export function isEmployeeProfileEditHappyPathEnabled() {
  return process.env[EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_ENABLE_ENV] === "1";
}

export async function resolveEmployeeProfileEditHappyPathContext() {
  return resolveEmployeeProfileEditHappyPathScenarioContext();
}

export async function resetEmployeeProfileEditHappyPathQaState() {
  return resetEmployeeProfileEditHappyPathState();
}

export async function cleanupEmployeeProfileEditHappyPathQaState() {
  return deleteEmployeeProfileEditHappyPathArtifacts();
}

export async function bootstrapEmployeeProfileEditHappyPathSession(
  context: BrowserContext,
) {
  const scenario = await resolveEmployeeProfileEditHappyPathContext();
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.admin.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      "Employee profile-edit QA session bootstrap did not return a session cookie.",
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

export async function openEmployeeProfileEditHappyPathEditPage(page: Page) {
  const scenario = await resolveEmployeeProfileEditHappyPathContext();
  const url = new URL(scenario.editRoute, resolveBaseUrl()).toString();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL(
    (target) => target.pathname === `/creation/employees/${scenario.employeeId}/edit`,
    { timeout: 10_000 },
  );
  await expect(
    page.getByRole("heading", {
      name: new RegExp(
        `Edit Employee - ${escapeRegExp(scenario.initial.fullName)}`,
        "i",
      ),
    }),
  ).toBeVisible();
}

export async function openEmployeeProfileEditHappyPathDirectoryPage(page: Page) {
  const scenario = await resolveEmployeeProfileEditHappyPathContext();
  const url = new URL(scenario.directoryRoute, resolveBaseUrl()).toString();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/creation/employees", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: /creation - employees/i }),
  ).toBeVisible();
}

export async function selectEmployeeProfileEditHappyPathOption(
  page: Page,
  label: string,
  optionText: string,
) {
  const labelLocator = page
    .locator("label")
    .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`, "i") })
    .first();
  await expect(labelLocator).toBeVisible();

  const button = labelLocator.locator("xpath=following-sibling::*[1]//button[1]");
  await expect(button).toBeVisible();
  await button.click();
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

export function findEmployeeProfileEditHappyPathDirectoryRow(
  page: Page,
  email: string,
) {
  return page.locator("tr").filter({ hasText: email }).first();
}

export async function resolveEmployeeProfileEditHappyPathAccountState() {
  const scenario = await resolveEmployeeProfileEditHappyPathContext();

  const user = await db.user.findFirst({
    where: {
      email: {
        in: resolveCurrentScenarioEmails(scenario),
      },
    },
    select: {
      id: true,
      email: true,
      role: true,
      managerKind: true,
      active: true,
      authState: true,
      passwordHash: true,
      authVersion: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          alias: true,
          birthDate: true,
          phone: true,
          email: true,
          sssNumber: true,
          pagIbigNumber: true,
          role: true,
          active: true,
          defaultVehicleId: true,
          licenseNumber: true,
          licenseExpiry: true,
          address: {
            select: {
              line1: true,
              provinceId: true,
              municipalityId: true,
              barangayId: true,
              zoneId: true,
              landmarkId: true,
              purok: true,
              postalCode: true,
              landmark: true,
              province: true,
              city: true,
              barangay: true,
            },
          },
        },
      },
      branches: {
        select: {
          branchId: true,
        },
      },
      roleAssignments: {
        where: { endedAt: null },
        select: {
          role: true,
          reason: true,
          changedById: true,
          endedAt: true,
        },
      },
      roleAuditEvents: {
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          beforeRole: true,
          afterRole: true,
          reason: true,
          changedById: true,
        },
      },
    },
    orderBy: { id: "desc" },
  });

  if (!user) return null;

  return {
    active: user.active,
    authState: user.authState,
    authVersion: user.authVersion,
    branchIds: user.branches.map((branch) => branch.branchId),
    email: user.email ?? null,
    employee: user.employee
      ? {
          active: user.employee.active,
          address: user.employee.address,
          alias: user.employee.alias ?? null,
          birthDate: user.employee.birthDate
            ? user.employee.birthDate.toISOString().slice(0, 10)
            : null,
          defaultVehicleId: user.employee.defaultVehicleId ?? null,
          email: user.employee.email ?? null,
          firstName: user.employee.firstName,
          id: user.employee.id,
          lastName: user.employee.lastName,
          licenseExpiry: user.employee.licenseExpiry
            ? user.employee.licenseExpiry.toISOString().slice(0, 10)
            : null,
          licenseNumber: user.employee.licenseNumber ?? null,
          middleName: user.employee.middleName ?? null,
          pagIbigNumber: user.employee.pagIbigNumber ?? null,
          phone: user.employee.phone ?? null,
          role: user.employee.role,
          sssNumber: user.employee.sssNumber ?? null,
        }
      : null,
    id: user.id,
    managerKind: user.managerKind ?? null,
    passwordHash: user.passwordHash,
    role: user.role,
    roleAssignment:
      user.roleAssignments[0]
        ? {
            changedById: user.roleAssignments[0].changedById ?? null,
            endedAt: user.roleAssignments[0].endedAt ?? null,
            reason: user.roleAssignments[0].reason ?? null,
            role: user.roleAssignments[0].role,
          }
        : null,
    roleAuditEvents: user.roleAuditEvents.map((event) => ({
      afterRole: event.afterRole,
      beforeRole: event.beforeRole,
      changedById: event.changedById,
      id: event.id,
      reason: event.reason ?? null,
    })),
  };
}

export function expectEmployeeProfileEditHappyPathInitialDbState(
  accountState: Awaited<
    ReturnType<typeof resolveEmployeeProfileEditHappyPathAccountState>
  >,
  scenario: EmployeeProfileEditHappyPathScenario,
) {
  expect(accountState).not.toBeNull();
  expect(accountState?.role).toBe(UserRole.EMPLOYEE);
  expect(accountState?.managerKind).toBeNull();
  expect(accountState?.authState).toBe(UserAuthState.ACTIVE);
  expect(accountState?.passwordHash).toBe("qa-profile-edit-password-hash");
  expect(accountState?.active).toBe(true);
  expect(accountState?.branchIds).toEqual([scenario.defaultBranch.id]);
  expect(accountState?.email).toBe(scenario.initial.email);
  expect(accountState?.employee?.id).toBe(scenario.employeeId);
  expect(accountState?.employee?.role).toBe(EmployeeRole.RIDER);
  expect(accountState?.employee?.active).toBe(true);
  expect(accountState?.employee?.firstName).toBe(scenario.initial.firstName);
  expect(accountState?.employee?.middleName).toBe(scenario.initial.middleName);
  expect(accountState?.employee?.lastName).toBe(scenario.initial.lastName);
  expect(accountState?.employee?.alias).toBe(scenario.initial.alias);
  expect(accountState?.employee?.phone).toBe(scenario.initial.phone);
  expect(accountState?.employee?.email).toBe(scenario.initial.email);
  expect(accountState?.employee?.sssNumber).toBe(scenario.initial.sssNumber);
  expect(accountState?.employee?.pagIbigNumber).toBe(
    scenario.initial.pagIbigNumber,
  );
  expect(accountState?.employee?.licenseNumber).toBe(
    scenario.initial.licenseNumber,
  );
  expect(accountState?.employee?.licenseExpiry).toBe(
    scenario.initial.licenseExpiryInput,
  );
  expect(accountState?.employee?.defaultVehicleId).toBeNull();
  expect(accountState?.employee?.address?.line1).toBe(scenario.initial.line1);
  expect(accountState?.employee?.address?.provinceId).toBe(scenario.province.id);
  expect(accountState?.employee?.address?.municipalityId).toBe(
    scenario.municipality.id,
  );
  expect(accountState?.employee?.address?.barangayId).toBe(scenario.barangay.id);
  expect(accountState?.employee?.address?.purok).toBeNull();
  expect(accountState?.employee?.address?.postalCode).toBeNull();
  expect(accountState?.employee?.address?.landmark).toBeNull();
  expect(accountState?.roleAssignment?.role).toBe(UserRole.EMPLOYEE);
  expect(accountState?.roleAssignment?.reason).toBe("INITIAL_CREATE_BY_ADMIN");
  expect(accountState?.roleAssignment?.changedById).toBe(scenario.admin.id);
  expect(accountState?.roleAssignment?.endedAt).toBeNull();
  expect(accountState?.roleAuditEvents).toHaveLength(1);
  expect(accountState?.roleAuditEvents[0]?.beforeRole).toBe(UserRole.EMPLOYEE);
  expect(accountState?.roleAuditEvents[0]?.afterRole).toBe(UserRole.EMPLOYEE);
  expect(accountState?.roleAuditEvents[0]?.reason).toBe(
    "INITIAL_CREATE_BY_ADMIN",
  );
  expect(accountState?.roleAuditEvents[0]?.changedById).toBe(scenario.admin.id);
}

export function expectEmployeeProfileEditHappyPathPostedDbState(
  accountState: Awaited<
    ReturnType<typeof resolveEmployeeProfileEditHappyPathAccountState>
  >,
  scenario: EmployeeProfileEditHappyPathScenario,
) {
  expect(accountState).not.toBeNull();
  expect(accountState?.role).toBe(UserRole.EMPLOYEE);
  expect(accountState?.managerKind).toBeNull();
  expect(accountState?.authState).toBe(UserAuthState.ACTIVE);
  expect(accountState?.passwordHash).toBe("qa-profile-edit-password-hash");
  expect(accountState?.active).toBe(true);
  expect(accountState?.branchIds).toEqual([scenario.defaultBranch.id]);
  expect(accountState?.email).toBe(scenario.updated.email);
  expect(accountState?.employee?.id).toBe(scenario.employeeId);
  expect(accountState?.employee?.role).toBe(EmployeeRole.RIDER);
  expect(accountState?.employee?.active).toBe(true);
  expect(accountState?.employee?.firstName).toBe(scenario.updated.firstName);
  expect(accountState?.employee?.middleName).toBe(scenario.updated.middleName);
  expect(accountState?.employee?.lastName).toBe(scenario.updated.lastName);
  expect(accountState?.employee?.alias).toBe(scenario.updated.alias);
  expect(accountState?.employee?.phone).toBe(scenario.updated.phone);
  expect(accountState?.employee?.email).toBe(scenario.updated.email);
  expect(accountState?.employee?.sssNumber).toBe(scenario.updated.sssNumber);
  expect(accountState?.employee?.pagIbigNumber).toBe(
    scenario.updated.pagIbigNumber,
  );
  expect(accountState?.employee?.licenseNumber).toBe(
    scenario.updated.licenseNumber,
  );
  expect(accountState?.employee?.licenseExpiry).toBe(
    scenario.updated.licenseExpiryInput,
  );
  expect(accountState?.employee?.defaultVehicleId).toBe(scenario.vehicle.id);
  expect(accountState?.employee?.address?.line1).toBe(scenario.updated.line1);
  expect(accountState?.employee?.address?.provinceId).toBe(scenario.province.id);
  expect(accountState?.employee?.address?.municipalityId).toBe(
    scenario.municipality.id,
  );
  expect(accountState?.employee?.address?.barangayId).toBe(scenario.barangay.id);
  expect(accountState?.employee?.address?.purok).toBe(scenario.updated.purok);
  expect(accountState?.employee?.address?.postalCode).toBe(
    scenario.updated.postalCode,
  );
  expect(accountState?.employee?.address?.landmark).toBe(
    scenario.updated.landmark,
  );
  expect(accountState?.roleAssignment?.role).toBe(UserRole.EMPLOYEE);
  expect(accountState?.roleAssignment?.reason).toBe("INITIAL_CREATE_BY_ADMIN");
  expect(accountState?.roleAssignment?.changedById).toBe(scenario.admin.id);
  expect(accountState?.roleAssignment?.endedAt).toBeNull();
  expect(accountState?.roleAuditEvents).toHaveLength(1);
  expect(accountState?.roleAuditEvents[0]?.beforeRole).toBe(UserRole.EMPLOYEE);
  expect(accountState?.roleAuditEvents[0]?.afterRole).toBe(UserRole.EMPLOYEE);
  expect(accountState?.roleAuditEvents[0]?.reason).toBe(
    "INITIAL_CREATE_BY_ADMIN",
  );
  expect(accountState?.roleAuditEvents[0]?.changedById).toBe(scenario.admin.id);
}

export async function expectEmployeeProfileEditHappyPathDirectoryRowState(
  row: Locator,
  scenario: EmployeeProfileEditHappyPathScenario,
) {
  await expect(row).toContainText(scenario.updated.fullName);
  await expect(row).toContainText(scenario.updated.alias);
  await expect(row).toContainText(scenario.updated.phone);
  await expect(row).toContainText(scenario.updated.line1);
  await expect(row).toContainText(new RegExp(`\\b${scenario.updated.email}\\b`, "i"));
  await expect(row).toContainText(/\bRIDER\b/);
  await expect(row).toContainText(/\bACTIVE\b/);
}
