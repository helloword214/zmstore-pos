import { expect, test } from "@playwright/test";
import {
  DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_ENABLE_ENV,
  cleanupDeliveryPayrollDeductionFollowThroughQaState,
  createDeliveryPayrollDeductionFollowThroughManagerContext,
  expectDeliveryPayrollDeductionFollowThroughInitialDbState,
  expectDeliveryPayrollDeductionFollowThroughPostedDbState,
  isDeliveryPayrollDeductionFollowThroughEnabled,
  openDeliveryPayrollDeductionFollowThroughPage,
  resetDeliveryPayrollDeductionFollowThroughQaState,
  resolveDeliveryPayrollDeductionFollowThroughDbState,
  resolveDeliveryPayrollDeductionFollowThroughScenario,
} from "./delivery-payroll-deduction-follow-through-fixture";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("delivery payroll deduction follow-through", () => {
  test.skip(
    !isDeliveryPayrollDeductionFollowThroughEnabled(),
    `Run \`npm run qa:delivery:payroll-deduction-follow-through:setup\` first, then set ${DELIVERY_PAYROLL_DEDUCTION_FOLLOW_THROUGH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetDeliveryPayrollDeductionFollowThroughQaState();
  });

  test.afterEach(async () => {
    await cleanupDeliveryPayrollDeductionFollowThroughQaState();
  });

  test("manager can settle a charge-rider shortage through payroll deduction follow-through", async ({
    browser,
  }) => {
    const scenario =
      await resolveDeliveryPayrollDeductionFollowThroughScenario();
    const initialState =
      await resolveDeliveryPayrollDeductionFollowThroughDbState();
    expectDeliveryPayrollDeductionFollowThroughInitialDbState(
      initialState,
      scenario,
    );

    const managerContext =
      await createDeliveryPayrollDeductionFollowThroughManagerContext(browser);

    try {
      const page = await managerContext.newPage();

      await openDeliveryPayrollDeductionFollowThroughPage(page);

      await page.getByLabel(/^Period start$/i).fill(scenario.periodStartInput);
      await page.getByLabel(/^Period end$/i).fill(scenario.periodEndInput);
      await page.getByLabel(/^Pay date$/i).fill(scenario.payDateInput);
      await page.getByLabel(/^Draft note$/i).fill(scenario.payrollRunNote);
      await page.getByRole("button", { name: /^Create payroll draft$/i }).click();

      await expect(page.getByText("Payroll run draft created.")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /^Selected payroll run$/i }),
      ).toBeVisible();

      const payrollLinesTable = page.locator("table").nth(1);
      await expect(
        payrollLinesTable.getByText("No payroll lines yet. Rebuild this draft first."),
      ).toBeVisible();

      await page.getByRole("button", { name: /^Rebuild payroll lines$/i }).click();

      await expect(
        page.getByText("Payroll lines rebuilt from attendance facts."),
      ).toBeVisible();

      const riderRow = payrollLinesTable
        .getByRole("row")
        .filter({ hasText: scenario.employeeLabel })
        .first();

      await expect(riderRow).toBeVisible();
      await riderRow
        .getByRole("link", { name: /^(Review|Selected)$/i })
        .click();

      await expect(
        page.getByRole("heading", { name: /^Selected employee$/i }),
      ).toBeVisible();
      await expect(
        page.getByText(scenario.employeeLabel, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(
          new RegExp(
            `Current open payroll-tagged charges:\\s*${escapeRegex(
              scenario.expectedDeductionAmountLabel,
            )} across 1 item\\(s\\)\\.`,
            "i",
          ),
        ),
      ).toBeVisible();
      await expect(
        page.getByText(`RIDER charge #${scenario.riderChargeId}`),
      ).toBeVisible();

      await page
        .getByLabel(/^Full-deduction note$/i)
        .fill(scenario.deductionNote);
      await page
        .getByRole("button", { name: /^Apply full remaining balance$/i })
        .click();

      await page.waitForURL(
        (target) =>
          target.pathname === "/store/payroll" &&
          target.searchParams.get("saved") === "deduction" &&
          target.searchParams.get("employeeId") === String(scenario.employeeId),
        {
          timeout: 10_000,
        },
      );

      await expect(
        page.getByText("Payroll deduction posted to the charge ledgers."),
      ).toBeVisible();
      await expect(
        page.getByText(
          /Current open payroll-tagged charges:\s*₱0\.00 across 0 item\(s\)\./i,
        ),
      ).toBeVisible();
      await expect(
        page.getByText("No open payroll-tagged charges for this employee."),
      ).toBeVisible();
      await expect(
        page.getByText(
          new RegExp(
            `Charge deductions applied in this run:\\s*${escapeRegex(
              scenario.expectedDeductionAmountLabel,
            )}`,
            "i",
          ),
        ),
      ).toBeVisible();

      const postedState =
        await resolveDeliveryPayrollDeductionFollowThroughDbState();
      expectDeliveryPayrollDeductionFollowThroughPostedDbState(
        postedState,
        scenario,
      );
    } finally {
      await managerContext.close();
    }
  });
});
