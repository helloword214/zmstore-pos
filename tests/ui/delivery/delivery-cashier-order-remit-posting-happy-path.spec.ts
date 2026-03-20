import { expect, test } from "@playwright/test";
import {
  DELIVERY_CASHIER_ORDER_REMIT_POSTING_HAPPY_PATH_ENABLE_ENV,
  cleanupDeliveryCashierOrderRemitPostingHappyPathQaState,
  createDeliveryCashierOrderRemitPostingHappyPathCashierContext,
  expectDeliveryCashierOrderRemitPostingHappyPathInitialDbState,
  expectDeliveryCashierOrderRemitPostingHappyPathPostedDbState,
  isDeliveryCashierOrderRemitPostingHappyPathEnabled,
  openDeliveryCashierOrderRemitPostingHappyPathOrderRemitPage,
  resetDeliveryCashierOrderRemitPostingHappyPathQaState,
  resolveDeliveryCashierOrderRemitPostingHappyPathDbState,
  resolveDeliveryCashierOrderRemitPostingHappyPathScenario,
} from "./delivery-cashier-order-remit-posting-happy-path-fixture";

test.describe("delivery cashier order remit posting happy path", () => {
  test.skip(
    !isDeliveryCashierOrderRemitPostingHappyPathEnabled(),
    `Run \`npm run qa:delivery:cashier-order-remit-posting:happy-path:setup\` first, then set ${DELIVERY_CASHIER_ORDER_REMIT_POSTING_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryCashierOrderRemitPostingHappyPathQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryCashierOrderRemitPostingHappyPathQaState();
  });

  test("cashier can post an exact closed-run delivery remit and return to the run hub", async ({
    browser,
  }) => {
    const scenario =
      await resolveDeliveryCashierOrderRemitPostingHappyPathScenario();
    const initialState =
      await resolveDeliveryCashierOrderRemitPostingHappyPathDbState();
    expectDeliveryCashierOrderRemitPostingHappyPathInitialDbState(
      initialState,
      scenario,
    );

    const cashierContext =
      await createDeliveryCashierOrderRemitPostingHappyPathCashierContext(
        browser,
      );

    try {
      const page = await cashierContext.newPage();

      await openDeliveryCashierOrderRemitPostingHappyPathOrderRemitPage(page);

      await expect(
        page.getByText(scenario.remitOrder.orderCode, { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText(scenario.cashGivenLabel, { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Post Remit$/i }),
      ).toBeEnabled();

      const printCheckbox = page.getByRole("checkbox", {
        name: /go to summary & print after posting/i,
      });
      await printCheckbox.uncheck();

      await page.getByLabel(/^Cash collected$/i).fill(scenario.cashGivenInput);
      await page.getByRole("button", { name: /^Post Remit$/i }).click();

      await page.waitForURL(
        (target) =>
          target.pathname === `/cashier/delivery/${scenario.closedRun.id}`,
        {
          timeout: 10_000,
        },
      );

      await expect(
        page.getByRole("heading", { name: /delivery run remit/i }),
      ).toBeVisible();
      await expect(
        page.getByText(/all delivery orders for this run are settled\./i),
      ).toBeVisible();

      const postedState =
        await resolveDeliveryCashierOrderRemitPostingHappyPathDbState();
      expectDeliveryCashierOrderRemitPostingHappyPathPostedDbState(
        postedState,
        scenario,
      );
    } finally {
      await cashierContext.close();
    }
  });
});
