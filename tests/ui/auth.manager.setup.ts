import { expect, test } from "@playwright/test";
import {
  loginByEmail,
  persistStorageState,
  resolveAuthStateFile,
} from "./helpers/auth";

test("setup manager auth state", async ({ page }) => {
  const email = process.env.UI_MANAGER_EMAIL ?? "manager1@local";
  const password = process.env.UI_MANAGER_PASSWORD ?? "manager1123";
  const expectedHome = process.env.UI_MANAGER_HOME_PATH ?? "/store";
  const stateFile = resolveAuthStateFile("UI_MANAGER_STATE_FILE", "manager.json");

  await loginByEmail(page, email, password);

  const pathname = new URL(page.url()).pathname;
  expect(pathname.startsWith(expectedHome), `Expected home: ${expectedHome}`).toBe(
    true,
  );

  await persistStorageState(page, stateFile);
});

