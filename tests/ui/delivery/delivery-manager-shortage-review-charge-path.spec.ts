import { expect, test } from "@playwright/test";
import {
  DELIVERY_MANAGER_SHORTAGE_REVIEW_CHARGE_PATH_ENABLE_ENV,
  cleanupDeliveryManagerShortageReviewChargePathQaState,
  createDeliveryManagerShortageReviewChargePathManagerContext,
  expectDeliveryManagerShortageReviewChargePathInitialDbState,
  expectDeliveryManagerShortageReviewChargePathPostedDbState,
  isDeliveryManagerShortageReviewChargePathEnabled,
  openDeliveryManagerShortageReviewChargePathReviewPage,
  resetDeliveryManagerShortageReviewChargePathQaState,
  resolveDeliveryManagerShortageReviewChargePathDbState,
  resolveDeliveryManagerShortageReviewChargePathScenario,
} from "./delivery-manager-shortage-review-charge-path-fixture";

test.describe("delivery manager shortage review charge path", () => {
  test.skip(
    !isDeliveryManagerShortageReviewChargePathEnabled(),
    `Run \`npm run qa:delivery:manager-shortage-review-charge-path:setup\` first, then set ${DELIVERY_MANAGER_SHORTAGE_REVIEW_CHARGE_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryManagerShortageReviewChargePathQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryManagerShortageReviewChargePathQaState();
  });

  test("manager can charge rider from the open shortage review queue", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryManagerShortageReviewChargePathScenario();
    const initialState =
      await resolveDeliveryManagerShortageReviewChargePathDbState();
    expectDeliveryManagerShortageReviewChargePathInitialDbState(
      initialState,
      scenario,
    );

    const managerContext =
      await createDeliveryManagerShortageReviewChargePathManagerContext(browser);

    try {
      const page = await managerContext.newPage();

      await openDeliveryManagerShortageReviewChargePathReviewPage(page);

      const row = page.locator("tr").filter({
        hasText: scenario.closedRun.runCode,
      }).first();

      await expect(row).toBeVisible();
      await expect(row.getByText(`ref #${scenario.varianceId}`)).toBeVisible();
      await row.getByLabel(/^Decision$/i).click();
      await page
        .getByRole("option", {
          name: /^Charge rider \(needs rider accept\)$/i,
        })
        .click();
      await row.locator('input[name="note"]').fill(scenario.decisionNote);
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

      await page.goto(new URL(scenario.awaitingRoute, page.url()).toString(), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(
        (target) =>
          target.pathname === "/store/rider-variances" &&
          target.searchParams.get("tab") === "awaiting",
        {
          timeout: 10_000,
        },
      );

      const awaitingRow = page.locator("tr").filter({
        hasText: scenario.closedRun.runCode,
      }).first();

      await expect(awaitingRow).toBeVisible();
      await expect(awaitingRow.getByText(/MANAGER_APPROVED/i)).toBeVisible();
      await expect(awaitingRow.getByText(/CHARGE_RIDER/i)).toBeVisible();
      await expect(awaitingRow.getByText(scenario.decisionNote)).toBeVisible();
      await expect(
        awaitingRow.getByRole("link", { name: /view rider page/i }),
      ).toBeVisible();

      const postedState =
        await resolveDeliveryManagerShortageReviewChargePathDbState();
      expectDeliveryManagerShortageReviewChargePathPostedDbState(
        postedState,
        scenario,
      );
    } finally {
      await managerContext.close();
    }
  });
});
