import { expect, test } from "@playwright/test";
import {
  DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_ENABLE_ENV,
  cleanupDeliveryOrderAttemptOutcomePathQaState,
  createDeliveryOrderAttemptOutcomePathRoleContext,
  expectDeliveryOrderAttemptOutcomePathCancelledDbState,
  expectDeliveryOrderAttemptOutcomePathInitialDbState,
  expectDeliveryOrderAttemptOutcomePathMissingChargeDbState,
  expectDeliveryOrderAttemptOutcomePathReattemptDbState,
  finalizeDeliveryOrderAttemptOutcomeOnManagerRemit,
  isDeliveryOrderAttemptOutcomePathEnabled,
  openDeliveryOrderAttemptOutcomePathCashierRunRemitPage,
  openDeliveryOrderAttemptOutcomePathDispatchPage,
  openDeliveryOrderAttemptOutcomePathManagerRemitPage,
  openDeliveryOrderAttemptOutcomePathRiderCheckinPage,
  resetDeliveryOrderAttemptOutcomePathQaState,
  resolveDeliveryOrderAttemptOutcomePathDbState,
  resolveDeliveryOrderAttemptOutcomePathScenario,
  submitDeliveryOrderAttemptOutcomeRiderCheckin,
} from "./delivery-order-attempt-outcome-path-fixture";

test.describe("delivery order attempt outcome path", () => {
  test.skip(
    !isDeliveryOrderAttemptOutcomePathEnabled(),
    `Run \`npm run qa:delivery:order-attempt-outcome-path:setup\` first, then set ${DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryOrderAttemptOutcomePathQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryOrderAttemptOutcomePathQaState();
  });

  test("rider and manager can return a no-release order back to dispatch", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
    const initialState = await resolveDeliveryOrderAttemptOutcomePathDbState();
    const note = "QA no-release reattempt";

    expectDeliveryOrderAttemptOutcomePathInitialDbState(initialState, scenario);

    const riderContext = await createDeliveryOrderAttemptOutcomePathRoleContext(
      browser,
      "rider",
    );
    const managerContext =
      await createDeliveryOrderAttemptOutcomePathRoleContext(browser, "manager");
    const cashierContext =
      await createDeliveryOrderAttemptOutcomePathRoleContext(browser, "cashier");

    try {
      const riderPage = await riderContext.newPage();
      await openDeliveryOrderAttemptOutcomePathRiderCheckinPage(riderPage);
      await expect(
        riderPage.getByText(scenario.activeRun.runCode, { exact: false }),
      ).toBeVisible();
      await expect(
        riderPage.getByText(/return to dispatch/i),
      ).toBeVisible();

      await submitDeliveryOrderAttemptOutcomeRiderCheckin({
        page: riderPage,
        scenario,
        outcome: "NO_RELEASE_REATTEMPT",
        note,
      });

      const managerPage = await managerContext.newPage();
      await openDeliveryOrderAttemptOutcomePathManagerRemitPage(managerPage);
      await expect(managerPage.getByText(/no release attempt/i)).toBeVisible();
      await expect(
        managerPage.getByText(/rider reported: return to dispatch/i),
      ).toBeVisible();

      await finalizeDeliveryOrderAttemptOutcomeOnManagerRemit({
        page: managerPage,
        scenario,
        outcome: "NO_RELEASE_REATTEMPT",
        markMissing: false,
      });

      const postedState = await resolveDeliveryOrderAttemptOutcomePathDbState();
      expectDeliveryOrderAttemptOutcomePathReattemptDbState({
        note,
        scenario,
        state: postedState,
      });

      await openDeliveryOrderAttemptOutcomePathDispatchPage(managerPage);
      await expect(
        managerPage.getByText(scenario.activeOrder.orderCode, { exact: false }),
      ).toBeVisible();

      const cashierPage = await cashierContext.newPage();
      await openDeliveryOrderAttemptOutcomePathCashierRunRemitPage(cashierPage);
      await expect(
        cashierPage.getByText(/0 orders on this run/i),
      ).toBeVisible();
      await expect(
        cashierPage.getByText(/no delivery orders attached to this run\./i),
      ).toBeVisible();
    } finally {
      await Promise.allSettled([
        riderContext.close(),
        managerContext.close(),
        cashierContext.close(),
      ]);
    }
  });

  test("rider and manager can cancel a no-release order before release", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
    const initialState = await resolveDeliveryOrderAttemptOutcomePathDbState();
    const note = "QA no-release cancel";

    expectDeliveryOrderAttemptOutcomePathInitialDbState(initialState, scenario);

    const riderContext = await createDeliveryOrderAttemptOutcomePathRoleContext(
      browser,
      "rider",
    );
    const managerContext =
      await createDeliveryOrderAttemptOutcomePathRoleContext(browser, "manager");
    const cashierContext =
      await createDeliveryOrderAttemptOutcomePathRoleContext(browser, "cashier");

    try {
      const riderPage = await riderContext.newPage();
      await openDeliveryOrderAttemptOutcomePathRiderCheckinPage(riderPage);

      await submitDeliveryOrderAttemptOutcomeRiderCheckin({
        page: riderPage,
        scenario,
        outcome: "NO_RELEASE_CANCELLED",
        note,
      });

      const managerPage = await managerContext.newPage();
      await openDeliveryOrderAttemptOutcomePathManagerRemitPage(managerPage);
      await expect(
        managerPage.getByText(/rider reported: cancel before release/i),
      ).toBeVisible();

      await finalizeDeliveryOrderAttemptOutcomeOnManagerRemit({
        page: managerPage,
        scenario,
        outcome: "NO_RELEASE_CANCELLED",
        markMissing: false,
      });

      const postedState = await resolveDeliveryOrderAttemptOutcomePathDbState();
      expectDeliveryOrderAttemptOutcomePathCancelledDbState({
        note,
        scenario,
        state: postedState,
      });

      await openDeliveryOrderAttemptOutcomePathDispatchPage(managerPage);
      await expect(
        managerPage.getByText(scenario.activeOrder.orderCode, { exact: false }),
      ).toHaveCount(0);

      const cashierPage = await cashierContext.newPage();
      await openDeliveryOrderAttemptOutcomePathCashierRunRemitPage(cashierPage);
      await expect(
        cashierPage.getByText(/0 orders on this run/i),
      ).toBeVisible();
      await expect(
        cashierPage.getByText(/no delivery orders attached to this run\./i),
      ).toBeVisible();
    } finally {
      await Promise.allSettled([
        riderContext.close(),
        managerContext.close(),
        cashierContext.close(),
      ]);
    }
  });

  test("manager can charge rider for missing stock without routing the no-release attempt into CCS", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
    const initialState = await resolveDeliveryOrderAttemptOutcomePathDbState();
    const note = "QA no-release missing stock";

    expectDeliveryOrderAttemptOutcomePathInitialDbState(initialState, scenario);

    const riderContext = await createDeliveryOrderAttemptOutcomePathRoleContext(
      browser,
      "rider",
    );
    const managerContext =
      await createDeliveryOrderAttemptOutcomePathRoleContext(browser, "manager");
    const cashierContext =
      await createDeliveryOrderAttemptOutcomePathRoleContext(browser, "cashier");

    try {
      const riderPage = await riderContext.newPage();
      await openDeliveryOrderAttemptOutcomePathRiderCheckinPage(riderPage);

      await submitDeliveryOrderAttemptOutcomeRiderCheckin({
        page: riderPage,
        scenario,
        outcome: "NO_RELEASE_REATTEMPT",
        note,
      });

      const managerPage = await managerContext.newPage();
      await openDeliveryOrderAttemptOutcomePathManagerRemitPage(managerPage);

      await finalizeDeliveryOrderAttemptOutcomeOnManagerRemit({
        page: managerPage,
        scenario,
        outcome: "NO_RELEASE_REATTEMPT",
        markMissing: true,
      });

      const postedState = await resolveDeliveryOrderAttemptOutcomePathDbState();
      expectDeliveryOrderAttemptOutcomePathMissingChargeDbState({
        note,
        scenario,
        state: postedState,
      });

      await openDeliveryOrderAttemptOutcomePathDispatchPage(managerPage);
      await expect(
        managerPage.getByText(scenario.activeOrder.orderCode, { exact: false }),
      ).toBeVisible();

      const cashierPage = await cashierContext.newPage();
      await openDeliveryOrderAttemptOutcomePathCashierRunRemitPage(cashierPage);
      await expect(
        cashierPage.getByText(/0 orders on this run/i),
      ).toBeVisible();
      await expect(
        cashierPage.getByText(/no delivery orders attached to this run\./i),
      ).toBeVisible();
    } finally {
      await Promise.allSettled([
        riderContext.close(),
        managerContext.close(),
        cashierContext.close(),
      ]);
    }
  });
});
