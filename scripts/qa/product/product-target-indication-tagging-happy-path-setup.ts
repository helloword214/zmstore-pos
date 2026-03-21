import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_ADMIN_EMAIL = "admin@local";

export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_IMAGE_TAG =
  "QA-PRODUCT-TARGET-INDICATION-TAGGING-HAPPY-PATH";
export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_NAME =
  "QA Product Target Indication Tagging Happy Path";
export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_DESCRIPTION =
  "QA product seeded for the product target and indication tagging happy path.";
export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_PACKING_SIZE = 12;
export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_WHOLE_PRICE = 240;
export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_COST_PRICE = 180;
export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_RETAIL_PRICE = 20;
export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_WHOLE_STOCK = 5;
export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_RETAIL_STOCK = 4;
export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_MIN_STOCK = 2;

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

type CategoryTagRefs = {
  category: ReferenceOption;
  indication: ReferenceOption;
  target: ReferenceOption;
};

type DeleteSummary = {
  deletedProducts: number;
};

type SeedSummary = {
  productId: number;
};

export type ProductTargetIndicationTaggingHappyPathScenarioContext = {
  admin: AdminUser;
  category: ReferenceOption;
  detailRoute: string;
  editRoute: string;
  imageTag: string;
  indication: ReferenceOption;
  initialRetailStockValue: string;
  initialWholeStockValue: string;
  packingUnit: ReferenceOption;
  productId: number;
  productName: string;
  target: ReferenceOption;
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

export function resolveProductTargetIndicationTaggingHappyPathAdminEmail() {
  return normalizeEmail(
    process.env.QA_PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_ADMIN_EMAIL ??
      process.env.UI_ADMIN_EMAIL ??
      DEFAULT_ADMIN_EMAIL,
  );
}

export function resolveProductTargetIndicationTaggingHappyPathImageTag() {
  return (
    process.env.QA_PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_IMAGE_TAG ??
    PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_IMAGE_TAG
  ).trim();
}

export function resolveProductTargetIndicationTaggingHappyPathName() {
  return (
    process.env.QA_PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_NAME ??
    PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_NAME
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
      `Product target/indication tagging happy path requires an active ADMIN account: ${email}`,
    );
  }

  return admin;
}

async function resolveReferenceOption(model: "unit" | "packingUnit") {
  if (model === "unit") {
    const unit = await db.unit.findFirst({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    if (!unit) {
      throw new Error(
        "Product target/indication tagging happy path requires at least one unit.",
      );
    }

    return unit;
  }

  const packingUnit = await db.packingUnit.findFirst({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (!packingUnit) {
    throw new Error(
      "Product target/indication tagging happy path requires at least one packing unit.",
    );
  }

  return packingUnit;
}

async function resolveCategoryTagRefs(): Promise<CategoryTagRefs> {
  const category = await db.category.findFirst({
    where: {
      isActive: true,
      indications: {
        some: {},
      },
      targets: {
        some: {},
      },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      indications: {
        orderBy: { name: "asc" },
        select: { id: true, name: true },
        take: 1,
      },
      targets: {
        orderBy: { name: "asc" },
        select: { id: true, name: true },
        take: 1,
      },
    },
  });

  if (!category || category.indications.length === 0 || category.targets.length === 0) {
    throw new Error(
      "Product target/indication tagging happy path requires one active category with at least one indication and one target.",
    );
  }

  return {
    category: { id: category.id, name: category.name },
    indication: category.indications[0],
    target: category.targets[0],
  };
}

async function resolveSeededProduct() {
  return db.product.findFirst({
    where: {
      imageTag: resolveProductTargetIndicationTaggingHappyPathImageTag(),
    },
    orderBy: { id: "desc" },
    select: {
      id: true,
      imageTag: true,
      name: true,
      packingStock: true,
      stock: true,
    },
  });
}

async function seedProduct(): Promise<SeedSummary> {
  const [categoryRefs, unit, packingUnit] = await Promise.all([
    resolveCategoryTagRefs(),
    resolveReferenceOption("unit"),
    resolveReferenceOption("packingUnit"),
  ]);

  const created = await db.product.create({
    data: {
      allowPackSale: true,
      categoryId: categoryRefs.category.id,
      dealerPrice: Number(
        toFixedCurrencyInput(
          PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_COST_PRICE,
        ),
      ),
      description:
        PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_DESCRIPTION,
      imageTag: resolveProductTargetIndicationTaggingHappyPathImageTag(),
      isActive: true,
      minStock:
        PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_MIN_STOCK,
      name: resolveProductTargetIndicationTaggingHappyPathName(),
      packingSize:
        PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_PACKING_SIZE,
      packingStock:
        PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_RETAIL_STOCK,
      packingUnitId: packingUnit.id,
      price: Number(
        toFixedCurrencyInput(
          PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_RETAIL_PRICE,
        ),
      ),
      srp: Number(
        toFixedCurrencyInput(
          PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_WHOLE_PRICE,
        ),
      ),
      stock: PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_DEFAULT_WHOLE_STOCK,
      unitId: unit.id,
    },
    select: {
      id: true,
    },
  });

  return {
    productId: created.id,
  };
}

export async function deleteProductTargetIndicationTaggingHappyPathArtifacts(): Promise<
  DeleteSummary
> {
  const deletedProducts = await db.product.deleteMany({
    where: {
      imageTag: resolveProductTargetIndicationTaggingHappyPathImageTag(),
    },
  });

  return {
    deletedProducts: deletedProducts.count,
  };
}

export async function resetProductTargetIndicationTaggingHappyPathState() {
  const deleted = await deleteProductTargetIndicationTaggingHappyPathArtifacts();
  const admin = await resolveAdminUser(
    resolveProductTargetIndicationTaggingHappyPathAdminEmail(),
  );
  const seeded = await seedProduct();

  return { admin, deleted, seeded };
}

export async function resolveProductTargetIndicationTaggingHappyPathScenarioContext(): Promise<
  ProductTargetIndicationTaggingHappyPathScenarioContext
> {
  const [admin, categoryRefs, unit, packingUnit, product] = await Promise.all([
    resolveAdminUser(resolveProductTargetIndicationTaggingHappyPathAdminEmail()),
    resolveCategoryTagRefs(),
    resolveReferenceOption("unit"),
    resolveReferenceOption("packingUnit"),
    resolveSeededProduct(),
  ]);

  if (!product) {
    throw new Error(
      "Product target/indication tagging happy path requires a seeded tagged product. Run the setup first.",
    );
  }

  return {
    admin,
    category: categoryRefs.category,
    detailRoute: `/products/${product.id}`,
    editRoute: `/products/${product.id}/edit`,
    imageTag: product.imageTag ??
      resolveProductTargetIndicationTaggingHappyPathImageTag(),
    indication: categoryRefs.indication,
    initialRetailStockValue: toDisplayNumber(Number(product.packingStock ?? 0)),
    initialWholeStockValue: toDisplayNumber(Number(product.stock ?? 0)),
    packingUnit,
    productId: product.id,
    productName: product.name,
    target: categoryRefs.target,
    unit,
  };
}

async function main() {
  const { admin, deleted, seeded } =
    await resetProductTargetIndicationTaggingHappyPathState();
  const scenario =
    await resolveProductTargetIndicationTaggingHappyPathScenarioContext();

  console.log(
    [
      "Product target/indication tagging happy path setup is ready.",
      `Admin: ${admin.email ?? `user#${admin.id}`} [userId=${admin.id}]`,
      `Edit route: ${scenario.editRoute}`,
      `Detail route: ${scenario.detailRoute}`,
      `Tagged product: ${scenario.productName} [productId=${seeded.productId}]`,
      `Image tag marker: ${scenario.imageTag}`,
      `Category: ${scenario.category.name} [id=${scenario.category.id}]`,
      `Indication: ${scenario.indication.name} [id=${scenario.indication.id}]`,
      `Target: ${scenario.target.name} [id=${scenario.target.id}]`,
      `Deleted previous tagged products: ${deleted.deletedProducts}`,
      "Next manual QA steps:",
      "1. Open the printed edit route as ADMIN.",
      "2. Add the printed indication and target through the real multi-select controls.",
      "3. Save the product and confirm the browser lands on the detail route.",
      "4. Verify both chips appear under Indications and Targets.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown product target/indication tagging happy-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
