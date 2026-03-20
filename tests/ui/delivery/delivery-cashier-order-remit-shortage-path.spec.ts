import { expect, test } from "@playwright/test";
import {
  DELIVERY_CASHIER_ORDER_REMIT_SHORTAGE_PATH_ENABLE_ENV,
  cleanupDeliveryCashierOrderRemitShortagePathQaState,
  createDeliveryCashierOrderRemitShortagePathCashierContext,
  expectDeliveryCashierOrderRemitShortagePathInitialDbState,
  expectDeliveryCashierOrderRemitShortagePathPostedDbState,
  isDeliveryCashierOrderRemitShortagePathEnabled,
  openDeliveryCashierOrderRemitShortagePathOrderRemitPage,
  resetDeliveryCashierOrderRemitShortagePathQaState,
  resolveDeliveryCashierOrderRemitShortagePathDbState,
  resolveDeliveryCashierOrderRemitShortagePathScenario,
} from "./delivery-cashier-order-remit-shortage-path-fixture";

test.describe("delivery cashier order remit shortage path", () => {
  test.skip(
    !isDeliveryCashierOrderRemitShortagePathEnabled(),
    `Run \`npm run qa:delivery:cashier-order-remit-shortage-path:setup\` first, then set ${DELIVERY_CASHIER_ORDER_REMIT_SHORTAGE_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryCashierOrderRemitShortagePathQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryCashierOrderRemitShortagePathQaState();
  });

  test("cashier can post a short closed-run delivery remit and create the rider shortage bridge", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryCashierOrderRemitShortagePathScenario();
    const initialState =
      await resolveDeliveryCashierOrderRemitShortagePathDbState();
    expectDeliveryCashierOrderRemitShortagePathInitialDbState(
      initialState,
      scenario,
    );

    const cashierContext =
      await createDeliveryCashierOrderRemitShortagePathCashierContext(browser);

    try {
      const page = await cashierContext.newPage();

      await openDeliveryCashierOrderRemitShortagePathOrderRemitPage(page);

      await expect(
        page.getByText(scenario.remitOrder.orderCode, { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText(scenario.exactCashLabel, { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Post Remit$/i }),
      ).toBeEnabled();

      const printCheckbox = page.getByRole("checkbox", {
        name: /go to summary & print after posting/i,
      });
      await printCheckbox.uncheck();

      await page.getByLabel(/^Cash collected$/i).fill(
        scenario.shortageCashInput,
      );
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
        await resolveDeliveryCashierOrderRemitShortagePathDbState();
      expectDeliveryCashierOrderRemitShortagePathPostedDbState(
        postedState,
        scenario,
      );
    } finally {
      await cashierContext.close();
    }
  });
});
