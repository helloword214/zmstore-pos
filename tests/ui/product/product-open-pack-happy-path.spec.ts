import { expect, test } from "@playwright/test";
import {
  PRODUCT_OPEN_PACK_HAPPY_PATH_ENABLE_ENV,
  bootstrapProductOpenPackHappyPathSession,
  cleanupProductOpenPackHappyPathQaState,
  expectProductOpenPackHappyPathDetailSnapshot,
  expectProductOpenPackHappyPathInitialDbState,
  expectProductOpenPackHappyPathUpdatedDbState,
  findProductOpenPackHappyPathOpenPackButton,
  isProductOpenPackHappyPathEnabled,
  openProductOpenPackHappyPathDetailPage,
  resetProductOpenPackHappyPathQaState,
  resolveProductOpenPackHappyPathDbState,
  resolveProductOpenPackHappyPathScenario,
} from "./product-open-pack-happy-path-fixture";

test.describe("product open pack happy path", () => {
  test.skip(
    !isProductOpenPackHappyPathEnabled(),
    `Run \`npm run qa:product:open-pack:happy-path:setup\` first, then set ${PRODUCT_OPEN_PACK_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetProductOpenPackHappyPathQaState();
    await bootstrapProductOpenPackHappyPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupProductOpenPackHappyPathQaState();
  });

  test("admin can open tagged whole stock into retail stock from product detail", async ({
    page,
  }) => {
    const scenario = await resolveProductOpenPackHappyPathScenario();

    await openProductOpenPackHappyPathDetailPage(page);
    await expectProductOpenPackHappyPathDetailSnapshot(page, {
      retailStockValue: scenario.initialRetailStockValue,
      wholeStockValue: scenario.initialWholeStockValue,
    });

    const initialState = await resolveProductOpenPackHappyPathDbState();
    expectProductOpenPackHappyPathInitialDbState(initialState, scenario);

    await expect(findProductOpenPackHappyPathOpenPackButton(page)).toBeVisible();

    const dialogPromise = page.waitForEvent("dialog");
    await findProductOpenPackHappyPathOpenPackButton(page).click();
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe("prompt");
    await dialog.accept(scenario.openedPackCountInput);

    await expect(
      page.getByText("Stock opened to retail.", { exact: true }),
    ).toBeVisible();
    await expectProductOpenPackHappyPathDetailSnapshot(page, {
      retailStockValue: scenario.expectedRetailStockValue,
      wholeStockValue: scenario.expectedWholeStockValue,
    });

    const updatedState = await resolveProductOpenPackHappyPathDbState();
    expectProductOpenPackHappyPathUpdatedDbState(
      initialState,
      updatedState,
      scenario,
    );
  });
});
