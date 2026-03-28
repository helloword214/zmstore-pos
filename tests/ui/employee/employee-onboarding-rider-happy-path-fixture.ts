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
  resolveEmployeeOnboardingRiderHappyPathScenarioContext,
  resetEmployeeOnboardingRiderHappyPathState,
} from "../../../scripts/qa/employee/employee-onboarding-rider-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const EMPLOYEE_ONBOARDING_RIDER_HAPPY_PATH_ENABLE_ENV =
  "QA_EMPLOYEE_ONBOARDING_RIDER_HAPPY_PATH_ENABLE";

export type EmployeeOnboardingRiderHappyPathScenario =
  Awaited<ReturnType<typeof resolveEmployeeOnboardingRiderHappyPathScenarioContext>>;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the employee rider onboarding QA session.",
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

export function isEmployeeOnboardingRiderHappyPathEnabled() {
  return process.env[EMPLOYEE_ONBOARDING_RIDER_HAPPY_PATH_ENABLE_ENV] === "1";
}

export async function resolveEmployeeOnboardingRiderHappyPathContext() {
  return resolveEmployeeOnboardingRiderHappyPathScenarioContext();
}

export async function resetEmployeeOnboardingRiderHappyPathQaState() {
  return resetEmployeeOnboardingRiderHappyPathState();
}

export async function bootstrapEmployeeOnboardingRiderHappyPathSession(
  context: BrowserContext,
) {
  const scenario = await resolveEmployeeOnboardingRiderHappyPathContext();
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.admin.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      "Employee rider onboarding QA session bootstrap did not return a session cookie.",
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

export async function openEmployeeOnboardingRiderHappyPathCreatePage(page: Page) {
  const scenario = await resolveEmployeeOnboardingRiderHappyPathContext();
  const url = new URL(scenario.createRoute, resolveBaseUrl()).toString();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/creation/employees/new", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: /creation - employees \(new\)/i }),
  ).toBeVisible();
}

export async function openEmployeeOnboardingRiderHappyPathDirectoryPage(page: Page) {
  const scenario = await resolveEmployeeOnboardingRiderHappyPathContext();
  const url = new URL(scenario.directoryRoute, resolveBaseUrl()).toString();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/creation/employees", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: /creation - employees/i }),
  ).toBeVisible();
}

export async function selectEmployeeOnboardingRiderHappyPathOption(
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

export function findEmployeeOnboardingRiderHappyPathDirectoryRow(
  page: Page,
  email: string,
) {
  return page.locator("tr").filter({ hasText: email }).first();
}

export async function resolveEmployeeOnboardingRiderHappyPathAccountState() {
  const scenario = await resolveEmployeeOnboardingRiderHappyPathContext();

  const user = await db.user.findUnique({
    where: { email: scenario.email },
    select: {
      id: true,
      email: true,
      role: true,
      managerKind: true,
      active: true,
      authState: true,
      passwordHash: true,
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
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
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          beforeRole: true,
          afterRole: true,
          reason: true,
          changedById: true,
        },
      },
      passwordResetTokens: {
        where: { usedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          expiresAt: true,
          usedAt: true,
        },
      },
    },
  });

  if (!user) return null;

  return {
    active: user.active,
    authState: user.authState,
    branchIds: user.branches.map((branch) => branch.branchId),
    email: user.email ?? null,
    employee: user.employee
      ? {
          active: user.employee.active,
          address: user.employee.address,
          defaultVehicleId: user.employee.defaultVehicleId ?? null,
          email: user.employee.email ?? null,
          firstName: user.employee.firstName,
          id: user.employee.id,
          lastName: user.employee.lastName,
          licenseExpiry: user.employee.licenseExpiry
            ? user.employee.licenseExpiry.toISOString().slice(0, 10)
            : null,
          licenseNumber: user.employee.licenseNumber ?? null,
          phone: user.employee.phone ?? null,
          role: user.employee.role,
        }
      : null,
    managerKind: user.managerKind ?? null,
    passwordHash: user.passwordHash,
    passwordResetTokenCount: user.passwordResetTokens.length,
    passwordResetTokenExpiresAt:
      user.passwordResetTokens[0]?.expiresAt ?? null,
    passwordResetTokenUsedAt: user.passwordResetTokens[0]?.usedAt ?? null,
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
    roleAuditEvent:
      user.roleAuditEvents[0]
        ? {
            afterRole: user.roleAuditEvents[0].afterRole,
            beforeRole: user.roleAuditEvents[0].beforeRole,
            changedById: user.roleAuditEvents[0].changedById ?? null,
            reason: user.roleAuditEvents[0].reason ?? null,
          }
        : null,
  };
}

export async function expectEmployeeOnboardingRiderHappyPathSuccessAlert(page: Page) {
  await expect(
    page.getByText(/employee account created with primary address\./i),
  ).toBeVisible();
}

export async function expectEmployeeOnboardingRiderHappyPathDirectoryRowState(
  row: Locator,
) {
  await expect(row.getByText(/^RIDER$/)).toBeVisible();
  await expect(row.getByText(/^ACTIVE$/)).toBeVisible();
  await expect(row.getByText(/^PASSWORD_MISSING$/)).toBeVisible();
  await expect(row.getByRole("button", { name: /resend invite/i })).toBeVisible();
}

export function expectEmployeeOnboardingRiderHappyPathDbState(accountState: Awaited<
  ReturnType<typeof resolveEmployeeOnboardingRiderHappyPathAccountState>
>) {
  expect(accountState).not.toBeNull();
  expect(accountState?.role).toBe(UserRole.EMPLOYEE);
  expect(accountState?.managerKind).toBeNull();
  expect(accountState?.active).toBe(true);
  expect(accountState?.authState).toBe(UserAuthState.PENDING_PASSWORD);
  expect(accountState?.passwordHash).toBeNull();
  expect(accountState?.employee).not.toBeNull();
  expect(accountState?.employee?.role).toBe(EmployeeRole.RIDER);
  expect(accountState?.employee?.active).toBe(true);
  expect(accountState?.roleAssignment?.role).toBe(UserRole.EMPLOYEE);
  expect(accountState?.roleAssignment?.reason).toBe("INITIAL_CREATE_BY_ADMIN");
  expect(accountState?.roleAssignment?.endedAt).toBeNull();
  expect(accountState?.roleAuditEvent?.beforeRole).toBe(UserRole.EMPLOYEE);
  expect(accountState?.roleAuditEvent?.afterRole).toBe(UserRole.EMPLOYEE);
  expect(accountState?.roleAuditEvent?.reason).toBe("INITIAL_CREATE_BY_ADMIN");
  expect(accountState?.passwordResetTokenCount).toBe(1);
  expect(accountState?.passwordResetTokenUsedAt).toBeNull();
}
