import { expect, test } from "@playwright/test";
import {
  CASHIER_SHIFT_WAIVE_INFO_ONLY_PATH_ENABLE_ENV,
  bootstrapCashierShiftWaiveInfoOnlyPathSession,
  confirmCashierShiftWaiveInfoOnlyPathAction,
  findCashierShiftWaiveInfoOnlyPathCloseForm,
  findCashierShiftWaiveInfoOnlyPathOpenForm,
  isCashierShiftWaiveInfoOnlyPathEnabled,
  openCashierShiftWaiveInfoOnlyPathCashierPage,
  openCashierShiftWaiveInfoOnlyPathManagerPage,
  resetCashierShiftWaiveInfoOnlyPathQaState,
  resolveCashierShiftWaiveInfoOnlyPathContext,
  resolveCashierShiftWaiveInfoOnlyPathOutcome,
  resolveCashierShiftWaiveInfoOnlyPathShiftId,
} from "./cashier-shift-waive-info-only-path-fixture";

test.describe("cashier shift waive/info-only path", () => {
  test.skip(
    !isCashierShiftWaiveInfoOnlyPathEnabled(),
    `Run \`npm run qa:cashier:shift-waive-info-only-path:setup\` first, then set ${CASHIER_SHIFT_WAIVE_INFO_ONLY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetCashierShiftWaiveInfoOnlyPathQaState();
  });

  test.afterEach(async () => {
    await resetCashierShiftWaiveInfoOnlyPathQaState();
  });

  test("manager can final-close a short cashier count as info only without creating a cashier charge", async ({
    browser,
  }) => {
    const scenario = await resolveCashierShiftWaiveInfoOnlyPathContext();
    const managerContext = await browser.newContext();
    const cashierContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    const cashierPage = await cashierContext.newPage();

    try {
      await bootstrapCashierShiftWaiveInfoOnlyPathSession(managerContext, "manager");
      await bootstrapCashierShiftWaiveInfoOnlyPathSession(cashierContext, "cashier");

      await openCashierShiftWaiveInfoOnlyPathManagerPage(managerPage);

      const openForm = findCashierShiftWaiveInfoOnlyPathOpenForm(managerPage);
      await openForm.getByLabel(/^Cashier$/i).click();
      await managerPage
        .getByRole("option", { name: scenario.cashierLabel, exact: true })
        .click();
      await openForm
        .getByLabel(/^Opening float$/i)
        .fill(scenario.openingFloatInput);
      await openForm
        .getByLabel(/^Device ID \(optional\)$/i)
        .fill(scenario.deviceId);
      await openForm.getByRole("button", { name: /^Open Shift$/i }).click();

      await expect(managerPage.getByText(/opened successfully/i)).toBeVisible();

      const shiftId = resolveCashierShiftWaiveInfoOnlyPathShiftId(
        managerPage.url(),
      );
      const shiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(shiftRow).toBeVisible();
      await expect(shiftRow).toContainText("PENDING ACCEPT");

      await openCashierShiftWaiveInfoOnlyPathCashierPage(cashierPage);
      await expect(
        cashierPage.getByText(new RegExp(`Active shift\\s+#${shiftId}`)),
      ).toBeVisible();
      await cashierPage
        .getByLabel(/^Enter counted opening float$/i)
        .fill(scenario.openingFloatInput);
      await confirmCashierShiftWaiveInfoOnlyPathAction(cashierPage, async () => {
        await cashierPage
          .getByRole("button", { name: /^Accept & Open$/i })
          .click();
      });

      await cashierPage
        .getByLabel(/^Enter counted cash$/i)
        .fill(scenario.shortageCountInput);
      await confirmCashierShiftWaiveInfoOnlyPathAction(cashierPage, async () => {
        await cashierPage
          .getByRole("button", { name: /^Submit count$/i })
          .click();
      });

      await openCashierShiftWaiveInfoOnlyPathManagerPage(managerPage);
      const submittedShiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(submittedShiftRow).toBeVisible();
      await expect(submittedShiftRow).toContainText("COUNT SUBMITTED");

      const closeForm =
        findCashierShiftWaiveInfoOnlyPathCloseForm(submittedShiftRow);
      await closeForm
        .getByLabel(/^Manager recount total$/i)
        .fill(scenario.shortageCountInput);
      await closeForm
        .getByLabel(/^Decision \(required if short\)$/i)
        .click();
      await managerPage
        .getByRole("option", { name: /^Info only$/i })
        .click();
      await closeForm
        .getByLabel(/^Paper reference no\. \(required if short\)$/i)
        .fill(scenario.infoOnlyPaperRefNo);
      await confirmCashierShiftWaiveInfoOnlyPathAction(managerPage, async () => {
        await closeForm
          .getByRole("button", { name: /^Final close shift$/i })
          .click();
      });

      await expect(managerPage.locator(`#open-shift-${shiftId}`)).toHaveCount(0);

      const outcome = await resolveCashierShiftWaiveInfoOnlyPathOutcome(shiftId);
      expect(outcome.shift?.status).toBe("FINAL_CLOSED");
      expect(outcome.shift?.deviceId).toBe(scenario.deviceId);
      expect(outcome.shift?.closingTotal).toBe(scenario.shortageCount);
      expect(outcome.shift?.closedAt).not.toBeNull();
      expect(outcome.shift?.notes).toContain("decision=INFO_ONLY");
      expect(outcome.shift?.notes).toContain(
        `paperRef=${scenario.infoOnlyPaperRefNo}`,
      );

      expect(outcome.variance?.status).toBe("MANAGER_APPROVED");
      expect(outcome.variance?.resolution).toBe("INFO_ONLY");
      expect(outcome.variance?.expected).toBe(scenario.openingFloat);
      expect(outcome.variance?.counted).toBe(scenario.shortageCount);
      expect(outcome.variance?.variance).toBe(scenario.expectedVariance);
      expect(outcome.variance?.managerApprovedAt).not.toBeNull();
      expect(outcome.variance?.managerApprovedById).toBe(scenario.manager.id);
      expect(outcome.variance?.resolvedAt).toBeNull();
      expect(outcome.variance?.note).toContain("decision=INFO_ONLY");
      expect(outcome.variance?.note).toContain(
        `paperRef=${scenario.infoOnlyPaperRefNo}`,
      );

      expect(outcome.charge).toBeNull();

      await openCashierShiftWaiveInfoOnlyPathCashierPage(cashierPage);
      await expect(
        cashierPage.getByText(
          /No active shift\. Manager must open the cashier shift first\./i,
        ),
      ).toBeVisible();
    } finally {
      await managerContext.close();
      await cashierContext.close();
    }
  });

  test("manager can final-close a short cashier count as waived without leaving an active cashier charge", async ({
    browser,
  }) => {
    const scenario = await resolveCashierShiftWaiveInfoOnlyPathContext();
    const managerContext = await browser.newContext();
    const cashierContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    const cashierPage = await cashierContext.newPage();

    try {
      await bootstrapCashierShiftWaiveInfoOnlyPathSession(managerContext, "manager");
      await bootstrapCashierShiftWaiveInfoOnlyPathSession(cashierContext, "cashier");

      await openCashierShiftWaiveInfoOnlyPathManagerPage(managerPage);

      const openForm = findCashierShiftWaiveInfoOnlyPathOpenForm(managerPage);
      await openForm.getByLabel(/^Cashier$/i).click();
      await managerPage
        .getByRole("option", { name: scenario.cashierLabel, exact: true })
        .click();
      await openForm
        .getByLabel(/^Opening float$/i)
        .fill(scenario.openingFloatInput);
      await openForm
        .getByLabel(/^Device ID \(optional\)$/i)
        .fill(scenario.deviceId);
      await openForm.getByRole("button", { name: /^Open Shift$/i }).click();

      await expect(managerPage.getByText(/opened successfully/i)).toBeVisible();

      const shiftId = resolveCashierShiftWaiveInfoOnlyPathShiftId(
        managerPage.url(),
      );
      const shiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(shiftRow).toBeVisible();
      await expect(shiftRow).toContainText("PENDING ACCEPT");

      await openCashierShiftWaiveInfoOnlyPathCashierPage(cashierPage);
      await expect(
        cashierPage.getByText(new RegExp(`Active shift\\s+#${shiftId}`)),
      ).toBeVisible();
      await cashierPage
        .getByLabel(/^Enter counted opening float$/i)
        .fill(scenario.openingFloatInput);
      await confirmCashierShiftWaiveInfoOnlyPathAction(cashierPage, async () => {
        await cashierPage
          .getByRole("button", { name: /^Accept & Open$/i })
          .click();
      });

      await cashierPage
        .getByLabel(/^Enter counted cash$/i)
        .fill(scenario.shortageCountInput);
      await confirmCashierShiftWaiveInfoOnlyPathAction(cashierPage, async () => {
        await cashierPage
          .getByRole("button", { name: /^Submit count$/i })
          .click();
      });

      await openCashierShiftWaiveInfoOnlyPathManagerPage(managerPage);
      const submittedShiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(submittedShiftRow).toBeVisible();
      await expect(submittedShiftRow).toContainText("COUNT SUBMITTED");

      const closeForm =
        findCashierShiftWaiveInfoOnlyPathCloseForm(submittedShiftRow);
      await closeForm
        .getByLabel(/^Manager recount total$/i)
        .fill(scenario.shortageCountInput);
      await closeForm
        .getByLabel(/^Decision \(required if short\)$/i)
        .click();
      await managerPage
        .getByRole("option", { name: /^Waive$/i })
        .click();
      await closeForm
        .getByLabel(/^Paper reference no\. \(required if short\)$/i)
        .fill(scenario.waivePaperRefNo);
      await confirmCashierShiftWaiveInfoOnlyPathAction(managerPage, async () => {
        await closeForm
          .getByRole("button", { name: /^Final close shift$/i })
          .click();
      });

      await expect(managerPage.locator(`#open-shift-${shiftId}`)).toHaveCount(0);

      const outcome = await resolveCashierShiftWaiveInfoOnlyPathOutcome(shiftId);
      expect(outcome.shift?.status).toBe("FINAL_CLOSED");
      expect(outcome.shift?.deviceId).toBe(scenario.deviceId);
      expect(outcome.shift?.closingTotal).toBe(scenario.shortageCount);
      expect(outcome.shift?.closedAt).not.toBeNull();
      expect(outcome.shift?.notes).toContain("decision=WAIVE");
      expect(outcome.shift?.notes).toContain(
        `paperRef=${scenario.waivePaperRefNo}`,
      );

      expect(outcome.variance?.status).toBe("WAIVED");
      expect(outcome.variance?.resolution).toBe("WAIVE");
      expect(outcome.variance?.expected).toBe(scenario.openingFloat);
      expect(outcome.variance?.counted).toBe(scenario.shortageCount);
      expect(outcome.variance?.variance).toBe(scenario.expectedVariance);
      expect(outcome.variance?.managerApprovedAt).not.toBeNull();
      expect(outcome.variance?.managerApprovedById).toBe(scenario.manager.id);
      expect(outcome.variance?.resolvedAt).not.toBeNull();
      expect(outcome.variance?.note).toContain("decision=WAIVE");
      expect(outcome.variance?.note).toContain(
        `paperRef=${scenario.waivePaperRefNo}`,
      );

      expect(outcome.charge).toBeNull();

      await openCashierShiftWaiveInfoOnlyPathCashierPage(cashierPage);
      await expect(
        cashierPage.getByText(
          /No active shift\. Manager must open the cashier shift first\./i,
        ),
      ).toBeVisible();
    } finally {
      await managerContext.close();
      await cashierContext.close();
    }
  });
});
