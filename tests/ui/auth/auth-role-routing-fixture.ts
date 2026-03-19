import "dotenv/config";

import { EmployeeRole } from "@prisma/client";
import { expect, type Page } from "@playwright/test";
import { createUserSession, type Role } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export type AuthRoleRoutingScenario = {
  id: "admin" | "manager" | "cashier" | "rider";
  role: Role;
  emailEnvKey: string;
  fallbackEmail: string;
  expectedHomePath: string;
  expectedHeading: RegExp;
  wrongRolePath: string;
};

export const AUTH_ROLE_ROUTING_SCENARIOS: AuthRoleRoutingScenario[] = [
  {
    id: "admin",
    role: "ADMIN",
    emailEnvKey: "UI_ADMIN_EMAIL",
    fallbackEmail: "admin@local",
    expectedHomePath: "/",
    expectedHeading: /admin dashboard/i,
    wrongRolePath: "/store",
  },
  {
    id: "manager",
    role: "STORE_MANAGER",
    emailEnvKey: "UI_MANAGER_EMAIL",
    fallbackEmail: "manager1@local",
    expectedHomePath: "/store",
    expectedHeading: /manager dashboard/i,
    wrongRolePath: "/products",
  },
  {
    id: "cashier",
    role: "CASHIER",
    emailEnvKey: "UI_CASHIER_EMAIL",
    fallbackEmail: "cashier1@local",
    expectedHomePath: "/cashier",
    expectedHeading: /cashier dashboard/i,
    wrongRolePath: "/store",
  },
  {
    id: "rider",
    role: "EMPLOYEE",
    emailEnvKey: "UI_RIDER_EMAIL",
    fallbackEmail: "rider1@local",
    expectedHomePath: "/rider",
    expectedHeading: /rider\s*&\s*seller console/i,
    wrongRolePath: "/store",
  },
];

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function resolveScenarioEmail(config: AuthRoleRoutingScenario) {
  return (process.env[config.emailEnvKey] ?? config.fallbackEmail).trim().toLowerCase();
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error("Invalid auth cookie returned while creating the role-routing session.");
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

async function resolveScenarioUser(config: AuthRoleRoutingScenario) {
  const email = resolveScenarioEmail(config);
  const user = await db.user.findUnique({
    where: { email },
    include: { employee: true },
  });

  if (!user || !user.active || user.role !== config.role) {
    throw new Error(
      `Auth role routing fixture requires an active ${config.role} account: ${email}`,
    );
  }

  if (config.role === "EMPLOYEE") {
    if (!user.employee || user.employee.role !== EmployeeRole.RIDER) {
      throw new Error(
        `Auth role routing fixture requires the employee account to be linked to a RIDER profile: ${email}`,
      );
    }
  }

  return user;
}

export async function bootstrapAuthRoleRoutingSession(
  page: Page,
  config: AuthRoleRoutingScenario,
) {
  const baseUrl = new URL(resolveBaseUrl());
  const user = await resolveScenarioUser(config);
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    user.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      `Auth role routing fixture did not receive a session cookie for ${config.id}.`,
    );
  }

  const cookie = parseCookiePair(setCookieHeader);
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: baseUrl.hostname,
      path: "/",
      secure: baseUrl.protocol === "https:",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function expectAuthRoleRoutingHome(
  page: Page,
  config: AuthRoleRoutingScenario,
) {
  const url = new URL(config.expectedHomePath, resolveBaseUrl()).toString();
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });

  expect(response?.ok(), `Home route unreachable: ${url}`).toBeTruthy();
  expect(new URL(page.url()).pathname).toBe(config.expectedHomePath);
  await expect(page.getByRole("heading", { name: config.expectedHeading })).toBeVisible();
}

export async function expectAuthRoleRoutingLoginRedirect(
  page: Page,
  config: AuthRoleRoutingScenario,
) {
  const url = new URL("/login", resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  expect(new URL(page.url()).pathname).toBe(config.expectedHomePath);
  await expect(page.getByRole("heading", { name: config.expectedHeading })).toBeVisible();
}

export async function expectAuthRoleRoutingWrongLaneRedirect(
  page: Page,
  config: AuthRoleRoutingScenario,
) {
  const url = new URL(config.wrongRolePath, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  expect(new URL(page.url()).pathname).toBe(config.expectedHomePath);
  await expect(page.getByRole("heading", { name: config.expectedHeading })).toBeVisible();
}
