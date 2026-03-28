import { expect, test, type BrowserContext } from "@playwright/test";
import {
  describeDeliveryCashierOrderRemitShortagePathPage,
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

async function closeContextSafely(context: BrowserContext) {
  await Promise.race([
    context.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

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
        page.getByText(scenario.remitOrder.orderCode, { exact: false }).first(),
      ).toBeVisible();
      const cashCollectedInput = page.getByLabel(/^Cash collected$/i);
      await expect(cashCollectedInput).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Post Remit(?: & Flag Variance)?$/i }),
      ).toBeEnabled();

      const printCheckbox = page.getByRole("checkbox", {
        name: /go to summary & print after posting/i,
      });
      await printCheckbox.uncheck();

      await cashCollectedInput.click();
      await cashCollectedInput.press("Meta+A");
      await cashCollectedInput.fill(scenario.shortageCashInput);
      await expect(cashCollectedInput).toHaveValue(scenario.shortageCashInput);
      await page
        .getByRole("button", { name: /^Post Remit(?: & Flag Variance)?$/i })
        .click();

      const redirectedToRunHub = await page
        .waitForURL(
          (target) =>
            target.pathname === `/cashier/delivery/${scenario.closedRun.id}`,
          {
            timeout: 10_000,
          },
        )
        .then(() => true)
        .catch(() => false);

      if (!redirectedToRunHub) {
        const pageState =
          await describeDeliveryCashierOrderRemitShortagePathPage(page);
        throw new Error(
          [
            "Post Remit did not redirect to the cashier run hub.",
            `Landed URL: ${pageState.url}`,
            `Pathname: ${pageState.pathname}`,
            `Heading: ${pageState.heading ?? "—"}`,
            `Body: ${pageState.bodySnippet || "—"}`,
          ].join("\n"),
        );
      }

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
      await closeContextSafely(cashierContext);
    }
  });
});
