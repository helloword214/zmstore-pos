import { expect, test } from "@playwright/test";
import {
  PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_ENABLE_ENV,
  bootstrapProductPhotoUploadHappyPathSession,
  cleanupProductPhotoUploadHappyPathQaState,
  expectProductPhotoUploadHappyPathInitialDbState,
  expectProductPhotoUploadHappyPathUpdatedDbState,
  findProductPhotoUploadHappyPathDetailImage,
  isProductPhotoUploadHappyPathEnabled,
  openProductPhotoUploadHappyPathEditPage,
  resetProductPhotoUploadHappyPathQaState,
  resolveProductPhotoUploadHappyPathDbState,
  resolveProductPhotoUploadHappyPathScenario,
} from "./product-photo-upload-happy-path-fixture";

test.describe("product photo upload happy path", () => {
  test.skip(
    !isProductPhotoUploadHappyPathEnabled(),
    `Run \`npm run qa:product:photo-upload:happy-path:setup\` first, then set ${PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async ({ context }) => {
    await resetProductPhotoUploadHappyPathQaState();
    await bootstrapProductPhotoUploadHappyPathSession(context);
  });

  test.afterEach(async () => {
    await cleanupProductPhotoUploadHappyPathQaState();
  });

  test("admin can upload tagged product photos through the real edit form", async ({
    page,
  }) => {
    const scenario = await resolveProductPhotoUploadHappyPathScenario();

    await openProductPhotoUploadHappyPathEditPage(page);

    const initialState = await resolveProductPhotoUploadHappyPathDbState();
    expectProductPhotoUploadHappyPathInitialDbState(initialState, scenario);

    await page
      .locator('input[name="productPhotoFile_1"]')
      .setInputFiles(scenario.runtimeAssets.slotOnePath);
    await page
      .locator('input[name="productPhotoFile_3"]')
      .setInputFiles(scenario.runtimeAssets.slotThreePath);

    await page.getByRole("button", { name: /update product/i }).click();

    await page.waitForURL(
      (target) => target.pathname === `/products/${scenario.productId}`,
      { timeout: 10_000 },
    );
    await expect(
      page.getByRole("heading", { name: /product detail/i }),
    ).toBeVisible();
    await expect(
      findProductPhotoUploadHappyPathDetailImage(page, {
        productName: scenario.productName,
        slot: 1,
      }),
    ).toBeVisible();
    await expect(
      findProductPhotoUploadHappyPathDetailImage(page, {
        productName: scenario.productName,
        slot: 3,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(`Tag: ${scenario.imageTag}`, { exact: true }),
    ).toBeVisible();

    const updatedState = await resolveProductPhotoUploadHappyPathDbState();
    expectProductPhotoUploadHappyPathUpdatedDbState(
      initialState,
      updatedState,
      scenario,
    );
  });
});
