import { expect, test } from "@playwright/test";
import {
  DELIVERY_FINAL_SETTLEMENT_GATING_ENABLE_ENV,
  cleanupDeliveryFinalSettlementGatingQaState,
  createDeliveryFinalSettlementGatingCashierContext,
  expectDeliveryFinalSettlementGatingInitialDbState,
  expectDeliveryFinalSettlementGatingPostedDbState,
  isDeliveryFinalSettlementGatingEnabled,
  openDeliveryFinalSettlementGatingRunHubPage,
  resetDeliveryFinalSettlementGatingQaState,
  resolveDeliveryFinalSettlementGatingDbState,
  resolveDeliveryFinalSettlementGatingScenario,
} from "./delivery-final-settlement-gating-fixture";

test.describe("delivery final settlement gating", () => {
  test.skip(
    !isDeliveryFinalSettlementGatingEnabled(),
    `Run \`npm run qa:delivery:final-settlement-gating:setup\` first, then set ${DELIVERY_FINAL_SETTLEMENT_GATING_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryFinalSettlementGatingQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryFinalSettlementGatingQaState();
  });

  test("cashier can finalize a rider-accepted shortage settlement without creating duplicate artifacts", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryFinalSettlementGatingScenario();
    const initialState = await resolveDeliveryFinalSettlementGatingDbState();
    expectDeliveryFinalSettlementGatingInitialDbState(initialState, scenario);

    const cashierContext =
      await createDeliveryFinalSettlementGatingCashierContext(browser);

    try {
      const page = await cashierContext.newPage();

      await openDeliveryFinalSettlementGatingRunHubPage(page);

      await expect(
        page.getByText(scenario.closedRun.runCode, { exact: false }).first(),
      ).toBeVisible();
      await expect(
        page.getByText(/rider_accepted/i),
      ).toBeVisible();
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

      const postedState = await resolveDeliveryFinalSettlementGatingDbState();
      expectDeliveryFinalSettlementGatingPostedDbState(postedState, scenario);
    } finally {
      await cashierContext.close();
    }
  });
});
