import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_ADMIN_EMAIL = "admin@local";

export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_IMAGE_TAG =
  "QA-PRODUCT-CATALOG-ADMIN-HAPPY-PATH";
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_NAME =
  "QA Product Catalog Admin Happy Path";
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_NAME =
  "QA Product Catalog Admin Happy Path Updated";
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_DESCRIPTION =
  "QA product seeded for the admin catalog happy path.";
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_DESCRIPTION =
  "QA product updated during the admin catalog happy path.";
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_PACKING_SIZE = 12;
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_WHOLE_PRICE = 240;
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_WHOLE_PRICE = 252;
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_COST_PRICE = 180;
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_COST_PRICE = 189;
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_RETAIL_PRICE = 20;
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_RETAIL_PRICE = 21;
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_WHOLE_STOCK = 8;
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_RETAIL_STOCK = 24;
export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_MIN_STOCK = 2;

type AdminUser = {
  id: number;
  email: string | null;
  role: UserRole;
  active: boolean;
};

type ReferenceOption = {
  id: number;
  name: string;
};

type DeleteSummary = {
  deletedProducts: number;
};

type ScenarioContext = {
  admin: AdminUser;
  adminRoute: string;
  category: ReferenceOption;
  createdDescription: string;
  createdName: string;
  costPriceInput: string;
  imageTag: string;
  listRoute: string;
  minStockInput: string;
  packingSizeInput: string;
  packingUnit: ReferenceOption;
  retailPriceInput: string;
  retailStockInput: string;
  unit: ReferenceOption;
  updatedCostPriceInput: string;
  updatedDescription: string;
  updatedName: string;
  updatedRetailPriceInput: string;
  updatedWholePriceInput: string;
  wholePriceInput: string;
  wholeStockInput: string;
};

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function toFixedCurrencyInput(value: number) {
  return value.toFixed(2);
}

export function resolveProductCatalogAdminHappyPathAdminEmail() {
  return normalizeEmail(
    process.env.QA_PRODUCT_CATALOG_ADMIN_HAPPY_PATH_ADMIN_EMAIL ??
      process.env.UI_ADMIN_EMAIL ??
      DEFAULT_ADMIN_EMAIL,
  );
}

export function resolveProductCatalogAdminHappyPathImageTag() {
  return (
    process.env.QA_PRODUCT_CATALOG_ADMIN_HAPPY_PATH_IMAGE_TAG ??
    PRODUCT_CATALOG_ADMIN_HAPPY_PATH_IMAGE_TAG
  ).trim();
}

export function resolveProductCatalogAdminHappyPathCreatedName() {
  return (
    process.env.QA_PRODUCT_CATALOG_ADMIN_HAPPY_PATH_NAME ??
    PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_NAME
  ).trim();
}

export function resolveProductCatalogAdminHappyPathUpdatedName() {
  return (
    process.env.QA_PRODUCT_CATALOG_ADMIN_HAPPY_PATH_UPDATED_NAME ??
    PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_NAME
  ).trim();
}

async function resolveAdminUser(email: string) {
  const admin = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
    },
  });

  if (!admin || !admin.active || admin.role !== UserRole.ADMIN) {
    throw new Error(
      `Product catalog happy path requires an active ADMIN account: ${email}`,
    );
  }

  return admin;
}

async function resolveReferenceOption(model: "category" | "unit" | "packingUnit") {
  if (model === "category") {
    const category = await db.category.findFirst({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    if (!category) {
      throw new Error("Product catalog happy path requires at least one active category.");
    }
    return category;
  }

  if (model === "unit") {
    const unit = await db.unit.findFirst({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    if (!unit) {
      throw new Error("Product catalog happy path requires at least one retail unit.");
    }
    return unit;
  }

  const packingUnit = await db.packingUnit.findFirst({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  if (!packingUnit) {
    throw new Error("Product catalog happy path requires at least one packing unit.");
  }
  return packingUnit;
}

export async function deleteProductCatalogAdminHappyPathArtifacts(): Promise<DeleteSummary> {
  const deletedProducts = await db.product.deleteMany({
    where: { imageTag: resolveProductCatalogAdminHappyPathImageTag() },
  });

  return {
    deletedProducts: deletedProducts.count,
  };
}

export async function resetProductCatalogAdminHappyPathState() {
  const deleted = await deleteProductCatalogAdminHappyPathArtifacts();
  const admin = await resolveAdminUser(
    resolveProductCatalogAdminHappyPathAdminEmail(),
  );

  return { admin, deleted };
}

export async function resolveProductCatalogAdminHappyPathScenarioContext(): Promise<ScenarioContext> {
  const admin = await resolveAdminUser(
    resolveProductCatalogAdminHappyPathAdminEmail(),
  );
  const [category, unit, packingUnit] = await Promise.all([
    resolveReferenceOption("category"),
    resolveReferenceOption("unit"),
    resolveReferenceOption("packingUnit"),
  ]);

  return {
    admin,
    adminRoute: "/products/new",
    category,
    createdDescription: PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_DESCRIPTION,
    createdName: resolveProductCatalogAdminHappyPathCreatedName(),
    costPriceInput: toFixedCurrencyInput(
      PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_COST_PRICE,
    ),
    imageTag: resolveProductCatalogAdminHappyPathImageTag(),
    listRoute: "/products",
    minStockInput: String(PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_MIN_STOCK),
    packingSizeInput: String(PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_PACKING_SIZE),
    packingUnit,
    retailPriceInput: toFixedCurrencyInput(
      PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_RETAIL_PRICE,
    ),
    retailStockInput: String(
      PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_RETAIL_STOCK,
    ),
    unit,
    updatedCostPriceInput: toFixedCurrencyInput(
      PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_COST_PRICE,
    ),
    updatedDescription:
      PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_DESCRIPTION,
    updatedName: resolveProductCatalogAdminHappyPathUpdatedName(),
    updatedRetailPriceInput: toFixedCurrencyInput(
      PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_RETAIL_PRICE,
    ),
    updatedWholePriceInput: toFixedCurrencyInput(
      PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_UPDATED_WHOLE_PRICE,
    ),
    wholePriceInput: toFixedCurrencyInput(
      PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_WHOLE_PRICE,
    ),
    wholeStockInput: String(PRODUCT_CATALOG_ADMIN_HAPPY_PATH_DEFAULT_WHOLE_STOCK),
  };
}

async function main() {
  const { deleted, admin } = await resetProductCatalogAdminHappyPathState();
  const scenario =
    await resolveProductCatalogAdminHappyPathScenarioContext();

  console.log(
    [
      "Product catalog admin happy path setup is ready.",
      `Admin: ${admin.email ?? `user#${admin.id}`} [userId=${admin.id}]`,
      `Create route: ${scenario.adminRoute}`,
      `List route: ${scenario.listRoute}`,
      `Category: ${scenario.category.name} [id=${scenario.category.id}]`,
      `Unit: ${scenario.unit.name} [id=${scenario.unit.id}]`,
      `Packing unit: ${scenario.packingUnit.name} [id=${scenario.packingUnit.id}]`,
      `Tagged product name: ${scenario.createdName}`,
      `Updated product name: ${scenario.updatedName}`,
      `Image tag marker: ${scenario.imageTag}`,
      `Whole price: ${scenario.wholePriceInput}`,
      `Retail price: ${scenario.retailPriceInput}`,
      `Deleted previous tagged products: ${deleted.deletedProducts}`,
      "Next manual QA steps:",
      "1. Open /products/new as ADMIN.",
      "2. Create the tagged product with the printed category, unit, and packing unit.",
      "3. Verify the product detail and list states.",
      "4. Edit the tagged product, change the printed fields, and flip active state.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown product catalog happy-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
