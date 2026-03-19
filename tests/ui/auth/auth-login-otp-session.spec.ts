import { expect, test } from "@playwright/test";
import {
  completeAuthLoginOtpSession,
  logoutAuthLoginOtpSession,
  openAuthLoginOtpSession,
  resetAuthLoginOtpSessionState,
  resolveAuthLoginOtpSessionBaseURL,
  resolveAuthLoginOtpSessionCode,
  submitAuthLoginOtpSessionCredentials,
} from "./auth-login-otp-session-fixture";

test.beforeEach(async () => {
  await resetAuthLoginOtpSessionState();
});

test.afterEach(async () => {
  await resetAuthLoginOtpSessionState();
});

test("auth login otp session: manager can verify, stay authenticated, and logout", async ({
  page,
}) => {
  await openAuthLoginOtpSession(page);
  await submitAuthLoginOtpSessionCredentials(page);

  const otpCode = await resolveAuthLoginOtpSessionCode();
  await completeAuthLoginOtpSession(page, otpCode);

  const protectedUrl = new URL(
    "/store/payroll",
    resolveAuthLoginOtpSessionBaseURL(),
  ).toString();
  await page.goto(protectedUrl, { waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).pathname).toBe("/store/payroll");
  await expect(page.locator("main").first()).toBeVisible();

  await logoutAuthLoginOtpSession(page);

  await page.goto(protectedUrl, { waitUntil: "domcontentloaded" });
  await page.waitForURL((url) => url.pathname === "/login", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
});
