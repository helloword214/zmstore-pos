import { expect, test } from "@playwright/test";
import {
  PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_ENABLE_ENV,
  bootstrapProductTargetIndicationTaggingHappyPathSession,
  cleanupProductTargetIndicationTaggingHappyPathQaState,
  expectProductTargetIndicationTaggingHappyPathInitialDbState,
  expectProductTargetIndicationTaggingHappyPathUpdatedDbState,
  findProductTargetIndicationTaggingHappyPathDetailChip,
  isProductTargetIndicationTaggingHappyPathEnabled,
  openProductTargetIndicationTaggingHappyPathEditPage,
  resetProductTargetIndicationTaggingHappyPathQaState,
  resolveProductTargetIndicationTaggingHappyPathDbState,
  resolveProductTargetIndicationTaggingHappyPathScenario,
  selectProductTargetIndicationTaggingHappyPathOption,
} from "./product-target-indication-tagging-happy-path-fixture";

test.describe("product target indication tagging happy path", () => {
  test.skip(
    !isProductTargetIndicationTaggingHappyPathEnabled(),
    `Run \`npm run qa:product:target-indication-tagging:happy-path:setup\` first, then set ${PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetProductTargetIndicationTaggingHappyPathQaState();
    await bootstrapProductTargetIndicationTaggingHappyPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupProductTargetIndicationTaggingHappyPathQaState();
  });

  test("admin can tag one seeded indication and one seeded target through the real edit form", async ({
    page,
  }) => {
    const scenario =
      await resolveProductTargetIndicationTaggingHappyPathScenario();

    await openProductTargetIndicationTaggingHappyPathEditPage(page);

    const initialState =
      await resolveProductTargetIndicationTaggingHappyPathDbState();
    expectProductTargetIndicationTaggingHappyPathInitialDbState(
      initialState,
      scenario,
    );

    await selectProductTargetIndicationTaggingHappyPathOption(
      page,
      "Indications",
      scenario.indication.name,
    );
    await selectProductTargetIndicationTaggingHappyPathOption(
      page,
      "Targets",
      scenario.target.name,
    );

    await page.getByRole("button", { name: /update product/i }).click();

    await page.waitForURL(
      (target) => target.pathname === `/products/${scenario.productId}`,
      { timeout: 10_000 },
    );
    await expect(
      page.getByRole("heading", { name: /product detail/i }),
    ).toBeVisible();
    await expect(
      findProductTargetIndicationTaggingHappyPathDetailChip(
        page,
        scenario.indication.name,
      ),
    ).toBeVisible();
    await expect(
      findProductTargetIndicationTaggingHappyPathDetailChip(
        page,
        scenario.target.name,
      ),
    ).toBeVisible();

    const updatedState =
      await resolveProductTargetIndicationTaggingHappyPathDbState();
    expectProductTargetIndicationTaggingHappyPathUpdatedDbState(
      initialState,
      updatedState,
      scenario,
    );
  });
});
