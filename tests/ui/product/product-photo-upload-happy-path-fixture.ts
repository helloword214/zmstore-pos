import "dotenv/config";

import { expect, type BrowserContext, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  deleteProductPhotoUploadHappyPathArtifacts,
  resetProductPhotoUploadHappyPathState,
  resolveProductPhotoUploadHappyPathAdminEmail,
  resolveProductPhotoUploadHappyPathScenarioContext,
} from "../../../scripts/qa/product/product-photo-upload-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_ENABLE_ENV =
  "QA_PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_ENABLE";

type ProductPhotoUploadHappyPathScenario = Awaited<
  ReturnType<typeof resolveProductPhotoUploadHappyPathScenarioContext>
>;

type ProductPhotoDbState = {
  allowPackSale: boolean;
  brandId: number | null;
  categoryId: number | null;
  dealerPrice: number | null;
  description: string | null;
  id: number;
  imageTag: string | null;
  isActive: boolean;
  locationId: number | null;
  minStock: number | null;
  name: string;
  packingSize: number | null;
  packingStock: number | null;
  packingUnitId: number | null;
  photos: Array<{
    fileKey: string;
    fileUrl: string;
    mimeType: string;
    sizeBytes: number;
    slot: number;
  }>;
  price: number | null;
  srp: number | null;
  stock: number | null;
  unitId: number | null;
};

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error("Invalid auth cookie returned while creating the product QA session.");
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

export function isProductPhotoUploadHappyPathEnabled() {
  return process.env[PRODUCT_PHOTO_UPLOAD_HAPPY_PATH_ENABLE_ENV] === "1";
}

export async function resolveProductPhotoUploadHappyPathScenario() {
  return resolveProductPhotoUploadHappyPathScenarioContext();
}

export async function resetProductPhotoUploadHappyPathQaState() {
  return resetProductPhotoUploadHappyPathState();
}

export async function cleanupProductPhotoUploadHappyPathQaState() {
  return deleteProductPhotoUploadHappyPathArtifacts();
}

export async function bootstrapProductPhotoUploadHappyPathSession(
  context: BrowserContext,
) {
  const adminEmail = resolveProductPhotoUploadHappyPathAdminEmail();
  const admin = await db.user.findUnique({
    where: { email: adminEmail },
    select: {
      id: true,
      active: true,
      role: true,
    },
  });

  if (!admin || !admin.active || admin.role !== "ADMIN") {
    throw new Error(
      `Product photo upload happy path requires an active ADMIN account: ${adminEmail}`,
    );
  }

  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    admin.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error(
      "Product photo upload QA session bootstrap did not return a session cookie.",
    );
  }

  const cookie = parseCookiePair(setCookieHeader);
  await context.clearCookies();
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: baseUrl.hostname,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
      httpOnly: true,
      secure: baseUrl.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

export async function openProductPhotoUploadHappyPathEditPage(page: Page) {
  const scenario = await resolveProductPhotoUploadHappyPathScenario();
  const url = new URL(scenario.editRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL(
    (target) => target.pathname === `/products/${scenario.productId}/edit`,
    { timeout: 10_000 },
  );
  await expect(
    page.getByRole("heading", { name: /edit product/i }),
  ).toBeVisible();
}

export async function resolveProductPhotoUploadHappyPathDbState(): Promise<
  ProductPhotoDbState | null
> {
  const scenario = await resolveProductPhotoUploadHappyPathScenario();
  const product = await db.product.findUnique({
    where: { id: scenario.productId },
    select: {
      allowPackSale: true,
      brandId: true,
      categoryId: true,
      dealerPrice: true,
      description: true,
      id: true,
      imageTag: true,
      isActive: true,
      locationId: true,
      minStock: true,
      name: true,
      packingSize: true,
      packingStock: true,
      packingUnitId: true,
      photos: {
        orderBy: [{ slot: "asc" }, { uploadedAt: "desc" }],
        select: {
          fileKey: true,
          fileUrl: true,
          mimeType: true,
          sizeBytes: true,
          slot: true,
        },
      },
      price: true,
      srp: true,
      stock: true,
      unitId: true,
    },
  });

  if (!product) {
    return null;
  }

  return {
    allowPackSale: product.allowPackSale,
    brandId: product.brandId ?? null,
    categoryId: product.categoryId ?? null,
    dealerPrice: product.dealerPrice == null ? null : Number(product.dealerPrice),
    description: product.description ?? null,
    id: product.id,
    imageTag: product.imageTag ?? null,
    isActive: product.isActive,
    locationId: product.locationId ?? null,
    minStock: product.minStock == null ? null : Number(product.minStock),
    name: product.name,
    packingSize: product.packingSize == null ? null : Number(product.packingSize),
    packingStock: product.packingStock == null ? null : Number(product.packingStock),
    packingUnitId: product.packingUnitId ?? null,
    photos: product.photos.map((photo) => ({
      fileKey: photo.fileKey,
      fileUrl: photo.fileUrl,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      slot: photo.slot,
    })),
    price: product.price == null ? null : Number(product.price),
    srp: product.srp == null ? null : Number(product.srp),
    stock: product.stock == null ? null : Number(product.stock),
    unitId: product.unitId ?? null,
  };
}

export function expectProductPhotoUploadHappyPathInitialDbState(
  state: ProductPhotoDbState | null,
  scenario: ProductPhotoUploadHappyPathScenario,
) {
  expect(state).not.toBeNull();
  expect(state?.id).toBe(scenario.productId);
  expect(state?.name).toBe(scenario.productName);
  expect(state?.imageTag).toBe(scenario.imageTag);
  expect(state?.allowPackSale).toBe(true);
  expect(state?.isActive).toBe(true);
  expect(state?.categoryId).toBe(scenario.category.id);
  expect(state?.unitId).toBe(scenario.unit.id);
  expect(state?.packingUnitId).toBe(scenario.packingUnit.id);
  expect(state?.stock).toBe(Number(scenario.initialWholeStockValue));
  expect(state?.packingStock).toBe(Number(scenario.initialRetailStockValue));
  expect(state?.photos).toHaveLength(0);
}

export function expectProductPhotoUploadHappyPathUpdatedDbState(
  beforeState: ProductPhotoDbState | null,
  afterState: ProductPhotoDbState | null,
  scenario: ProductPhotoUploadHappyPathScenario,
) {
  expect(beforeState).not.toBeNull();
  expect(afterState).not.toBeNull();
  expect(afterState?.id).toBe(beforeState?.id);
  expect(afterState?.photos).toHaveLength(2);
  expect(afterState?.photos.map((photo) => photo.slot)).toEqual([1, 3]);

  const slotOnePhoto = afterState?.photos.find((photo) => photo.slot === 1);
  const slotThreePhoto = afterState?.photos.find((photo) => photo.slot === 3);

  expect(slotOnePhoto).toBeDefined();
  expect(slotThreePhoto).toBeDefined();
  expect(slotOnePhoto?.fileKey).toBeTruthy();
  expect(slotThreePhoto?.fileKey).toBeTruthy();
  expect(slotOnePhoto?.fileUrl).toContain("/uploads/");
  expect(slotThreePhoto?.fileUrl).toContain("/uploads/");
  expect(slotOnePhoto?.mimeType).toBe("image/png");
  expect(slotThreePhoto?.mimeType).toBe("image/png");
  expect(slotOnePhoto?.sizeBytes).toBe(scenario.runtimeAssets.slotOneSizeBytes);
  expect(slotThreePhoto?.sizeBytes).toBe(scenario.runtimeAssets.slotThreeSizeBytes);

  expect(afterState?.allowPackSale).toBe(beforeState?.allowPackSale);
  expect(afterState?.isActive).toBe(beforeState?.isActive);
  expect(afterState?.categoryId).toBe(beforeState?.categoryId);
  expect(afterState?.brandId).toBe(beforeState?.brandId);
  expect(afterState?.locationId).toBe(beforeState?.locationId);
  expect(afterState?.unitId).toBe(beforeState?.unitId);
  expect(afterState?.packingUnitId).toBe(beforeState?.packingUnitId);
  expect(afterState?.packingSize).toBe(beforeState?.packingSize);
  expect(afterState?.price).toBe(beforeState?.price);
  expect(afterState?.srp).toBe(beforeState?.srp);
  expect(afterState?.dealerPrice).toBe(beforeState?.dealerPrice);
  expect(afterState?.stock).toBe(beforeState?.stock);
  expect(afterState?.packingStock).toBe(beforeState?.packingStock);
  expect(afterState?.minStock).toBe(beforeState?.minStock);
  expect(afterState?.description).toBe(beforeState?.description);
  expect(afterState?.name).toBe(beforeState?.name);
  expect(afterState?.imageTag).toBe(beforeState?.imageTag);
}

export function findProductPhotoUploadHappyPathDetailImage(
  page: Page,
  args: {
    productName: string;
    slot: 1 | 3;
  },
) {
  return page.getByAltText(`${args.productName} slot ${args.slot}`);
}
