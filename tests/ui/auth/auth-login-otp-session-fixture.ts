import "dotenv/config";

import { expect, type Page } from "@playwright/test";
import { LoginRateLimitScope } from "@prisma/client";
import { db } from "~/utils/db.server";
import {
  LOGIN_OTP_RESEND_COOLDOWN_SECONDS,
  resendLoginOtpChallenge,
} from "~/utils/auth-login-guard.server";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_MANAGER_EMAIL = "manager1@local";
const DEFAULT_MANAGER_PASSWORD = "manager1123";
const DEFAULT_MANAGER_HOME_PATH = "/store";
const LOCAL_IP_SCOPE_KEYS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"] as const;

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

async function resolveScenarioManager(email: string) {
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      active: true,
      role: true,
    },
  });

  if (!user || !user.active || user.role !== "STORE_MANAGER") {
    throw new Error(
      `Auth login OTP session fixture requires an active STORE_MANAGER account: ${email}`,
    );
  }

  return user;
}

export function resolveAuthLoginOtpSessionBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export function resolveAuthLoginOtpSessionManagerEmail() {
  return (
    process.env.QA_AUTH_LOGIN_OTP_SESSION_MANAGER_EMAIL ??
    process.env.UI_MANAGER_EMAIL ??
    DEFAULT_MANAGER_EMAIL
  )
    .trim()
    .toLowerCase();
}

export function resolveAuthLoginOtpSessionManagerPassword() {
  return (
    process.env.QA_AUTH_LOGIN_OTP_SESSION_MANAGER_PASSWORD ??
    process.env.UI_MANAGER_PASSWORD ??
    DEFAULT_MANAGER_PASSWORD
  ).trim();
}

export function resolveAuthLoginOtpSessionExpectedHomePath() {
  return (
    process.env.QA_AUTH_LOGIN_OTP_SESSION_HOME_PATH ??
    process.env.UI_MANAGER_HOME_PATH ??
    DEFAULT_MANAGER_HOME_PATH
  ).trim();
}

export async function resetAuthLoginOtpSessionState() {
  const email = resolveAuthLoginOtpSessionManagerEmail();
  const manager = await resolveScenarioManager(email);

  await db.$transaction([
    db.loginOtpChallenge.deleteMany({
      where: { userId: manager.id },
    }),
    db.loginRateLimitState.deleteMany({
      where: {
        OR: [
          {
            scope: LoginRateLimitScope.EMAIL,
            scopeKey: email,
          },
          ...LOCAL_IP_SCOPE_KEYS.map((scopeKey) => ({
            scope: LoginRateLimitScope.IP,
            scopeKey,
          })),
        ],
      },
    }),
  ]);

  return manager;
}

export async function openAuthLoginOtpSession(page: Page) {
  const url = new URL("/login", resolveAuthLoginOtpSessionBaseURL()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
}

export async function submitAuthLoginOtpSessionCredentials(page: Page) {
  await page
    .getByLabel(/^Email$/i)
    .fill(resolveAuthLoginOtpSessionManagerEmail());
  await page
    .getByLabel(/^Password$/i)
    .fill(resolveAuthLoginOtpSessionManagerPassword());
  await page.getByRole("button", { name: /continue/i }).click();

  await page.waitForURL((url) => url.pathname === "/login/otp", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /verify sign-in/i })).toBeVisible();
}

export async function resolveAuthLoginOtpSessionCode() {
  const email = resolveAuthLoginOtpSessionManagerEmail();
  const manager = await resolveScenarioManager(email);
  const challenge = await db.loginOtpChallenge.findFirst({
    where: {
      userId: manager.id,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (!challenge) {
    throw new Error(`No active login OTP challenge found for: ${email}`);
  }

  // Advance logical time just past the resend cooldown so the test can get a
  // deterministic OTP without sleeping or scraping logs.
  const resend = await resendLoginOtpChallenge({
    challengeId: challenge.id,
    userId: manager.id,
    requestIp: null,
    userAgent: "auth-login-otp-session-fixture",
    now: addSeconds(new Date(), LOGIN_OTP_RESEND_COOLDOWN_SECONDS + 1),
  });

  if (!resend.ok) {
    throw new Error(
      `Unable to resolve login OTP code for ${email}: ${resend.reason}`,
    );
  }

  return resend.otpCode;
}

export async function completeAuthLoginOtpSession(page: Page, otpCode: string) {
  const expectedHomePath = resolveAuthLoginOtpSessionExpectedHomePath();

  await page.getByLabel(/^Verification code$/i).fill(otpCode);
  await page.getByRole("button", { name: /verify and sign in/i }).click();

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20_000,
  });

  expect(new URL(page.url()).pathname.startsWith(expectedHomePath)).toBe(true);
}

export async function logoutAuthLoginOtpSession(page: Page) {
  const url = new URL("/logout", resolveAuthLoginOtpSessionBaseURL()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/login", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
}
