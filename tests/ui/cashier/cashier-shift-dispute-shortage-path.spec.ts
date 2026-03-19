import { expect, test } from "@playwright/test";
import {
  CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_ENABLE_ENV,
  bootstrapCashierShiftDisputeShortagePathSession,
  confirmCashierShiftDisputeShortagePathAction,
  findCashierShiftDisputeShortagePathCloseForm,
  findCashierShiftDisputeShortagePathOpenForm,
  isCashierShiftDisputeShortagePathEnabled,
  openCashierShiftDisputeShortagePathCashierPage,
  openCashierShiftDisputeShortagePathManagerPage,
  resetCashierShiftDisputeShortagePathQaState,
  resolveCashierShiftDisputeShortagePathContext,
  resolveCashierShiftDisputeShortagePathDecision,
  resolveCashierShiftDisputeShortagePathOutcome,
  resolveCashierShiftDisputeShortagePathShiftId,
} from "./cashier-shift-dispute-shortage-path-fixture";

test.describe("cashier shift dispute shortage path", () => {
  test.skip(
    !isCashierShiftDisputeShortagePathEnabled(),
    `Run \`npm run qa:cashier:shift-dispute-shortage-path:setup\` first, then set ${CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetCashierShiftDisputeShortagePathQaState();
  });

  test.afterEach(async () => {
    await resetCashierShiftDisputeShortagePathQaState();
  });

  test("manager can final-close a short cashier count with charge decision and paper ref", async ({
    browser,
  }) => {
    const scenario = await resolveCashierShiftDisputeShortagePathContext();
    const decision = resolveCashierShiftDisputeShortagePathDecision();
    const managerContext = await browser.newContext();
    const cashierContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    const cashierPage = await cashierContext.newPage();

    try {
      await bootstrapCashierShiftDisputeShortagePathSession(
        managerContext,
        "manager",
      );
      await bootstrapCashierShiftDisputeShortagePathSession(
        cashierContext,
        "cashier",
      );

      await openCashierShiftDisputeShortagePathManagerPage(managerPage);

      const openForm = findCashierShiftDisputeShortagePathOpenForm(managerPage);
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

      const shiftId = resolveCashierShiftDisputeShortagePathShiftId(
        managerPage.url(),
      );
      const shiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(shiftRow).toBeVisible();
      await expect(shiftRow).toContainText("PENDING ACCEPT");
      await expect(shiftRow).toContainText(scenario.cashierLabel);
      await expect(shiftRow).toContainText(scenario.deviceId);

      await openCashierShiftDisputeShortagePathCashierPage(cashierPage);
      await expect(
        cashierPage.getByText(new RegExp(`Active shift\\s+#${shiftId}`)),
      ).toBeVisible();
      await cashierPage
        .getByLabel(/^Enter counted opening float$/i)
        .fill(scenario.openingFloatInput);
      await confirmCashierShiftDisputeShortagePathAction(cashierPage, async () => {
        await cashierPage
          .getByRole("button", { name: /^Accept & Open$/i })
          .click();
      });

      await expect(cashierPage.getByText(/submit counted cash/i)).toBeVisible();
      await cashierPage
        .getByLabel(/^Enter counted cash$/i)
        .fill(scenario.shortageCountInput);
      await confirmCashierShiftDisputeShortagePathAction(cashierPage, async () => {
        await cashierPage
          .getByRole("button", { name: /^Submit count$/i })
          .click();
      });

      await expect(
        cashierPage.getByText(/Shift is locked \(SUBMITTED\)/i),
      ).toBeVisible();

      await openCashierShiftDisputeShortagePathManagerPage(managerPage);
      const submittedShiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(submittedShiftRow).toBeVisible();
      await expect(submittedShiftRow).toContainText("COUNT SUBMITTED");
      await expect(submittedShiftRow).toContainText(scenario.shortageCountLabel);

      const closeForm =
        findCashierShiftDisputeShortagePathCloseForm(submittedShiftRow);
      await closeForm
        .getByLabel(/^Manager recount total$/i)
        .fill(scenario.shortageCountInput);
      await closeForm
        .getByLabel(/^Decision \(required if short\)$/i)
        .click();
      await managerPage
        .getByRole("option", { name: /^Charge cashier$/i })
        .click();
      await closeForm
        .getByLabel(/^Paper reference no\. \(required if short\)$/i)
        .fill(scenario.paperRefNo);
      await confirmCashierShiftDisputeShortagePathAction(managerPage, async () => {
        await closeForm
          .getByRole("button", { name: /^Final close shift$/i })
          .click();
      });

      await expect(managerPage.locator(`#open-shift-${shiftId}`)).toHaveCount(0);

      const outcome =
        await resolveCashierShiftDisputeShortagePathOutcome(shiftId);
      expect(outcome.shift).not.toBeNull();
      expect(outcome.shift?.status).toBe("FINAL_CLOSED");
      expect(outcome.shift?.deviceId).toBe(scenario.deviceId);
      expect(outcome.shift?.closingTotal).toBe(scenario.shortageCount);
      expect(outcome.shift?.closedAt).not.toBeNull();
      expect(outcome.shift?.notes).toContain(`decision=${decision}`);
      expect(outcome.shift?.notes).toContain(`paperRef=${scenario.paperRefNo}`);

      expect(outcome.variance).not.toBeNull();
      expect(outcome.variance?.status).toBe("MANAGER_APPROVED");
      expect(outcome.variance?.resolution).toBe(decision);
      expect(outcome.variance?.expected).toBe(scenario.openingFloat);
      expect(outcome.variance?.counted).toBe(scenario.shortageCount);
      expect(outcome.variance?.variance).toBe(scenario.expectedVariance);
      expect(outcome.variance?.managerApprovedAt).not.toBeNull();
      expect(outcome.variance?.note).toContain(`decision=${decision}`);
      expect(outcome.variance?.note).toContain(`paperRef=${scenario.paperRefNo}`);

      expect(outcome.charge).not.toBeNull();
      expect(outcome.charge?.status).toBe("OPEN");
      expect(outcome.charge?.amount).toBe(scenario.expectedChargeAmount);
      expect(outcome.charge?.cashierId).toBe(scenario.cashier.id);
      expect(outcome.charge?.shiftId).toBe(shiftId);
      expect(outcome.charge?.varianceId).toBe(outcome.variance?.id ?? null);
      expect(outcome.charge?.paymentsCount).toBe(0);
      expect(outcome.charge?.settledAt).toBeNull();
      expect(outcome.charge?.note).toContain(`paperRef=${scenario.paperRefNo}`);

      await openCashierShiftDisputeShortagePathCashierPage(cashierPage);
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
