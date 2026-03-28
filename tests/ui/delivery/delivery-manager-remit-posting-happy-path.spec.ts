import { expect, test } from "@playwright/test";
import {
  DELIVERY_MANAGER_REMIT_POSTING_HAPPY_PATH_ENABLE_ENV,
  cleanupDeliveryManagerRemitPostingHappyPathQaState,
  createDeliveryManagerRemitPostingHappyPathManagerContext,
  expectDeliveryManagerRemitPostingHappyPathInitialDbState,
  expectDeliveryManagerRemitPostingHappyPathPostedDbState,
  isDeliveryManagerRemitPostingHappyPathEnabled,
  openDeliveryManagerRemitPostingHappyPathManagerRemitPage,
  resetDeliveryManagerRemitPostingHappyPathQaState,
  resolveDeliveryManagerRemitPostingHappyPathDbState,
  resolveDeliveryManagerRemitPostingHappyPathScenario,
} from "./delivery-manager-remit-posting-happy-path-fixture";

test.describe("delivery manager remit posting happy path", () => {
  test.skip(
    !isDeliveryManagerRemitPostingHappyPathEnabled(),
    `Run \`npm run qa:delivery:manager-remit-posting:happy-path:setup\` first, then set ${DELIVERY_MANAGER_REMIT_POSTING_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryManagerRemitPostingHappyPathQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryManagerRemitPostingHappyPathQaState();
  });

  test("manager can approve a deterministic no-missing remit and land on the posted summary report", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryManagerRemitPostingHappyPathScenario();
    const initialState =
      await resolveDeliveryManagerRemitPostingHappyPathDbState();
    expectDeliveryManagerRemitPostingHappyPathInitialDbState(
      initialState,
      scenario,
    );

    const managerContext =
      await createDeliveryManagerRemitPostingHappyPathManagerContext(browser);

    try {
      const page = await managerContext.newPage();

      await openDeliveryManagerRemitPostingHappyPathManagerRemitPage(page);

      await expect(
        page.getByText(scenario.checkedInRun.runCode, { exact: false }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /^Approve Remit & Close Run$/i }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", {
          name: /charge rider \(missing stocks\) & close run/i,
        }),
      ).toBeDisabled();
      await expect(
        page.getByText(/No missing items selected\./i),
      ).toBeVisible();

      await page
        .getByRole("button", { name: /^Approve Remit & Close Run$/i })
        .click();

      await page.waitForURL(
        (target) =>
          target.pathname === `/runs/${scenario.checkedInRun.id}/summary` &&
          target.searchParams.get("posted") === "1",
        {
          timeout: 10_000,
        },
      );

      await expect(
        page.getByRole("heading", { name: /run summary report/i }),
      ).toBeVisible();
      await expect(
        page.getByText(scenario.checkedInRun.runCode, { exact: false }).first(),
      ).toBeVisible();

      const postedState =
        await resolveDeliveryManagerRemitPostingHappyPathDbState();
      expectDeliveryManagerRemitPostingHappyPathPostedDbState(
        postedState,
        scenario,
      );
    } finally {
      await managerContext.close();
    }
  });
});
