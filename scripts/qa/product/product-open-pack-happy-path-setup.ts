import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_ADMIN_EMAIL = "admin@local";

export const PRODUCT_OPEN_PACK_HAPPY_PATH_IMAGE_TAG =
  "QA-PRODUCT-OPEN-PACK-HAPPY-PATH";
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_NAME =
  "QA Product Open Pack Happy Path";
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_DESCRIPTION =
  "QA product seeded for the product open-pack happy path.";
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_PACKING_SIZE = 12;
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_OPEN_PACK_COUNT = 2;
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_WHOLE_PRICE = 240;
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_COST_PRICE = 180;
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_RETAIL_PRICE = 20;
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_WHOLE_STOCK = 8;
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_RETAIL_STOCK = 6;
export const PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_MIN_STOCK = 2;

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

type SeedSummary = {
  expectedRetailStock: number;
  expectedWholeStock: number;
  openedPackCount: number;
  productId: number;
};

export type ProductOpenPackHappyPathScenarioContext = {
  admin: AdminUser;
  category: ReferenceOption;
  detailRoute: string;
  expectedRetailStockValue: string;
  expectedWholeStockValue: string;
  imageTag: string;
  initialRetailStockValue: string;
  initialWholeStockValue: string;
  openedPackCountInput: string;
  packingUnit: ReferenceOption;
  productId: number;
  productName: string;
  unit: ReferenceOption;
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

function toDisplayNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

export function resolveProductOpenPackHappyPathAdminEmail() {
  return normalizeEmail(
    process.env.QA_PRODUCT_OPEN_PACK_HAPPY_PATH_ADMIN_EMAIL ??
      process.env.UI_ADMIN_EMAIL ??
      DEFAULT_ADMIN_EMAIL,
  );
}

export function resolveProductOpenPackHappyPathImageTag() {
  return (
    process.env.QA_PRODUCT_OPEN_PACK_HAPPY_PATH_IMAGE_TAG ??
    PRODUCT_OPEN_PACK_HAPPY_PATH_IMAGE_TAG
  ).trim();
}

export function resolveProductOpenPackHappyPathName() {
  return (
    process.env.QA_PRODUCT_OPEN_PACK_HAPPY_PATH_NAME ??
    PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_NAME
  ).trim();
}

export function resolveProductOpenPackHappyPathOpenPackCount() {
  const parsed = Number(
    process.env.QA_PRODUCT_OPEN_PACK_HAPPY_PATH_OPEN_PACK_COUNT ??
      PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_OPEN_PACK_COUNT,
  );

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Product open-pack happy path requires a positive pack count.");
  }

  return Math.max(1, Math.floor(parsed));
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
      `Product open-pack happy path requires an active ADMIN account: ${email}`,
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
      throw new Error("Product open-pack happy path requires at least one active category.");
    }

    return category;
  }

  if (model === "unit") {
    const unit = await db.unit.findFirst({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    if (!unit) {
      throw new Error("Product open-pack happy path requires at least one unit.");
    }

    return unit;
  }

  const packingUnit = await db.packingUnit.findFirst({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (!packingUnit) {
    throw new Error("Product open-pack happy path requires at least one packing unit.");
  }

  return packingUnit;
}

async function resolveSeededProduct() {
  return db.product.findFirst({
    where: { imageTag: resolveProductOpenPackHappyPathImageTag() },
    orderBy: { id: "desc" },
    select: {
      id: true,
      name: true,
      packingSize: true,
      packingStock: true,
      stock: true,
    },
  });
}

async function seedProduct(): Promise<SeedSummary> {
  const [category, unit, packingUnit] = await Promise.all([
    resolveReferenceOption("category"),
    resolveReferenceOption("unit"),
    resolveReferenceOption("packingUnit"),
  ]);

  const created = await db.product.create({
    data: {
      allowPackSale: true,
      categoryId: category.id,
      dealerPrice: Number(
        toFixedCurrencyInput(PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_COST_PRICE),
      ),
      description: PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_DESCRIPTION,
      imageTag: resolveProductOpenPackHappyPathImageTag(),
      isActive: true,
      minStock: PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_MIN_STOCK,
      name: resolveProductOpenPackHappyPathName(),
      packingSize: PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_PACKING_SIZE,
      packingStock: PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_RETAIL_STOCK,
      packingUnitId: packingUnit.id,
      price: Number(
        toFixedCurrencyInput(PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_RETAIL_PRICE),
      ),
      srp: Number(
        toFixedCurrencyInput(PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_WHOLE_PRICE),
      ),
      stock: PRODUCT_OPEN_PACK_HAPPY_PATH_DEFAULT_WHOLE_STOCK,
      unitId: unit.id,
    },
    select: {
      id: true,
      packingSize: true,
      packingStock: true,
      stock: true,
    },
  });

  const initialWholeStock = Number(created.stock ?? 0);
  const initialRetailStock = Number(created.packingStock ?? 0);
  const packingSize = Number(created.packingSize ?? 0);
  const openedPackCount = resolveProductOpenPackHappyPathOpenPackCount();

  return {
    expectedRetailStock: initialRetailStock + openedPackCount * packingSize,
    expectedWholeStock: initialWholeStock - openedPackCount,
    openedPackCount,
    productId: created.id,
  };
}

export async function deleteProductOpenPackHappyPathArtifacts(): Promise<DeleteSummary> {
  const deletedProducts = await db.product.deleteMany({
    where: { imageTag: resolveProductOpenPackHappyPathImageTag() },
  });

  return {
    deletedProducts: deletedProducts.count,
  };
}

export async function resetProductOpenPackHappyPathState() {
  const deleted = await deleteProductOpenPackHappyPathArtifacts();
  const admin = await resolveAdminUser(
    resolveProductOpenPackHappyPathAdminEmail(),
  );
  const seeded = await seedProduct();

  return { admin, deleted, seeded };
}

export async function resolveProductOpenPackHappyPathScenarioContext(): Promise<
  ProductOpenPackHappyPathScenarioContext
> {
  const admin = await resolveAdminUser(
    resolveProductOpenPackHappyPathAdminEmail(),
  );
  const [category, unit, packingUnit, product] = await Promise.all([
    resolveReferenceOption("category"),
    resolveReferenceOption("unit"),
    resolveReferenceOption("packingUnit"),
    resolveSeededProduct(),
  ]);

  if (!product) {
    throw new Error(
      "Product open-pack happy path requires a seeded tagged product. Run the setup first.",
    );
  }

  const initialWholeStock = Number(product.stock ?? 0);
  const initialRetailStock = Number(product.packingStock ?? 0);
  const packingSize = Number(product.packingSize ?? 0);
  const openedPackCount = resolveProductOpenPackHappyPathOpenPackCount();

  return {
    admin,
    category,
    detailRoute: `/products/${product.id}`,
    expectedRetailStockValue: toDisplayNumber(
      initialRetailStock + openedPackCount * packingSize,
    ),
    expectedWholeStockValue: toDisplayNumber(initialWholeStock - openedPackCount),
    imageTag: resolveProductOpenPackHappyPathImageTag(),
    initialRetailStockValue: toDisplayNumber(initialRetailStock),
    initialWholeStockValue: toDisplayNumber(initialWholeStock),
    openedPackCountInput: String(openedPackCount),
    packingUnit,
    productId: product.id,
    productName: product.name,
    unit,
  };
}

async function main() {
  const { admin, deleted, seeded } = await resetProductOpenPackHappyPathState();
  const scenario = await resolveProductOpenPackHappyPathScenarioContext();

  console.log(
    [
      "Product open-pack happy path setup is ready.",
      `Admin: ${admin.email ?? `user#${admin.id}`} [userId=${admin.id}]`,
      `Detail route: ${scenario.detailRoute}`,
      `Tagged product: ${scenario.productName} [productId=${seeded.productId}]`,
      `Image tag marker: ${scenario.imageTag}`,
      `Category: ${scenario.category.name} [id=${scenario.category.id}]`,
      `Unit: ${scenario.unit.name} [id=${scenario.unit.id}]`,
      `Packing unit: ${scenario.packingUnit.name} [id=${scenario.packingUnit.id}]`,
      `Initial whole stock: ${scenario.initialWholeStockValue}`,
      `Initial retail stock: ${scenario.initialRetailStockValue}`,
      `Open pack count: ${seeded.openedPackCount}`,
      `Expected whole stock after open-pack: ${seeded.expectedWholeStock}`,
      `Expected retail stock after open-pack: ${seeded.expectedRetailStock}`,
      `Deleted previous tagged products: ${deleted.deletedProducts}`,
      "Next manual QA steps:",
      "1. Open the printed detail route as ADMIN.",
      "2. Confirm the Open Pack action is available.",
      "3. Submit the printed pack count through the prompt.",
      "4. Confirm the success alert and updated whole or retail stock snapshot.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown product open-pack happy-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
