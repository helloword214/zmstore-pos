import { expect, test } from "@playwright/test";
import {
  WORKFORCE_PAYROLL_HAPPY_PATH_ENABLE_ENV,
  bootstrapWorkforcePayrollHappyPathSession,
  isWorkforcePayrollHappyPathEnabled,
  openWorkforcePayrollHappyPath,
  resetWorkforcePayrollHappyPathDraftState,
  resolveWorkforcePayrollHappyPathScenarioContext,
} from "./workforce-payroll-happy-path-fixture";

test.describe("workforce payroll happy path", () => {
  test.skip(
    !isWorkforcePayrollHappyPathEnabled(),
    `Run \`npm run qa:workforce:payroll:happy-path:setup\` first, then set ${WORKFORCE_PAYROLL_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetWorkforcePayrollHappyPathDraftState();
    await bootstrapWorkforcePayrollHappyPathSession(context);
  });

  test.afterEach(async () => {
    await resetWorkforcePayrollHappyPathDraftState();
  });

  test("manager can create, rebuild, review, and finalize an attendance-backed payroll run", async ({
    page,
  }) => {
    const scenario = await resolveWorkforcePayrollHappyPathScenarioContext();

    await openWorkforcePayrollHappyPath(page);

    await page.getByLabel(/^Period start$/i).fill(scenario.periodStartInput);
    await page.getByLabel(/^Period end$/i).fill(scenario.periodEndInput);
    await page.getByLabel(/^Pay date$/i).fill(scenario.payDateInput);
    await page.getByLabel(/^Draft note$/i).fill(scenario.draftNote);
    await page.getByRole("button", { name: /^Create payroll draft$/i }).click();

    await expect(page.getByText("Payroll run draft created.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^Selected payroll run$/i }),
    ).toBeVisible();

    const payrollLinesTable = page.locator("table").nth(1);
    await expect(
      payrollLinesTable.getByText("No payroll lines yet. Rebuild this draft first."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Finalize run$/i }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        "Finalization stays disabled until this run has attendance-backed payroll lines only.",
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Rebuild payroll lines$/i }).click();

    await expect(
      page.getByText("Payroll lines rebuilt from attendance facts."),
    ).toBeVisible();

    const workerRow = payrollLinesTable
      .getByRole("row")
      .filter({ hasText: scenario.employeeLabel })
      .first();
    await expect(workerRow).toBeVisible();
    await expect(workerRow).toContainText(scenario.expectedBasePayLabel);
    await expect(
      page.getByRole("button", { name: /^Finalize run$/i }),
    ).toBeEnabled();

    await workerRow.getByRole("link", { name: /^Review$/i }).click();

    await expect(
      page.getByRole("heading", { name: /^Selected employee$/i }),
    ).toBeVisible();
    await expect(page.getByText(scenario.employeeLabel, { exact: true })).toBeVisible();
    await expect(
      page.getByText(`Base attendance pay: ${scenario.expectedBasePayLabel}`),
    ).toBeVisible();
    await expect(
      page.getByText(
        `Government deductions: ${scenario.expectedGovernmentDeductionsLabel}`,
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: /^Finalize run$/i }).click();

    await expect(page.getByText("Payroll run finalized and frozen.")).toBeVisible();
    await expect(page.getByText(/^FINALIZED$/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Mark paid$/i })).toBeVisible();
  });
});
