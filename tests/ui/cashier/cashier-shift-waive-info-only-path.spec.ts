import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  CASHIER_SHIFT_WAIVE_INFO_ONLY_PATH_ENABLE_ENV,
  bootstrapCashierShiftWaiveInfoOnlyPathSession,
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

      await expect(
        managerPage.getByText(/opened successfully|already has an open shift/i),
      ).toBeVisible();

      const shiftId = resolveCashierShiftWaiveInfoOnlyPathShiftId(
        managerPage.url(),
      );
      const shiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(shiftRow).toBeVisible();
      await expect(shiftRow).toContainText("PENDING ACCEPT");

      await openCashierShiftWaiveInfoOnlyPathCashierPage(cashierPage);
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

      const countModeToggle = cashierPage.getByRole("checkbox", {
        name: /Use denoms/i,
      });
      if (await countModeToggle.isChecked()) {
        await countModeToggle.uncheck();
      }
      await cashierPage
        .getByLabel(/^Enter counted cash$/i)
        .fill(scenario.shortageCountInput);
      acceptNextDialog(cashierPage);
      await cashierPage
        .getByRole("button", { name: /^Submit count$/i })
        .click();

      await expect
        .poll(
          async () =>
            (
              await resolveCashierShiftWaiveInfoOnlyPathOutcome(shiftId)
            ).shift?.status ?? null,
        )
        .toBe("SUBMITTED");

      await openCashierShiftWaiveInfoOnlyPathManagerPage(managerPage);
      const submittedShiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(submittedShiftRow).toBeVisible();
      await expect(
        submittedShiftRow.getByText(/^COUNT SUBMITTED$/i),
      ).toBeVisible();

      const closeForm =
        findCashierShiftWaiveInfoOnlyPathCloseForm(submittedShiftRow);
      await closeForm
        .getByLabel(/^Manager recount total$/i)
        .fill(scenario.shortageCountInput);
      await closeForm
        .getByRole("button", { name: /^Decision \(required if short\)$/i })
        .click();
      await managerPage
        .getByRole("option", { name: /^Info only$/i })
        .click();
      await expect(
        closeForm.getByRole("button", { name: /^Decision \(required if short\)$/i }),
      ).toContainText(/Info only/i);
      await closeForm
        .getByLabel(/^Paper reference no\. \(required if short\)$/i)
        .fill(scenario.infoOnlyPaperRefNo);
      acceptNextDialog(managerPage);
      await closeForm
        .getByRole("button", { name: /^Final close shift$/i })
        .click();

      await expect
        .poll(
          async () =>
            (
              await resolveCashierShiftWaiveInfoOnlyPathOutcome(shiftId)
            ).shift?.status ?? null,
        )
        .toBe("FINAL_CLOSED");

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
      await Promise.all([
        closeContextSafely(managerContext),
        closeContextSafely(cashierContext),
      ]);
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

      await expect(
        managerPage.getByText(/opened successfully|already has an open shift/i),
      ).toBeVisible();

      const shiftId = resolveCashierShiftWaiveInfoOnlyPathShiftId(
        managerPage.url(),
      );
      const shiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(shiftRow).toBeVisible();
      await expect(shiftRow).toContainText("PENDING ACCEPT");

      await openCashierShiftWaiveInfoOnlyPathCashierPage(cashierPage);
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

      const secondCountModeToggle = cashierPage.getByRole("checkbox", {
        name: /Use denoms/i,
      });
      if (await secondCountModeToggle.isChecked()) {
        await secondCountModeToggle.uncheck();
      }
      await cashierPage
        .getByLabel(/^Enter counted cash$/i)
        .fill(scenario.shortageCountInput);
      acceptNextDialog(cashierPage);
      await cashierPage
        .getByRole("button", { name: /^Submit count$/i })
        .click();

      await expect
        .poll(
          async () =>
            (
              await resolveCashierShiftWaiveInfoOnlyPathOutcome(shiftId)
            ).shift?.status ?? null,
        )
        .toBe("SUBMITTED");

      await openCashierShiftWaiveInfoOnlyPathManagerPage(managerPage);
      const submittedShiftRow = managerPage.locator(`#open-shift-${shiftId}`);
      await expect(submittedShiftRow).toBeVisible();
      await expect(
        submittedShiftRow.getByText(/^COUNT SUBMITTED$/i),
      ).toBeVisible();

      const closeForm =
        findCashierShiftWaiveInfoOnlyPathCloseForm(submittedShiftRow);
      await closeForm
        .getByLabel(/^Manager recount total$/i)
        .fill(scenario.shortageCountInput);
      await closeForm
        .getByRole("button", { name: /^Decision \(required if short\)$/i })
        .click();
      await managerPage
        .getByRole("option", { name: /^Waive$/i })
        .click();
      await expect(
        closeForm.getByRole("button", { name: /^Decision \(required if short\)$/i }),
      ).toContainText(/Waive/i);
      await closeForm
        .getByLabel(/^Paper reference no\. \(required if short\)$/i)
        .fill(scenario.waivePaperRefNo);
      acceptNextDialog(managerPage);
      await closeForm
        .getByRole("button", { name: /^Final close shift$/i })
        .click();

      await expect
        .poll(
          async () =>
            (
              await resolveCashierShiftWaiveInfoOnlyPathOutcome(shiftId)
            ).shift?.status ?? null,
        )
        .toBe("FINAL_CLOSED");

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
      await Promise.all([
        closeContextSafely(managerContext),
        closeContextSafely(cashierContext),
      ]);
    }
  });
});
