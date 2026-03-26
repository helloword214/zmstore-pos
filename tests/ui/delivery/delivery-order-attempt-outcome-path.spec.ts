import { expect, test } from "@playwright/test";
import {
  DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_ENABLE_ENV,
  cleanupDeliveryOrderAttemptOutcomePathQaState,
  createDeliveryOrderAttemptOutcomePathRoleContext,
  expectDeliveryOrderAttemptOutcomePathCancelledDbState,
  expectDeliveryOrderAttemptOutcomePathInitialDbState,
  expectDeliveryOrderAttemptOutcomePathMissingChargeDbState,
  expectDeliveryOrderAttemptOutcomePathPendingDispatchReviewDbState,
  expectDeliveryOrderAttemptOutcomePathReattemptDbState,
  finalizeDeliveryOrderAttemptOutcomeOnManagerRemit,
  isDeliveryOrderAttemptOutcomePathEnabled,
  openDeliveryOrderAttemptOutcomePathCashierRunRemitPage,
  openDeliveryOrderAttemptOutcomePathDispatchPage,
  openDeliveryOrderAttemptOutcomePathManagerRemitPage,
  openDeliveryOrderAttemptOutcomePathOrderDispatchBridgePage,
  openDeliveryOrderAttemptOutcomePathRiderCheckinPage,
  resetDeliveryOrderAttemptOutcomePathQaState,
  resolveDeliveryOrderAttemptOutcomeOnDispatch,
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

  test("active delivery order stays bound to its current active run", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
    const initialState = await resolveDeliveryOrderAttemptOutcomePathDbState();

    expectDeliveryOrderAttemptOutcomePathInitialDbState(initialState, scenario);

    const managerContext =
      await createDeliveryOrderAttemptOutcomePathRoleContext(browser, "manager");

    try {
      const managerPage = await managerContext.newPage();
      await openDeliveryOrderAttemptOutcomePathDispatchPage(managerPage);
      await expect(
        managerPage.getByText(scenario.activeOrder.orderCode, { exact: false }),
      ).toHaveCount(0);

      await openDeliveryOrderAttemptOutcomePathOrderDispatchBridgePage({
        page: managerPage,
        expectedPathname: `/runs/${scenario.activeRun.id}/dispatch`,
      });
      await expect(
        managerPage.getByText(scenario.activeRun.runCode, { exact: false }),
      ).toBeVisible();
    } finally {
      await managerContext.close();
    }
  });

  test("rider reports failed delivery and dispatch manager can return the order to dispatch", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
    const initialState = await resolveDeliveryOrderAttemptOutcomePathDbState();
    const note = "QA failed delivery for redispatch";

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
        riderPage.getByRole("button", { name: /mark as failed delivery/i }),
      ).toBeVisible();

      await submitDeliveryOrderAttemptOutcomeRiderCheckin({
        page: riderPage,
        scenario,
        note,
      });

      const managerPage = await managerContext.newPage();
      await openDeliveryOrderAttemptOutcomePathManagerRemitPage(managerPage);
      await expect(
        managerPage.getByText(/failed delivery pending dispatch review/i),
      ).toBeVisible();

      await finalizeDeliveryOrderAttemptOutcomeOnManagerRemit({
        page: managerPage,
        scenario,
        markMissing: false,
      });

      const postedState = await resolveDeliveryOrderAttemptOutcomePathDbState();
      expectDeliveryOrderAttemptOutcomePathPendingDispatchReviewDbState({
        note,
        scenario,
        state: postedState,
      });

      await openDeliveryOrderAttemptOutcomePathDispatchPage(managerPage);
      await expect(
        managerPage.getByText(/failed delivery pending dispatch review/i),
      ).toBeVisible();
      await expect(managerPage.getByText(note, { exact: false })).toBeVisible();

      await resolveDeliveryOrderAttemptOutcomeOnDispatch({
        page: managerPage,
        scenario,
        outcome: "NO_RELEASE_REATTEMPT",
      });

      const redispatchState = await resolveDeliveryOrderAttemptOutcomePathDbState();
      expectDeliveryOrderAttemptOutcomePathReattemptDbState({
        note,
        scenario,
        state: redispatchState,
      });

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

  test("rider reports failed delivery and dispatch manager can cancel the order", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
    const initialState = await resolveDeliveryOrderAttemptOutcomePathDbState();
    const note = "QA failed delivery for cancel";

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
        note,
      });

      const managerPage = await managerContext.newPage();
      await openDeliveryOrderAttemptOutcomePathManagerRemitPage(managerPage);
      await expect(
        managerPage.getByText(/failed delivery pending dispatch review/i),
      ).toBeVisible();

      await finalizeDeliveryOrderAttemptOutcomeOnManagerRemit({
        page: managerPage,
        scenario,
        markMissing: false,
      });

      const pendingState = await resolveDeliveryOrderAttemptOutcomePathDbState();
      expectDeliveryOrderAttemptOutcomePathPendingDispatchReviewDbState({
        note,
        scenario,
        state: pendingState,
      });

      await openDeliveryOrderAttemptOutcomePathDispatchPage(managerPage);
      await expect(managerPage.getByText(note, { exact: false })).toBeVisible();

      await resolveDeliveryOrderAttemptOutcomeOnDispatch({
        page: managerPage,
        scenario,
        outcome: "NO_RELEASE_CANCELLED",
      });

      const postedState = await resolveDeliveryOrderAttemptOutcomePathDbState();
      expectDeliveryOrderAttemptOutcomePathCancelledDbState({
        note,
        scenario,
        state: postedState,
      });

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

  test("manager can charge rider for missing stock while keeping failed delivery pending in dispatch review", async ({
    browser,
  }) => {
    const scenario = await resolveDeliveryOrderAttemptOutcomePathScenario();
    const initialState = await resolveDeliveryOrderAttemptOutcomePathDbState();
    const note = "QA failed delivery missing stock";

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
        note,
      });

      const managerPage = await managerContext.newPage();
      await openDeliveryOrderAttemptOutcomePathManagerRemitPage(managerPage);

      await finalizeDeliveryOrderAttemptOutcomeOnManagerRemit({
        page: managerPage,
        scenario,
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
      await expect(managerPage.getByText(note, { exact: false })).toBeVisible();

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
