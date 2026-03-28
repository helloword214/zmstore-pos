import { expect, test } from "@playwright/test";
import {
  DELIVERY_FINAL_SETTLEMENT_INFO_ONLY_WAIVE_PATH_ENABLE_ENV,
  cleanupDeliveryFinalSettlementInfoOnlyWaivePathQaState,
  createDeliveryFinalSettlementInfoOnlyWaivePathCashierContext,
  expectDeliveryFinalSettlementInfoOnlyWaivePathInitialDbState,
  expectDeliveryFinalSettlementInfoOnlyWaivePathPostedDbState,
  isDeliveryFinalSettlementInfoOnlyWaivePathEnabled,
  openDeliveryFinalSettlementInfoOnlyWaivePathRunHubPage,
  resetDeliveryFinalSettlementInfoOnlyWaivePathQaState,
  resolveDeliveryFinalSettlementInfoOnlyWaivePathDbState,
  resolveDeliveryFinalSettlementInfoOnlyWaivePathScenario,
} from "./delivery-final-settlement-info-only-waive-path-fixture";

test.describe("delivery final settlement info-only/waive path", () => {
  test.skip(
    !isDeliveryFinalSettlementInfoOnlyWaivePathEnabled(),
    `Run \`npm run qa:delivery:final-settlement-info-only-waive-path:setup\` first, then set ${DELIVERY_FINAL_SETTLEMENT_INFO_ONLY_WAIVE_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.afterEach(async () => {
    await cleanupDeliveryFinalSettlementInfoOnlyWaivePathQaState();
  });

  test("cashier can finalize an info-only shortage settlement without creating duplicate artifacts", async ({
    browser,
  }) => {
    await resetDeliveryFinalSettlementInfoOnlyWaivePathQaState("INFO_ONLY");
    const scenario =
      await resolveDeliveryFinalSettlementInfoOnlyWaivePathScenario();
    const initialState =
      await resolveDeliveryFinalSettlementInfoOnlyWaivePathDbState();

    expectDeliveryFinalSettlementInfoOnlyWaivePathInitialDbState(
      initialState,
      scenario,
      "INFO_ONLY",
    );

    const cashierContext =
      await createDeliveryFinalSettlementInfoOnlyWaivePathCashierContext(
        browser,
      );

    try {
      const page = await cashierContext.newPage();

      await openDeliveryFinalSettlementInfoOnlyWaivePathRunHubPage(page);

      await expect(
        page.getByText(scenario.closedRun.runCode, { exact: false }).first(),
      ).toBeVisible();
      await expect(page.getByText(/MANAGER_APPROVED/i)).toBeVisible();
      await expect(
        page.getByRole("link", { name: /rider acceptance/i }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/all delivery orders for this run are settled\./i),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Finalize run settlement$/i }),
      ).toBeEnabled();

      await page
        .getByRole("button", { name: /^Finalize run settlement$/i })
        .click();

      await page.waitForURL(
        (target) =>
          target.pathname === "/cashier/delivery" &&
          target.searchParams.get("settled") === "1" &&
          target.searchParams.get("runId") === String(scenario.closedRun.id),
        {
          timeout: 10_000,
        },
      );

      await page.goto(new URL(scenario.settlementRoute, page.url()).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(
        (target) => target.pathname === `/cashier/delivery/${scenario.closedRun.id}`,
        {
          timeout: 10_000,
        },
      );

      await expect(
        page.getByText(/this run is fully settled\./i),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Finalize run settlement$/i }),
      ).toHaveCount(0);

      const postedState =
        await resolveDeliveryFinalSettlementInfoOnlyWaivePathDbState();
      expectDeliveryFinalSettlementInfoOnlyWaivePathPostedDbState(
        postedState,
        scenario,
        "INFO_ONLY",
      );
    } finally {
      await cashierContext.close();
    }
  });

  test("cashier can finalize a waived shortage settlement without leaving rider charge work active", async ({
    browser,
  }) => {
    await resetDeliveryFinalSettlementInfoOnlyWaivePathQaState("WAIVE");
    const scenario =
      await resolveDeliveryFinalSettlementInfoOnlyWaivePathScenario();
    const initialState =
      await resolveDeliveryFinalSettlementInfoOnlyWaivePathDbState();

    expectDeliveryFinalSettlementInfoOnlyWaivePathInitialDbState(
      initialState,
      scenario,
      "WAIVE",
    );

    const cashierContext =
      await createDeliveryFinalSettlementInfoOnlyWaivePathCashierContext(
        browser,
      );

    try {
      const page = await cashierContext.newPage();

      await openDeliveryFinalSettlementInfoOnlyWaivePathRunHubPage(page);

      await expect(
        page.getByText(scenario.closedRun.runCode, { exact: false }).first(),
      ).toBeVisible();
      await expect(page.getByText(/WAIVED/i)).toBeVisible();
      await expect(
        page.getByRole("link", { name: /rider acceptance/i }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/all delivery orders for this run are settled\./i),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Finalize run settlement$/i }),
      ).toBeEnabled();

      await page
        .getByRole("button", { name: /^Finalize run settlement$/i })
        .click();

      await page.waitForURL(
        (target) =>
          target.pathname === "/cashier/delivery" &&
          target.searchParams.get("settled") === "1" &&
          target.searchParams.get("runId") === String(scenario.closedRun.id),
        {
          timeout: 10_000,
        },
      );

      await page.goto(new URL(scenario.settlementRoute, page.url()).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(
        (target) => target.pathname === `/cashier/delivery/${scenario.closedRun.id}`,
        {
          timeout: 10_000,
        },
      );

      await expect(
        page.getByText(/this run is fully settled\./i),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Finalize run settlement$/i }),
      ).toHaveCount(0);

      const postedState =
        await resolveDeliveryFinalSettlementInfoOnlyWaivePathDbState();
      expectDeliveryFinalSettlementInfoOnlyWaivePathPostedDbState(
        postedState,
        scenario,
        "WAIVE",
      );
    } finally {
      await cashierContext.close();
    }
  });
});
