import "dotenv/config";

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { storage } from "~/utils/storage.server";
import { db } from "~/utils/db.server";

const DEFAULT_ADMIN_EMAIL = "admin@local";
const PHOTO_ASSET_DIR = path.resolve(
  "test-results/ui/qa/product-photo-upload-happy-path",
);

const SLOT_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9kAAAAASUVORK5CYII=";
const SLOT_THREE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNk+M/wHwAEAQH/8fN9WQAAAABJRU5ErkJggg==";

export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_IMAGE_TAG =
  "QA-PRODUCT-PHOTO-UPLOAD-HAPPY-PATH";
export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_NAME =
  "QA Product Photo Upload Happy Path";
export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_DESCRIPTION =
  "QA product seeded for the product photo upload happy path.";
export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_PACKING_SIZE = 12;
export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_WHOLE_PRICE = 240;
export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_COST_PRICE = 180;
export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_RETAIL_PRICE = 20;
export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_WHOLE_STOCK = 5;
export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_RETAIL_STOCK = 4;
export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_MIN_STOCK = 2;

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
  deletedPhotoFiles: number;
  deletedProducts: number;
};

type RuntimeAssetSet = {
  slotOnePath: string;
  slotOneSizeBytes: number;
  slotThreePath: string;
  slotThreeSizeBytes: number;
};

type SeedSummary = {
  productId: number;
};

export type ProductPhotoUploadHappyPathScenarioContext = {
  admin: AdminUser;
  category: ReferenceOption;
  detailRoute: string;
  editRoute: string;
  imageTag: string;
  initialRetailStockValue: string;
  initialWholeStockValue: string;
  packingUnit: ReferenceOption;
  productId: number;
  productName: string;
  runtimeAssets: RuntimeAssetSet;
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

function decodeBase64File(base64: string) {
  return Buffer.from(base64, "base64");
}

async function ensureRuntimeAssetFiles(): Promise<RuntimeAssetSet> {
  await fs.mkdir(PHOTO_ASSET_DIR, { recursive: true });

  const slotOnePath = path.join(PHOTO_ASSET_DIR, "slot-1.png");
  const slotThreePath = path.join(PHOTO_ASSET_DIR, "slot-3.png");
  const slotOneBuffer = decodeBase64File(SLOT_ONE_PNG_BASE64);
  const slotThreeBuffer = decodeBase64File(SLOT_THREE_PNG_BASE64);

  await fs.writeFile(slotOnePath, slotOneBuffer);
  await fs.writeFile(slotThreePath, slotThreeBuffer);

  return {
    slotOnePath,
    slotOneSizeBytes: slotOneBuffer.length,
    slotThreePath,
    slotThreeSizeBytes: slotThreeBuffer.length,
  };
}

export async function deleteProductPhotoUploadHappyPathRuntimeAssets() {
  await fs.rm(PHOTO_ASSET_DIR, { recursive: true, force: true });
}

export function resolveProductPhotoUploadHappyPathAdminEmail() {
  return normalizeEmail(
    process.env.QA_PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_ADMIN_EMAIL ??
      process.env.UI_ADMIN_EMAIL ??
      DEFAULT_ADMIN_EMAIL,
  );
}

export function resolveProductPhotoUploadHappyPathImageTag() {
  return (
    process.env.QA_PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_IMAGE_TAG ??
    PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_IMAGE_TAG
  ).trim();
}

export function resolveProductPhotoUploadHappyPathName() {
  return (
    process.env.QA_PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_NAME ??
    PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_NAME
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
      `Product photo upload happy path requires an active ADMIN account: ${email}`,
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
      throw new Error(
        "Product photo upload happy path requires at least one active category.",
      );
    }

    return category;
  }

  if (model === "unit") {
    const unit = await db.unit.findFirst({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    if (!unit) {
      throw new Error("Product photo upload happy path requires at least one unit.");
    }

    return unit;
  }

  const packingUnit = await db.packingUnit.findFirst({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  if (!packingUnit) {
    throw new Error(
      "Product photo upload happy path requires at least one packing unit.",
    );
  }

  return packingUnit;
}

async function resolveSeededProduct() {
  return db.product.findFirst({
    where: { imageTag: resolveProductPhotoUploadHappyPathImageTag() },
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
        toFixedCurrencyInput(PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_COST_PRICE),
      ),
      description: PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_DESCRIPTION,
      imageTag: resolveProductPhotoUploadHappyPathImageTag(),
      isActive: true,
      minStock: PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_MIN_STOCK,
      name: resolveProductPhotoUploadHappyPathName(),
      packingSize: PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_PACKING_SIZE,
      packingStock: PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_RETAIL_STOCK,
      packingUnitId: packingUnit.id,
      price: Number(
        toFixedCurrencyInput(PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_RETAIL_PRICE),
      ),
      srp: Number(
        toFixedCurrencyInput(PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_WHOLE_PRICE),
      ),
      stock: PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_DEFAULT_WHOLE_STOCK,
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

export async function deleteProductPhotoUploadHappyPathArtifacts(): Promise<
  DeleteSummary
> {
  const products = await db.product.findMany({
    where: { imageTag: resolveProductPhotoUploadHappyPathImageTag() },
    select: {
      id: true,
      photos: {
        select: {
          fileKey: true,
        },
      },
    },
  });

  const photoKeys = Array.from(
    new Set(
      products.flatMap((product) =>
        product.photos
          .map((photo) => photo.fileKey)
          .filter((fileKey): fileKey is string => Boolean(fileKey)),
      ),
    ),
  );

  for (const key of photoKeys) {
    try {
      await storage.delete(key);
    } catch {
      // ignore missing storage keys during cleanup
    }
  }

  const deletedProducts = await db.product.deleteMany({
    where: { imageTag: resolveProductPhotoUploadHappyPathImageTag() },
  });

  await deleteProductPhotoUploadHappyPathRuntimeAssets();

  return {
    deletedPhotoFiles: photoKeys.length,
    deletedProducts: deletedProducts.count,
  };
}

export async function resetProductPhotoUploadHappyPathState() {
  const deleted = await deleteProductPhotoUploadHappyPathArtifacts();
  const admin = await resolveAdminUser(
    resolveProductPhotoUploadHappyPathAdminEmail(),
  );
  const seeded = await seedProduct();
  const runtimeAssets = await ensureRuntimeAssetFiles();

  return { admin, deleted, runtimeAssets, seeded };
}

export async function resolveProductPhotoUploadHappyPathScenarioContext(): Promise<
  ProductPhotoUploadHappyPathScenarioContext
> {
  const admin = await resolveAdminUser(
    resolveProductPhotoUploadHappyPathAdminEmail(),
  );
  const [category, unit, packingUnit, product, runtimeAssets] = await Promise.all([
    resolveReferenceOption("category"),
    resolveReferenceOption("unit"),
    resolveReferenceOption("packingUnit"),
    resolveSeededProduct(),
    ensureRuntimeAssetFiles(),
  ]);

  if (!product) {
    throw new Error(
      "Product photo upload happy path requires a seeded tagged product. Run the setup first.",
    );
  }

  return {
    admin,
    category,
    detailRoute: `/products/${product.id}`,
    editRoute: `/products/${product.id}/edit`,
    imageTag: product.imageTag ?? resolveProductPhotoUploadHappyPathImageTag(),
    initialRetailStockValue: toDisplayNumber(Number(product.packingStock ?? 0)),
    initialWholeStockValue: toDisplayNumber(Number(product.stock ?? 0)),
    packingUnit,
    productId: product.id,
    productName: product.name,
    runtimeAssets,
    unit,
  };
}

async function main() {
  const { admin, deleted, runtimeAssets, seeded } =
    await resetProductPhotoUploadHappyPathState();
  const scenario = await resolveProductPhotoUploadHappyPathScenarioContext();

  console.log(
    [
      "Product photo upload happy path setup is ready.",
      `Admin: ${admin.email ?? `user#${admin.id}`} [userId=${admin.id}]`,
      `Edit route: ${scenario.editRoute}`,
      `Detail route: ${scenario.detailRoute}`,
      `Tagged product: ${scenario.productName} [productId=${seeded.productId}]`,
      `Image tag marker: ${scenario.imageTag}`,
      `Slot 1 upload file: ${runtimeAssets.slotOnePath}`,
      `Slot 3 upload file: ${runtimeAssets.slotThreePath}`,
      `Deleted previous tagged products: ${deleted.deletedProducts}`,
      `Deleted previous tagged photo files: ${deleted.deletedPhotoFiles}`,
      "Next manual QA steps:",
      "1. Open the printed edit route as ADMIN.",
      "2. Upload the printed Slot 1 and Slot 3 files through the real form inputs.",
      "3. Save the product and confirm the browser lands on the detail route.",
      "4. Verify the uploaded slot previews are visible on product detail.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown product photo upload happy-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
