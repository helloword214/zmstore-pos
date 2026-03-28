import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  CASHIER_OPENING_DISPUTE_RESEND_PATH_ENABLE_ENV,
  bootstrapCashierOpeningDisputeResendPathSession,
  findCashierOpeningDisputeResendPathOpenForm,
  findCashierOpeningDisputeResendPathResendForm,
  findCashierOpeningDisputeResendPathShiftRow,
  isCashierOpeningDisputeResendPathEnabled,
  openCashierOpeningDisputeResendPathCashierPage,
  openCashierOpeningDisputeResendPathManagerPage,
  resetCashierOpeningDisputeResendPathQaState,
  resolveCashierOpeningDisputeResendPathContext,
  resolveCashierOpeningDisputeResendPathShiftId,
  resolveCashierOpeningDisputeResendPathShiftState,
} from "./cashier-opening-dispute-resend-path-fixture";

function acceptNextDialog(page: Page) {
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
}

async function closeContextSafely(context: BrowserContext) {
  await Promise.race([
    context.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

test.describe("cashier opening dispute resend path", () => {
  test.skip(
    !isCashierOpeningDisputeResendPathEnabled(),
    `Run \`npm run qa:cashier:opening-dispute-resend-path:setup\` first, then set ${CASHIER_OPENING_DISPUTE_RESEND_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetCashierOpeningDisputeResendPathQaState();
  });

  test.afterEach(async () => {
    await resetCashierOpeningDisputeResendPathQaState();
  });

  test("manager can resend a disputed opening float and cashier can accept the corrected float", async ({
    browser,
  }) => {
    const scenario = await resolveCashierOpeningDisputeResendPathContext();
    const managerContext = await browser.newContext();
    const cashierContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    const cashierPage = await cashierContext.newPage();

    try {
      await bootstrapCashierOpeningDisputeResendPathSession(
        managerContext,
        "manager",
      );
      await bootstrapCashierOpeningDisputeResendPathSession(
        cashierContext,
        "cashier",
      );

      await openCashierOpeningDisputeResendPathManagerPage(managerPage);

      const openForm = findCashierOpeningDisputeResendPathOpenForm(managerPage);
      await openForm.getByLabel(/^Cashier$/i).click();
      await managerPage
        .getByRole("option", { name: scenario.cashierLabel, exact: true })
        .click();
      await openForm
        .getByLabel(/^Opening float$/i)
        .fill(scenario.initialOpeningFloatInput);
      await openForm
        .getByLabel(/^Device ID \(optional\)$/i)
        .fill(scenario.deviceId);
      await openForm.getByRole("button", { name: /^Open Shift$/i }).click();

      await expect(
        managerPage.getByText(/opened successfully|already has an open shift/i),
      ).toBeVisible();

      const shiftId = resolveCashierOpeningDisputeResendPathShiftId(
        managerPage.url(),
      );
      const pendingShiftRow = findCashierOpeningDisputeResendPathShiftRow(
        managerPage,
        shiftId,
      );
      await expect(pendingShiftRow).toBeVisible();
      await expect(pendingShiftRow).toContainText("PENDING ACCEPT");
      await expect(pendingShiftRow).toContainText(scenario.cashierLabel);
      await expect(pendingShiftRow).toContainText(scenario.deviceId);
      await expect(pendingShiftRow).toContainText(
        scenario.initialOpeningFloatLabel,
      );

      await openCashierOpeningDisputeResendPathCashierPage(cashierPage);
      await expect(
        cashierPage.getByText(new RegExp(`Active shift\\s+#${shiftId}`)).first(),
      ).toBeVisible();
      await cashierPage
        .getByLabel(/^Enter counted opening float$/i)
        .fill(scenario.disputedOpeningCountInput);
      await cashierPage
        .getByPlaceholder(/Dispute note \(required\)/i)
        .fill(scenario.disputeNote);
      acceptNextDialog(cashierPage);
      await cashierPage.getByRole("button", { name: /^Dispute$/i }).click();

      await expect
        .poll(
          async () =>
            (
              await resolveCashierOpeningDisputeResendPathShiftState(shiftId)
            ).shift?.status ?? null,
        )
        .toBe("OPENING_DISPUTED");

      await expect(
        cashierPage.getByText(/Opening float is/i),
      ).toBeVisible();
      await expect(
        cashierPage.getByText("DISPUTED", { exact: true }),
      ).toBeVisible();
      await expect(cashierPage.getByText(scenario.disputeNote)).toBeVisible();

      await openCashierOpeningDisputeResendPathManagerPage(managerPage);
      const disputedShiftRow = findCashierOpeningDisputeResendPathShiftRow(
        managerPage,
        shiftId,
      );
      await expect(disputedShiftRow).toBeVisible();
      await expect(disputedShiftRow).toContainText("OPENING DISPUTED");
      await expect(disputedShiftRow).toContainText(scenario.disputeNote);
      await expect(disputedShiftRow).toContainText(
        scenario.initialOpeningFloatLabel,
      );

      const disputedState =
        await resolveCashierOpeningDisputeResendPathShiftState(shiftId);
      expect(disputedState.taggedShiftCount).toBe(1);
      expect(disputedState.shift).not.toBeNull();
      expect(disputedState.shift?.status).toBe("OPENING_DISPUTED");
      expect(disputedState.shift?.deviceId).toBe(scenario.deviceId);
      expect(disputedState.shift?.openingFloat).toBe(
        scenario.initialOpeningFloat,
      );
      expect(disputedState.shift?.openingCounted).toBe(
        scenario.disputedOpeningCount,
      );
      expect(disputedState.shift?.openingDisputeNote).toBe(scenario.disputeNote);
      expect(disputedState.shift?.openingVerifiedById).toBe(scenario.cashier.id);
      expect(disputedState.shift?.openingVerifiedAt).not.toBeNull();
      expect(disputedState.shift?.closingTotal).toBeNull();
      expect(disputedState.shift?.closedAt).toBeNull();

      const resendForm =
        findCashierOpeningDisputeResendPathResendForm(disputedShiftRow);
      await resendForm
        .locator('input[name="openingFloat"]')
        .fill(scenario.resendOpeningFloatInput);
      acceptNextDialog(managerPage);
      await resendForm.getByRole("button", { name: /^Resend$/i }).click();

      await expect
        .poll(
          async () =>
            (
              await resolveCashierOpeningDisputeResendPathShiftState(shiftId)
            ).shift?.status ?? null,
        )
        .toBe("PENDING_ACCEPT");

      const resentShiftRow = findCashierOpeningDisputeResendPathShiftRow(
        managerPage,
        shiftId,
      );
      await expect(resentShiftRow).toBeVisible();
      await expect(resentShiftRow).toContainText("PENDING ACCEPT");
      await expect(resentShiftRow).toContainText(
        scenario.resendOpeningFloatLabel,
      );

      const resentState =
        await resolveCashierOpeningDisputeResendPathShiftState(shiftId);
      expect(resentState.taggedShiftCount).toBe(1);
      expect(resentState.shift).not.toBeNull();
      expect(resentState.shift?.status).toBe("PENDING_ACCEPT");
      expect(resentState.shift?.deviceId).toBe(scenario.deviceId);
      expect(resentState.shift?.openingFloat).toBe(scenario.resendOpeningFloat);
      expect(resentState.shift?.openingCounted).toBeNull();
      expect(resentState.shift?.openingDisputeNote).toBeNull();
      expect(resentState.shift?.openingVerifiedById).toBeNull();
      expect(resentState.shift?.openingVerifiedAt).toBeNull();
      expect(resentState.shift?.closingTotal).toBeNull();
      expect(resentState.shift?.closedAt).toBeNull();

      await openCashierOpeningDisputeResendPathCashierPage(cashierPage);
      await expect(
        cashierPage.getByRole("button", { name: /^Accept & Open$/i }),
      ).toBeVisible();
      await expect(cashierPage.getByText(/Verify opening float/i)).toBeVisible();
      await expect(
        cashierPage.getByText(/Opening float is DISPUTED/i),
      ).toHaveCount(0);
      await cashierPage
        .getByLabel(/^Enter counted opening float$/i)
        .fill(scenario.resendOpeningFloatInput);
      acceptNextDialog(cashierPage);
      await cashierPage
        .getByRole("button", { name: /^Accept & Open$/i })
        .click();

      await expect(
        cashierPage.getByText(/Submit counted cash/i),
      ).toBeVisible();

      await expect
        .poll(
          async () =>
            (
              await resolveCashierOpeningDisputeResendPathShiftState(shiftId)
            ).shift?.status ?? null,
        )
        .toBe("OPEN");

      const acceptedState =
        await resolveCashierOpeningDisputeResendPathShiftState(shiftId);
      expect(acceptedState.taggedShiftCount).toBe(1);
      expect(acceptedState.shift).not.toBeNull();
      expect(acceptedState.shift?.status).toBe("OPEN");
      expect(acceptedState.shift?.deviceId).toBe(scenario.deviceId);
      expect(acceptedState.shift?.openingFloat).toBe(scenario.resendOpeningFloat);
      expect(acceptedState.shift?.openingCounted).toBe(
        scenario.resendOpeningFloat,
      );
      expect(acceptedState.shift?.openingDisputeNote).toBeNull();
      expect(acceptedState.shift?.openingVerifiedById).toBe(scenario.cashier.id);
      expect(acceptedState.shift?.openingVerifiedAt).not.toBeNull();
      expect(acceptedState.shift?.closingTotal).toBeNull();
      expect(acceptedState.shift?.closedAt).toBeNull();
      expect(acceptedState.shift?.finalClosedById).toBeNull();

      await openCashierOpeningDisputeResendPathManagerPage(managerPage);
      const openShiftRow = findCashierOpeningDisputeResendPathShiftRow(
        managerPage,
        shiftId,
      );
      await expect(openShiftRow).toContainText("OPEN");
      await expect(openShiftRow).toContainText(scenario.resendOpeningFloatLabel);
      await expect(openShiftRow).toContainText(scenario.deviceId);
    } finally {
      await Promise.all([
        closeContextSafely(managerContext),
        closeContextSafely(cashierContext),
      ]);
    }
  });
});
