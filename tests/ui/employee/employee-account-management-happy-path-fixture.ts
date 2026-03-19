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
  deleteEmployeeAccountManagementHappyPathArtifacts,
  resolveEmployeeAccountManagementHappyPathScenarioContext,
  resetEmployeeAccountManagementHappyPathState,
} from "../../../scripts/qa/employee/employee-account-management-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_ENABLE_ENV =
  "QA_EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_ENABLE";

export type EmployeeAccountManagementHappyPathScenario =
  Awaited<ReturnType<typeof resolveEmployeeAccountManagementHappyPathScenarioContext>>;

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the employee account-management QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

export function isEmployeeAccountManagementHappyPathEnabled() {
  return process.env[EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_ENABLE_ENV] === "1";
}

export async function resolveEmployeeAccountManagementHappyPathContext() {
  return resolveEmployeeAccountManagementHappyPathScenarioContext();
}

export async function resetEmployeeAccountManagementHappyPathQaState() {
  return resetEmployeeAccountManagementHappyPathState();
}

export async function cleanupEmployeeAccountManagementHappyPathQaState() {
  return deleteEmployeeAccountManagementHappyPathArtifacts();
}

export async function bootstrapEmployeeAccountManagementHappyPathSession(
  context: BrowserContext,
) {
  const scenario = await resolveEmployeeAccountManagementHappyPathContext();
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.admin.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      "Employee account-management QA session bootstrap did not return a session cookie.",
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

export async function openEmployeeAccountManagementHappyPathDirectoryPage(
  page: Page,
) {
  const scenario = await resolveEmployeeAccountManagementHappyPathContext();
  const url = new URL(scenario.directoryRoute, resolveBaseUrl()).toString();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/creation/employees", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: /creation - employees/i }),
  ).toBeVisible();
}

export function findEmployeeAccountManagementHappyPathDirectoryRow(
  page: Page,
  email: string,
) {
  return page.locator("tr").filter({ hasText: email }).first();
}

export async function resolveEmployeeAccountManagementHappyPathAccountState() {
  const scenario = await resolveEmployeeAccountManagementHappyPathContext();

  const user = await db.user.findUnique({
    where: { email: scenario.email },
    select: {
      id: true,
      email: true,
      role: true,
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
        },
      },
      passwordResetTokens: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          createdAt: true,
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
          email: user.employee.email ?? null,
          firstName: user.employee.firstName,
          id: user.employee.id,
          lastName: user.employee.lastName,
          phone: user.employee.phone ?? null,
          role: user.employee.role,
        }
      : null,
    passwordHash: user.passwordHash,
    role: user.role,
    roleAssignment:
      user.roleAssignments[0]
        ? {
            reason: user.roleAssignments[0].reason ?? null,
            role: user.roleAssignments[0].role,
          }
        : null,
    tokens: user.passwordResetTokens.map((token) => ({
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      id: token.id,
      usedAt: token.usedAt,
    })),
  };
}

export async function expectEmployeeAccountManagementHappyPathDirectoryRowState(
  row: Locator,
  expectedStatus: "ACTIVE" | "INACTIVE",
) {
  await expect(row).toContainText(/\bCASHIER\b/);
  await expect(row).toContainText(new RegExp(`\\b${expectedStatus}\\b`));
  await expect(row).toContainText(/\bPASSWORD_MISSING\b/);
}

export function expectEmployeeAccountManagementHappyPathDbState(accountState: Awaited<
  ReturnType<typeof resolveEmployeeAccountManagementHappyPathAccountState>
>) {
  expect(accountState).not.toBeNull();
  expect(accountState?.role).toBe(UserRole.CASHIER);
  expect(accountState?.authState).toBe(UserAuthState.PENDING_PASSWORD);
  expect(accountState?.passwordHash).toBeNull();
  expect(accountState?.employee).not.toBeNull();
  expect(accountState?.employee?.role).toBe(EmployeeRole.STAFF);
  expect(accountState?.roleAssignment?.role).toBe(UserRole.CASHIER);
  expect(accountState?.roleAssignment?.reason).toBe("INITIAL_CREATE_BY_ADMIN");
}
