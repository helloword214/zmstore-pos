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
  deleteEmployeeRoleSwitchHappyPathArtifacts,
  resetEmployeeRoleSwitchHappyPathState,
  resolveEmployeeRoleSwitchHappyPathScenarioContext,
} from "../../../scripts/qa/employee/employee-role-switch-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_ENABLE_ENV =
  "QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_ENABLE";

export type EmployeeRoleSwitchHappyPathScenario =
  Awaited<ReturnType<typeof resolveEmployeeRoleSwitchHappyPathScenarioContext>>;

type SwitchAccessLane = "CASHIER" | "RIDER";

const SWITCH_ACCESS_LANES: Record<
  SwitchAccessLane,
  {
    heading: RegExp;
    homePath: string;
    wrongPath: string;
  }
> = {
  CASHIER: {
    heading: /cashier dashboard/i,
    homePath: "/cashier",
    wrongPath: "/store",
  },
  RIDER: {
    heading: /rider\s*&\s*seller console/i,
    homePath: "/rider",
    wrongPath: "/cashier",
  },
};

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the employee role-switch QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

export function isEmployeeRoleSwitchHappyPathEnabled() {
  return process.env[EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_ENABLE_ENV] === "1";
}

export async function resolveEmployeeRoleSwitchHappyPathContext() {
  return resolveEmployeeRoleSwitchHappyPathScenarioContext();
}

export async function resetEmployeeRoleSwitchHappyPathQaState() {
  return resetEmployeeRoleSwitchHappyPathState();
}

export async function cleanupEmployeeRoleSwitchHappyPathQaState() {
  return deleteEmployeeRoleSwitchHappyPathArtifacts();
}

export async function bootstrapEmployeeRoleSwitchHappyPathSession(
  context: BrowserContext,
) {
  const scenario = await resolveEmployeeRoleSwitchHappyPathContext();
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.admin.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      "Employee role-switch QA session bootstrap did not return a session cookie.",
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

async function bootstrapEmployeeRoleSwitchHappyPathUserSession(
  context: BrowserContext,
  userId: number,
) {
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    userId,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      "Employee role-switch QA session bootstrap did not return a session cookie for the switched user.",
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

export async function bootstrapEmployeeRoleSwitchHappyPathSwitchedUserSession(
  context: BrowserContext,
) {
  const accountState = await resolveEmployeeRoleSwitchHappyPathAccountState();

  if (!accountState?.id) {
    throw new Error(
      "Employee role-switch fixture could not resolve the switched user account for access-lane verification.",
    );
  }

  await bootstrapEmployeeRoleSwitchHappyPathUserSession(context, accountState.id);
}

export async function openEmployeeRoleSwitchHappyPathDirectoryPage(page: Page) {
  const scenario = await resolveEmployeeRoleSwitchHappyPathContext();
  const url = new URL(scenario.directoryRoute, resolveBaseUrl()).toString();

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/creation/employees", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: /creation - employees/i }),
  ).toBeVisible();
}

export function findEmployeeRoleSwitchHappyPathDirectoryRow(
  page: Page,
  email: string,
) {
  return page.locator("tr").filter({ hasText: email }).first();
}

export async function resolveEmployeeRoleSwitchHappyPathAccountState() {
  const scenario = await resolveEmployeeRoleSwitchHappyPathContext();

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
      authVersion: true,
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
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          role: true,
          reason: true,
          changedById: true,
          startedAt: true,
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
          createdAt: true,
        },
      },
    },
  });

  if (!user) return null;

  return {
    active: user.active,
    authState: user.authState,
    authVersion: user.authVersion,
    branchIds: user.branches.map((branch) => branch.branchId),
    email: user.email ?? null,
    id: user.id,
    employee: user.employee
      ? {
          active: user.employee.active,
          address: user.employee.address,
          defaultVehicleId: user.employee.defaultVehicleId,
          email: user.employee.email ?? null,
          firstName: user.employee.firstName,
          id: user.employee.id,
          lastName: user.employee.lastName,
          licenseExpiry: user.employee.licenseExpiry,
          licenseNumber: user.employee.licenseNumber,
          phone: user.employee.phone ?? null,
          role: user.employee.role,
        }
      : null,
    managerKind: user.managerKind,
    passwordHash: user.passwordHash,
    role: user.role,
    roleAssignments: user.roleAssignments.map((assignment) => ({
      changedById: assignment.changedById,
      endedAt: assignment.endedAt,
      id: assignment.id,
      reason: assignment.reason ?? null,
      role: assignment.role,
      startedAt: assignment.startedAt,
    })),
    roleAuditEvents: user.roleAuditEvents.map((event) => ({
      afterRole: event.afterRole,
      beforeRole: event.beforeRole,
      changedById: event.changedById,
      createdAt: event.createdAt,
      id: event.id,
      reason: event.reason ?? null,
    })),
  };
}

export async function expectEmployeeRoleSwitchHappyPathDirectoryRowState(
  row: Locator,
  expectedLane: "CASHIER" | "RIDER",
) {
  await expect(row).toContainText(new RegExp(`\\b${expectedLane}\\b`));
  await expect(row).toContainText(/\bACTIVE\b/);
  await expect(row).toContainText(/\bPASSWORD_READY\b/);
}

export async function expectEmployeeRoleSwitchHappyPathHomeLane(
  page: Page,
  lane: SwitchAccessLane,
) {
  const target = SWITCH_ACCESS_LANES[lane];

  await page.goto(new URL(target.homePath, resolveBaseUrl()).toString(), {
    waitUntil: "domcontentloaded",
  });

  await page.waitForURL((url) => url.pathname === target.homePath, {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: target.heading }),
  ).toBeVisible();
}

export async function expectEmployeeRoleSwitchHappyPathWrongLaneRedirect(
  page: Page,
  lane: SwitchAccessLane,
) {
  const target = SWITCH_ACCESS_LANES[lane];

  await page.goto(new URL(target.wrongPath, resolveBaseUrl()).toString(), {
    waitUntil: "domcontentloaded",
  });

  await page.waitForURL((url) => url.pathname === target.homePath, {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: target.heading }),
  ).toBeVisible();
}

export function expectEmployeeRoleSwitchHappyPathInitialDbState(
  accountState: Awaited<
    ReturnType<typeof resolveEmployeeRoleSwitchHappyPathAccountState>
  >,
) {
  expect(accountState).not.toBeNull();
  expect(accountState?.role).toBe(UserRole.CASHIER);
  expect(accountState?.managerKind).toBeNull();
  expect(accountState?.authState).toBe(UserAuthState.ACTIVE);
  expect(accountState?.passwordHash).toBe("qa-role-switch-password-hash");
  expect(accountState?.active).toBe(true);
  expect(accountState?.employee).not.toBeNull();
  expect(accountState?.employee?.role).toBe(EmployeeRole.STAFF);
  expect(accountState?.employee?.active).toBe(true);
  expect(accountState?.employee?.defaultVehicleId).toBeNull();
  expect(accountState?.employee?.licenseNumber).toBeNull();
  expect(accountState?.employee?.licenseExpiry).toBeNull();
  expect(accountState?.roleAssignments).toHaveLength(1);
  expect(accountState?.roleAssignments[0]?.role).toBe(UserRole.CASHIER);
  expect(accountState?.roleAssignments[0]?.endedAt).toBeNull();
  expect(accountState?.roleAuditEvents).toHaveLength(1);
  expect(accountState?.roleAuditEvents[0]?.beforeRole).toBe(UserRole.CASHIER);
  expect(accountState?.roleAuditEvents[0]?.afterRole).toBe(UserRole.CASHIER);
}
