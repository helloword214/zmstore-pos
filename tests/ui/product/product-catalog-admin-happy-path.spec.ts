import { expect, test } from "@playwright/test";
import {
  PRODUCT_CATALOG_ADMIN_HAPPY_PATH_ENABLE_ENV,
  bootstrapProductCatalogAdminHappyPathSession,
  confirmProductCatalogAdminHappyPathAction,
  expectProductCatalogAdminHappyPathDetail,
  findProductCatalogAdminHappyPathActiveCheckbox,
  findProductCatalogAdminHappyPathListRow,
  findProductCatalogAdminHappyPathRetailCheckbox,
  findProductCatalogAdminHappyPathSaveButton,
  isProductCatalogAdminHappyPathEnabled,
  openProductCatalogAdminHappyPathCreatePage,
  openProductCatalogAdminHappyPathEditPage,
  openProductCatalogAdminHappyPathListPage,
  resetProductCatalogAdminHappyPathQaState,
  resolveProductCatalogAdminHappyPathContext,
  resolveProductCatalogAdminHappyPathProductId,
  resolveProductCatalogAdminHappyPathProductState,
  selectProductCatalogAdminHappyPathOption,
} from "./product-catalog-admin-happy-path-fixture";

test.describe("product catalog admin happy path", () => {
  test.skip(
    !isProductCatalogAdminHappyPathEnabled(),
    `Run \`npm run qa:product:catalog-admin:happy-path:setup\` first, then set ${PRODUCT_CATALOG_ADMIN_HAPPY_PATH_ENABLE_ENV}=1 through the dedicated npm script.`,
  );

  test.beforeEach(async () => {
    await resetProductCatalogAdminHappyPathQaState();
  });

  test.afterEach(async () => {
    await resetProductCatalogAdminHappyPathQaState();
  });

  test("admin can create, edit, deactivate, and reactivate a tagged product", async ({
    browser,
  }) => {
    const scenario = await resolveProductCatalogAdminHappyPathContext();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await bootstrapProductCatalogAdminHappyPathSession(context);
      await openProductCatalogAdminHappyPathCreatePage(page);

      await page.getByLabel(/^Product Name$/i).fill(scenario.createdName);
      await selectProductCatalogAdminHappyPathOption(
        page,
        "Unit",
        scenario.unit.name,
      );
      await selectProductCatalogAdminHappyPathOption(
        page,
        "Category",
        scenario.category.name,
      );

      await findProductCatalogAdminHappyPathRetailCheckbox(page).check();
      await expect(findProductCatalogAdminHappyPathActiveCheckbox(page)).toBeChecked();

      await page.getByLabel(/^Packing Size$/i).fill(scenario.packingSizeInput);
      await selectProductCatalogAdminHappyPathOption(
        page,
        "Packing Unit",
        scenario.packingUnit.name,
      );
      await page.getByLabel(/^Whole Unit Price$/i).fill(scenario.wholePriceInput);
      await page.getByLabel(/^Cost Price$/i).fill(scenario.costPriceInput);
      await page.getByLabel(/^Retail Price$/i).fill(scenario.retailPriceInput);
      await page.getByLabel(/^Retail Stock$/i).fill(scenario.retailStockInput);
      await page.getByLabel(/^Whole Stock$/i).fill(scenario.wholeStockInput);
      await page.getByLabel(/^Min Stock$/i).fill(scenario.minStockInput);
      await page.getByLabel(/^Description$/i).fill(scenario.createdDescription);
      await page.getByLabel(/^Image Tag$/i).fill(scenario.imageTag);

      await confirmProductCatalogAdminHappyPathAction(page, async () => {
        await findProductCatalogAdminHappyPathSaveButton(page).click();
      });

      await expectProductCatalogAdminHappyPathDetail(
        page,
        scenario.createdName,
        "Active",
      );

      const productId = resolveProductCatalogAdminHappyPathProductId(page.url());

      const createdState =
        await resolveProductCatalogAdminHappyPathProductState(productId);
      expect(createdState).not.toBeNull();
      expect(createdState?.name).toBe(scenario.createdName);
      expect(createdState?.description).toBe(scenario.createdDescription);
      expect(createdState?.imageTag).toBe(scenario.imageTag);
      expect(createdState?.isActive).toBe(true);
      expect(createdState?.allowPackSale).toBe(true);
      expect(createdState?.categoryId).toBe(scenario.category.id);
      expect(createdState?.unitId).toBe(scenario.unit.id);
      expect(createdState?.packingUnitId).toBe(scenario.packingUnit.id);
      expect(createdState?.packingSize).toBe(
        Number(scenario.packingSizeInput),
      );
      expect(createdState?.srp).toBe(Number(scenario.wholePriceInput));
      expect(createdState?.dealerPrice).toBe(Number(scenario.costPriceInput));
      expect(createdState?.price).toBe(Number(scenario.retailPriceInput));
      expect(createdState?.stock).toBe(Number(scenario.wholeStockInput));
      expect(createdState?.packingStock).toBe(
        Number(scenario.retailStockInput),
      );
      expect(createdState?.minStock).toBe(Number(scenario.minStockInput));
      expect(createdState?.indicationCount).toBe(0);
      expect(createdState?.targetCount).toBe(0);

      await openProductCatalogAdminHappyPathListPage(page);
      await expect(
        findProductCatalogAdminHappyPathListRow(page, productId),
      ).toContainText(scenario.createdName);

      await openProductCatalogAdminHappyPathEditPage(page, productId);
      await page.getByLabel(/^Product Name$/i).fill(scenario.updatedName);
      await page
        .getByLabel(/^Whole Unit Price$/i)
        .fill(scenario.updatedWholePriceInput);
      await page
        .getByLabel(/^Cost Price$/i)
        .fill(scenario.updatedCostPriceInput);
      await page
        .getByLabel(/^Retail Price$/i)
        .fill(scenario.updatedRetailPriceInput);
      await page.getByLabel(/^Description$/i).fill(scenario.updatedDescription);
      await findProductCatalogAdminHappyPathActiveCheckbox(page).uncheck();

      await confirmProductCatalogAdminHappyPathAction(page, async () => {
        await findProductCatalogAdminHappyPathSaveButton(page).click();
      });

      await expectProductCatalogAdminHappyPathDetail(
        page,
        scenario.updatedName,
        "Inactive",
      );

      const updatedState =
        await resolveProductCatalogAdminHappyPathProductState(productId);
      expect(updatedState).not.toBeNull();
      expect(updatedState?.name).toBe(scenario.updatedName);
      expect(updatedState?.description).toBe(scenario.updatedDescription);
      expect(updatedState?.isActive).toBe(false);
      expect(updatedState?.srp).toBe(Number(scenario.updatedWholePriceInput));
      expect(updatedState?.dealerPrice).toBe(
        Number(scenario.updatedCostPriceInput),
      );
      expect(updatedState?.price).toBe(
        Number(scenario.updatedRetailPriceInput),
      );

      await openProductCatalogAdminHappyPathListPage(page);
      await expect(
        findProductCatalogAdminHappyPathListRow(page, productId),
      ).toContainText(scenario.updatedName);

      await openProductCatalogAdminHappyPathEditPage(page, productId);
      await findProductCatalogAdminHappyPathActiveCheckbox(page).check();

      await confirmProductCatalogAdminHappyPathAction(page, async () => {
        await findProductCatalogAdminHappyPathSaveButton(page).click();
      });

      await expectProductCatalogAdminHappyPathDetail(
        page,
        scenario.updatedName,
        "Active",
      );

      const reactivatedState =
        await resolveProductCatalogAdminHappyPathProductState(productId);
      expect(reactivatedState).not.toBeNull();
      expect(reactivatedState?.isActive).toBe(true);
      expect(reactivatedState?.name).toBe(scenario.updatedName);
      expect(reactivatedState?.imageTag).toBe(scenario.imageTag);
    } finally {
      await context.close();
    }
  });
});
