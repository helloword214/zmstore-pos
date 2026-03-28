import { expect, test } from "@playwright/test";
import {
  DELIVERY_RIDER_ACCEPTANCE_PATH_ENABLE_ENV,
  cleanupDeliveryRiderAcceptancePathQaState,
  createDeliveryRiderAcceptancePathRiderContext,
  expectDeliveryRiderAcceptancePathInitialDbState,
  expectDeliveryRiderAcceptancePathPostedDbState,
  isDeliveryRiderAcceptancePathEnabled,
  openDeliveryRiderAcceptancePathPage,
  resetDeliveryRiderAcceptancePathQaState,
  resolveDeliveryRiderAcceptancePathDbState,
  resolveDeliveryRiderAcceptancePathScenario,
} from "./delivery-rider-acceptance-path-fixture";

test.describe("delivery rider acceptance path", () => {
  test.skip(
    !isDeliveryRiderAcceptancePathEnabled(),
    `Run \`npm run qa:delivery:rider-acceptance-path:setup\` first, then set ${DELIVERY_RIDER_ACCEPTANCE_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryRiderAcceptancePathQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryRiderAcceptancePathQaState();
  });

  test("rider can accept a manager-approved shortage charge", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryRiderAcceptancePathScenario();
    const initialState = await resolveDeliveryRiderAcceptancePathDbState();
    expectDeliveryRiderAcceptancePathInitialDbState(initialState, scenario);

    const riderContext =
      await createDeliveryRiderAcceptancePathRiderContext(browser);

    try {
      const page = await riderContext.newPage();

      await openDeliveryRiderAcceptancePathPage(page);

      await expect(
        page.getByText(scenario.closedRun.runCode, { exact: false }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("charge rider", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Accept variance$/i }),
      ).toBeVisible();

      await page.getByRole("button", { name: /^Accept variance$/i }).click();

      await page.waitForURL(
        (target) =>
          target.pathname === "/rider/variances" &&
          target.searchParams.get("accepted") === "1",
        {
          timeout: 10_000,
        },
      );

      await expect(
        page.getByRole("heading", { name: /pending variances/i }),
      ).toBeVisible();
      await expect(
        page.getByText(/no pending acceptances\./i),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Accept variance$/i }),
      ).toHaveCount(0);

      const postedState = await resolveDeliveryRiderAcceptancePathDbState();
      expectDeliveryRiderAcceptancePathPostedDbState(postedState, scenario);
    } finally {
      await riderContext.close();
    }
  });
});
