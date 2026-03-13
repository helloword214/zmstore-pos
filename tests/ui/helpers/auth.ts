import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { authStorage } from "../../../app/utils/auth.server";
import { resolveBaseURL } from "./session";

const AUTH_DIR = "test-results/ui/auth";
const db = new PrismaClient();

export function resolveAuthStateFile(
  envKey: string,
  fallbackFileName: string,
) {
  const fromEnv = process.env[envKey];
  if (fromEnv) return fromEnv;
  return path.join(AUTH_DIR, fallbackFileName);
}

export async function persistStorageState(page: Page, filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await page.context().storageState({ path: filePath });
}

export async function openLogin(page: Page) {
  const url = new URL("/login", resolveBaseURL()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

async function submitLoginCredentials(page: Page, email: string, password: string) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: /continue/i }).click();
}

async function waitForAuthStep(page: Page) {
  await page
    .waitForURL((url) => url.pathname === "/login/otp" || !url.pathname.startsWith("/login"), {
      timeout: 10_000,
    })
    .catch(() => null);

  return new URL(page.url()).pathname;
}

async function bootstrapAuthenticatedSession(page: Page, email: string) {
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      role: true,
      active: true,
      branches: { select: { branchId: true } },
    },
  });

  if (!user || !user.active) {
    throw new Error(`Cannot bootstrap auth session for missing/inactive user: ${email}`);
  }

  const session = await authStorage.getSession();
  session.set("userId", user.id);
  session.set("role", user.role);
  session.set(
    "branchIds",
    user.branches.map((branch) => branch.branchId),
  );
  session.unset("shiftId");

  const setCookie = await authStorage.commitSession(session);
  const [cookiePair] = setCookie.split(";");
  const separatorIndex = cookiePair.indexOf("=");
  const name = cookiePair.slice(0, separatorIndex);
  const value = cookiePair.slice(separatorIndex + 1);
  const baseUrl = new URL(resolveBaseURL());

  await page.context().addCookies([
    {
      name,
      value,
      domain: baseUrl.hostname,
      path: "/",
      secure: baseUrl.protocol === "https:",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function completeOtpStep(page: Page, email: string, otpEnvKey?: string) {
  const otpCode = (otpEnvKey ? process.env[otpEnvKey] : process.env.UI_LOGIN_OTP_CODE) ?? "";
  if (otpCode.trim()) {
    await page.locator('input[name="code"]').fill(otpCode.trim());
    await page.getByRole("button", { name: /verify and sign in/i }).click();
    return;
  }

  await bootstrapAuthenticatedSession(page, email);
  await page.reload({ waitUntil: "domcontentloaded" });
}

export async function loginByEmail(
  page: Page,
  email: string,
  password: string,
  options?: { otpEnvKey?: string },
) {
  await openLogin(page);
  await submitLoginCredentials(page, email, password);

  const pathname = await waitForAuthStep(page);

  if (pathname === "/login") {
    const errorMessage =
      (await page.locator('[role="alert"]').first().textContent().catch(() => null))?.trim() ||
      "Login did not advance past the sign-in form.";
    throw new Error(errorMessage);
  }

  if (pathname === "/login/otp") {
    await completeOtpStep(page, email, options?.otpEnvKey);
  }

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20_000,
  });
  expect(new URL(page.url()).pathname).not.toBe("/login");
}
