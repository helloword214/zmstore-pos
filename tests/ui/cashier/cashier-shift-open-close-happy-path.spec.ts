import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_ENABLE_ENV,
  bootstrapCashierShiftOpenCloseHappyPathSession,
  findCashierShiftOpenCloseHappyPathCloseForm,
  findCashierShiftOpenCloseHappyPathOpenForm,
  isCashierShiftOpenCloseHappyPathEnabled,
  openCashierShiftOpenCloseHappyPathCashierPage,
  openCashierShiftOpenCloseHappyPathManagerPage,
  resetCashierShiftOpenCloseHappyPathQaState,
  resolveCashierShiftOpenCloseHappyPathContext,
  resolveCashierShiftOpenCloseHappyPathShiftId,
  resolveCashierShiftOpenCloseHappyPathShiftState,
} from "./cashier-shift-open-close-happy-path-fixture";

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

test.describe("cashier shift open close happy path", () => {
  test.skip(
    !isCashierShiftOpenCloseHappyPathEnabled(),
    `Run \`npm run qa:cashier:shift-open-close:happy-path:setup\` first, then set ${CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetCashierShiftOpenCloseHappyPathQaState();
  });

  test.afterEach(async () => {
    await resetCashierShiftOpenCloseHappyPathQaState();
  });

  test("manager and cashier can complete the no-variance shift lifecycle", async ({
    browser,
  }) => {
    const scenario = await resolveCashierShiftOpenCloseHappyPathContext();
    const managerContext = await browser.newContext();
    const cashierContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    const cashierPage = await cashierContext.newPage();

    try {
      await bootstrapCashierShiftOpenCloseHappyPathSession(
        managerContext,
        "manager",
      );
      await bootstrapCashierShiftOpenCloseHappyPathSession(
        cashierContext,
        "cashier",
      );

      await openCashierShiftOpenCloseHappyPathManagerPage(managerPage);

      const openForm = findCashierShiftOpenCloseHappyPathOpenForm(managerPage);
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

      await expect(
        managerPage.getByText(/opened successfully|already has an open shift/i),
      ).toBeVisible();

      const shiftId = resolveCashierShiftOpenCloseHappyPathShiftId(
        managerPage.url(),
      );
      const shiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(shiftRow).toBeVisible();
      await expect(shiftRow).toContainText("PENDING ACCEPT");
      await expect(shiftRow).toContainText(scenario.cashierLabel);
      await expect(shiftRow).toContainText(scenario.deviceId);

      await openCashierShiftOpenCloseHappyPathCashierPage(cashierPage);
      await expect(
        cashierPage.getByText(new RegExp(`Active shift\\s+#${shiftId}`)).first(),
      ).toBeVisible();
      await cashierPage
        .getByLabel(/^Enter counted opening float$/i)
        .fill(scenario.openingFloatInput);
      acceptNextDialog(cashierPage);
      await cashierPage
        .getByRole("button", { name: /^Accept & Open$/i })
        .click();

      await expect(cashierPage.getByText(/submit counted cash/i)).toBeVisible();
      const countModeToggle = cashierPage.getByRole("checkbox", {
        name: /Use denoms/i,
      });
      if (await countModeToggle.isChecked()) {
        await countModeToggle.uncheck();
      }
      await cashierPage
        .getByLabel(/^Enter counted cash$/i)
        .fill(scenario.openingFloatInput);
      acceptNextDialog(cashierPage);
      await cashierPage
        .getByRole("button", { name: /^Submit count$/i })
        .click();

      await expect(
        cashierPage.getByText(/Shift is locked \(SUBMITTED\)/i),
      ).toBeVisible();

      await expect
        .poll(
          async () =>
            (
              await resolveCashierShiftOpenCloseHappyPathShiftState(shiftId)
            )?.status ?? null,
        )
        .toBe("SUBMITTED");

      await openCashierShiftOpenCloseHappyPathManagerPage(managerPage);
      const submittedShiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(submittedShiftRow).toBeVisible();
      await expect(submittedShiftRow).toContainText("COUNT SUBMITTED");
      await expect(submittedShiftRow).toContainText(scenario.openingFloatLabel);

      const closeForm = findCashierShiftOpenCloseHappyPathCloseForm(
        submittedShiftRow,
      );
      await closeForm
        .getByLabel(/^Manager recount total$/i)
        .fill(scenario.openingFloatInput);
      acceptNextDialog(managerPage);
      await closeForm
        .getByRole("button", { name: /^Final close shift$/i })
        .click();

      await expect
        .poll(
          async () =>
            (
              await resolveCashierShiftOpenCloseHappyPathShiftState(shiftId)
            )?.status ?? null,
        )
        .toBe("FINAL_CLOSED");

      await expect(managerPage.locator(`#open-shift-${shiftId}`)).toHaveCount(0);

      const finalShift = await resolveCashierShiftOpenCloseHappyPathShiftState(
        shiftId,
      );
      expect(finalShift).not.toBeNull();
      expect(finalShift?.status).toBe("FINAL_CLOSED");
      expect(finalShift?.deviceId).toBe(scenario.deviceId);
      expect(finalShift?.closingTotal).toBe(scenario.openingFloat);
      expect(finalShift?.closedAt).not.toBeNull();

      await openCashierShiftOpenCloseHappyPathCashierPage(cashierPage);
      await expect(
        cashierPage.getByText(
          /No active shift\. Manager must open the cashier shift first\./i,
        ),
      ).toBeVisible();
    } finally {
      await Promise.all([
        closeContextSafely(managerContext),
        closeContextSafely(cashierContext),
      ]);
    }
  });
});
