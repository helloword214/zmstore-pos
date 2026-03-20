import { expect, test } from "@playwright/test";
import {
  DELIVERY_MANAGER_SHORTAGE_WAIVE_INFO_ONLY_PATH_ENABLE_ENV,
  cleanupDeliveryManagerShortageWaiveInfoOnlyPathQaState,
  createDeliveryManagerShortageWaiveInfoOnlyPathManagerContext,
  expectDeliveryManagerShortageWaiveInfoOnlyPathInitialDbState,
  expectDeliveryManagerShortageWaiveInfoOnlyPathPostedDbState,
  isDeliveryManagerShortageWaiveInfoOnlyPathEnabled,
  openDeliveryManagerShortageWaiveInfoOnlyPathReviewPage,
  resetDeliveryManagerShortageWaiveInfoOnlyPathQaState,
  resolveDeliveryManagerShortageWaiveInfoOnlyPathDbState,
  resolveDeliveryManagerShortageWaiveInfoOnlyPathScenario,
} from "./delivery-manager-shortage-waive-info-only-path-fixture";

test.describe("delivery manager shortage waive/info-only path", () => {
  test.skip(
    !isDeliveryManagerShortageWaiveInfoOnlyPathEnabled(),
    `Run \`npm run qa:delivery:manager-shortage-waive-info-only-path:setup\` first, then set ${DELIVERY_MANAGER_SHORTAGE_WAIVE_INFO_ONLY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryManagerShortageWaiveInfoOnlyPathQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryManagerShortageWaiveInfoOnlyPathQaState();
  });

  test("manager can clear a shortage as info only without rider acceptance", async ({
    browser,
  }) => {
    const scenario =
      await resolveDeliveryManagerShortageWaiveInfoOnlyPathScenario();
    const initialState =
      await resolveDeliveryManagerShortageWaiveInfoOnlyPathDbState();
    expectDeliveryManagerShortageWaiveInfoOnlyPathInitialDbState(
      initialState,
      scenario,
    );

    const managerContext =
      await createDeliveryManagerShortageWaiveInfoOnlyPathManagerContext(browser);

    try {
      const page = await managerContext.newPage();

      await openDeliveryManagerShortageWaiveInfoOnlyPathReviewPage(page);

      const row = page.locator("tr").filter({
        hasText: scenario.closedRun.runCode,
      }).first();

      await expect(row).toBeVisible();
      await expect(row.getByText(`ref #${scenario.varianceId}`)).toBeVisible();
      await row.locator('select[name="resolution"]').selectOption("INFO_ONLY");
      await row.locator('input[name="note"]').fill(scenario.infoOnlyDecisionNote);
      await row
        .getByRole("button", { name: /^Save decision$/i })
        .click();

      await page.waitForURL(
        (target) =>
          target.pathname === "/store/rider-variances" &&
          !target.searchParams.get("tab"),
        {
          timeout: 10_000,
        },
      );

      await expect(
        page.getByRole("heading", { name: /rider variances/i }),
      ).toBeVisible();
      await expect(
        page.locator("tr").filter({ hasText: scenario.closedRun.runCode }),
      ).toHaveCount(0);

      await page.goto(new URL(scenario.historyRoute, page.url()).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(
        (target) =>
          target.pathname === "/store/rider-variances" &&
          target.searchParams.get("tab") === "history",
        {
          timeout: 10_000,
        },
      );

      const historyRow = page.locator("tr").filter({
        hasText: scenario.closedRun.runCode,
      }).first();

      await expect(historyRow).toBeVisible();
      await expect(historyRow.getByText(/MANAGER_APPROVED/i)).toBeVisible();
      await expect(
        historyRow.getByText(/resolution:\s*INFO_ONLY/i),
      ).toBeVisible();
      await expect(
        historyRow.getByText(scenario.infoOnlyDecisionNote),
      ).toBeVisible();
      await expect(
        historyRow.getByRole("link", { name: /view rider page/i }),
      ).toHaveCount(0);

      const postedState =
        await resolveDeliveryManagerShortageWaiveInfoOnlyPathDbState();
      expectDeliveryManagerShortageWaiveInfoOnlyPathPostedDbState(
        postedState,
        scenario,
        "INFO_ONLY",
      );
    } finally {
      await managerContext.close();
    }
  });

  test("manager can waive a shortage without leaving rider charge work active", async ({
    browser,
  }) => {
    const scenario =
      await resolveDeliveryManagerShortageWaiveInfoOnlyPathScenario();
    const initialState =
      await resolveDeliveryManagerShortageWaiveInfoOnlyPathDbState();
    expectDeliveryManagerShortageWaiveInfoOnlyPathInitialDbState(
      initialState,
      scenario,
    );

    const managerContext =
      await createDeliveryManagerShortageWaiveInfoOnlyPathManagerContext(browser);

    try {
      const page = await managerContext.newPage();

      await openDeliveryManagerShortageWaiveInfoOnlyPathReviewPage(page);

      const row = page.locator("tr").filter({
        hasText: scenario.closedRun.runCode,
      }).first();

      await expect(row).toBeVisible();
      await expect(row.getByText(`ref #${scenario.varianceId}`)).toBeVisible();
      await row.locator('select[name="resolution"]').selectOption("WAIVE");
      await row.locator('input[name="note"]').fill(scenario.waiveDecisionNote);
      await row
        .getByRole("button", { name: /^Save decision$/i })
        .click();

      await page.waitForURL(
        (target) =>
          target.pathname === "/store/rider-variances" &&
          !target.searchParams.get("tab"),
        {
          timeout: 10_000,
        },
      );

      await expect(
        page.getByRole("heading", { name: /rider variances/i }),
      ).toBeVisible();
      await expect(
        page.locator("tr").filter({ hasText: scenario.closedRun.runCode }),
      ).toHaveCount(0);

      await page.goto(new URL(scenario.historyRoute, page.url()).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(
        (target) =>
          target.pathname === "/store/rider-variances" &&
          target.searchParams.get("tab") === "history",
        {
          timeout: 10_000,
        },
      );

      const historyRow = page.locator("tr").filter({
        hasText: scenario.closedRun.runCode,
      }).first();

      await expect(historyRow).toBeVisible();
      await expect(historyRow.getByText(/WAIVED/i)).toBeVisible();
      await expect(
        historyRow.getByText(/resolution:\s*WAIVE/i),
      ).toBeVisible();
      await expect(historyRow.getByText(scenario.waiveDecisionNote)).toBeVisible();
      await expect(
        historyRow.getByRole("link", { name: /view rider page/i }),
      ).toHaveCount(0);

      const postedState =
        await resolveDeliveryManagerShortageWaiveInfoOnlyPathDbState();
      expectDeliveryManagerShortageWaiveInfoOnlyPathPostedDbState(
        postedState,
        scenario,
        "WAIVE",
      );
    } finally {
      await managerContext.close();
    }
  });
});
