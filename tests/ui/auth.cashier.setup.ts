import { expect, test } from "@playwright/test";
import { loginByEmail, persistStorageState, resolveAuthStateFile } from "./helpers/auth";

test("setup cashier auth state", async ({ page }) => {
  const email = process.env.UI_CASHIER_EMAIL ?? "cashier1@local";
  const password = process.env.UI_CASHIER_PASSWORD ?? "cashier1123";
  const expectedHome = process.env.UI_CASHIER_HOME_PATH ?? "/cashier";
  const stateFile = resolveAuthStateFile("UI_CASHIER_STATE_FILE", "cashier.json");

  await loginByEmail(page, email, password, {
    otpEnvKey: "UI_CASHIER_OTP_CODE",
  });

  const pathname = new URL(page.url()).pathname;
  expect(pathname.startsWith(expectedHome), `Expected home: ${expectedHome}`).toBe(
    true,
  );

  await persistStorageState(page, stateFile);
});
