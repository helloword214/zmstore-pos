import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveBaseURL } from "./session";

const AUTH_DIR = "test-results/ui/auth";

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

export async function loginByEmail(page: Page, email: string, password: string) {
  await openLogin(page);

  const emailTab = page.getByRole("button", { name: /email\s*&\s*password/i });
  if ((await emailTab.count()) > 0) {
    await emailTab.first().click();
  }

  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page
    .locator('form:has(input[name="mode"][value="EMAIL"]) button[type="submit"]')
    .click();

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20_000,
  });
  expect(new URL(page.url()).pathname).not.toBe("/login");
}

export async function loginByPin(page: Page, pin: string) {
  await openLogin(page);

  const pinInput = page.locator('input[name="pin"]');

  // Some pages boot into email mode first. Ensure PIN mode is active
  // before interacting with the PIN field to avoid flaky setup timeouts.
  if (
    (await pinInput.count()) === 0 ||
    !(await pinInput.first().isVisible().catch(() => false))
  ) {
    const pinTab = page.getByRole("button", { name: /cashier pin/i }).first();
    if ((await pinTab.count()) > 0) {
      await pinTab.click({ force: true });
    }
    await expect(pinInput).toBeVisible({ timeout: 10_000 });
  }

  await pinInput.fill(pin);
  await page
    .locator('form:has(input[name="mode"][value="PIN"]) button[type="submit"]')
    .click();

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20_000,
  });
  expect(new URL(page.url()).pathname).not.toBe("/login");
}
