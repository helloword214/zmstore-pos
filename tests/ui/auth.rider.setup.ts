import { expect, test } from "@playwright/test";
import {
  loginByEmail,
  persistStorageState,
  resolveAuthStateFile,
} from "./helpers/auth";

test("setup rider auth state", async ({ page }) => {
  const email = process.env.UI_RIDER_EMAIL ?? "rider1@local";
  const password = process.env.UI_RIDER_PASSWORD ?? "rider1123";
  const expectedHome = process.env.UI_RIDER_HOME_PATH ?? "/rider";
  const stateFile = resolveAuthStateFile("UI_RIDER_STATE_FILE", "rider.json");

  await loginByEmail(page, email, password);

  const pathname = new URL(page.url()).pathname;
  expect(pathname.startsWith(expectedHome), `Expected home: ${expectedHome}`).toBe(
    true,
  );

  await persistStorageState(page, stateFile);
});

