import { expect, test } from "@playwright/test";
import {
  DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_ENABLE_ENV,
  cleanupDeliveryRunHandoffAndRemitAccessHappyPathQaState,
  createDeliveryRunHandoffAndRemitAccessHappyPathRoleContext,
  expectDeliveryRunHandoffAndRemitAccessHappyPathInitialDbState,
  expectDeliveryRunHandoffAndRemitAccessHappyPathManagerRedirectAwayFromRiderCheckin,
  isDeliveryRunHandoffAndRemitAccessHappyPathEnabled,
  openDeliveryRunHandoffAndRemitAccessHappyPathCashierRunRemitPage,
  openDeliveryRunHandoffAndRemitAccessHappyPathManagerRemitPage,
  openDeliveryRunHandoffAndRemitAccessHappyPathRiderCheckinPage,
  resetDeliveryRunHandoffAndRemitAccessHappyPathQaState,
  resolveDeliveryRunHandoffAndRemitAccessHappyPathDbState,
  resolveDeliveryRunHandoffAndRemitAccessHappyPathScenario,
} from "./delivery-run-handoff-and-remit-access-happy-path-fixture";

test.describe("delivery run handoff and remit access happy path", () => {
  test.skip(
    !isDeliveryRunHandoffAndRemitAccessHappyPathEnabled(),
    `Run \`npm run qa:delivery:run-handoff-and-remit-access:happy-path:setup\` first, then set ${DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryRunHandoffAndRemitAccessHappyPathQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryRunHandoffAndRemitAccessHappyPathQaState();
  });

  test("manager, assigned rider, and cashier can reach their deterministic delivery handoff routes", async ({
    browser,
  }) => {
    const scenario =
      await resolveDeliveryRunHandoffAndRemitAccessHappyPathScenario();
    const initialState =
      await resolveDeliveryRunHandoffAndRemitAccessHappyPathDbState();
    expectDeliveryRunHandoffAndRemitAccessHappyPathInitialDbState(
      initialState,
      scenario,
    );

    const managerContext =
      await createDeliveryRunHandoffAndRemitAccessHappyPathRoleContext(
        browser,
        "manager",
      );
    try {
      const managerPage = await managerContext.newPage();

      await openDeliveryRunHandoffAndRemitAccessHappyPathManagerRemitPage(
        managerPage,
      );
      await expect(
        managerPage.getByText(scenario.checkedInRun.runCode, { exact: false }),
      ).toBeVisible();

      await expectDeliveryRunHandoffAndRemitAccessHappyPathManagerRedirectAwayFromRiderCheckin(
        managerPage,
      );
    } finally {
      await managerContext.close();
    }

    const riderContext =
      await createDeliveryRunHandoffAndRemitAccessHappyPathRoleContext(
        browser,
        "rider",
      );
    try {
      const riderPage = await riderContext.newPage();

      await openDeliveryRunHandoffAndRemitAccessHappyPathRiderCheckinPage(
        riderPage,
      );
      await expect(
        riderPage.getByText(scenario.checkedInRun.runCode, { exact: false }),
      ).toBeVisible();
      await expect(
        riderPage.getByRole("button", { name: /submit check-in/i }),
      ).toBeVisible();
    } finally {
      await riderContext.close();
    }

    const cashierContext =
      await createDeliveryRunHandoffAndRemitAccessHappyPathRoleContext(
        browser,
        "cashier",
      );
    try {
      const cashierPage = await cashierContext.newPage();

      await openDeliveryRunHandoffAndRemitAccessHappyPathCashierRunRemitPage(
        cashierPage,
      );
      await expect(
        cashierPage.getByText(scenario.closedRun.runCode, { exact: false }),
      ).toBeVisible();
      await expect(
        cashierPage.getByText(/delivery order\(s\) to remit|all delivery orders for this run are settled\./i),
      ).toBeVisible();
    } finally {
      await cashierContext.close();
    }
  });
});
