import { expect, test } from "@playwright/test";
import { loginByPin, persistStorageState, resolveAuthStateFile } from "./helpers/auth";

test("setup cashier auth state", async ({ page }) => {
  const pin = process.env.UI_CASHIER_PIN ?? "111111";
  const expectedHome = process.env.UI_CASHIER_HOME_PATH ?? "/cashier";
  const stateFile = resolveAuthStateFile("UI_CASHIER_STATE_FILE", "cashier.json");

  await loginByPin(page, pin);

  const pathname = new URL(page.url()).pathname;
  expect(pathname.startsWith(expectedHome), `Expected home: ${expectedHome}`).toBe(
    true,
  );

  await persistStorageState(page, stateFile);
});

