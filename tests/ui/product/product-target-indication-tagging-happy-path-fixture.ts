import "dotenv/config";

import { expect, type BrowserContext, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  deleteProductTargetIndicationTaggingHappyPathArtifacts,
  resetProductTargetIndicationTaggingHappyPathState,
  resolveProductTargetIndicationTaggingHappyPathAdminEmail,
  resolveProductTargetIndicationTaggingHappyPathScenarioContext,
} from "../../../scripts/qa/product/product-target-indication-tagging-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_ENABLE_ENV =
  "QA_PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_ENABLE";

type ProductTargetIndicationTaggingHappyPathScenario = Awaited<
  ReturnType<typeof resolveProductTargetIndicationTaggingHappyPathScenarioContext>
>;

type ProductTargetIndicationTaggingDbState = {
  allowPackSale: boolean;
  brandId: number | null;
  categoryId: number | null;
  dealerPrice: number | null;
  description: string | null;
  id: number;
  imageTag: string | null;
  indicationIds: number[];
  isActive: boolean;
  minStock: number | null;
  name: string;
  packingSize: number | null;
  packingStock: number | null;
  packingUnitId: number | null;
  photoSlots: number[];
  price: number | null;
  srp: number | null;
  stock: number | null;
  targetIds: number[];
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isProductTargetIndicationTaggingHappyPathEnabled() {
  return process.env[PRODUCT_TARGET_INDICATION_TAGGING_HAPPY_PATH_ENABLE_ENV] === "1";
}

export async function resolveProductTargetIndicationTaggingHappyPathScenario() {
  return resolveProductTargetIndicationTaggingHappyPathScenarioContext();
}

export async function resetProductTargetIndicationTaggingHappyPathQaState() {
  return resetProductTargetIndicationTaggingHappyPathState();
}

export async function cleanupProductTargetIndicationTaggingHappyPathQaState() {
  return deleteProductTargetIndicationTaggingHappyPathArtifacts();
}

export async function bootstrapProductTargetIndicationTaggingHappyPathSession(
  context: BrowserContext,
) {
  const adminEmail =
    resolveProductTargetIndicationTaggingHappyPathAdminEmail();
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
      `Product target/indication tagging happy path requires an active ADMIN account: ${adminEmail}`,
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
      "Product target/indication tagging QA session bootstrap did not return a session cookie.",
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

export async function openProductTargetIndicationTaggingHappyPathEditPage(
  page: Page,
) {
  const scenario =
    await resolveProductTargetIndicationTaggingHappyPathScenario();
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

export async function resolveProductTargetIndicationTaggingHappyPathDbState(): Promise<
  ProductTargetIndicationTaggingDbState | null
> {
  const scenario =
    await resolveProductTargetIndicationTaggingHappyPathScenario();
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
      minStock: true,
      name: true,
      packingSize: true,
      packingStock: true,
      packingUnitId: true,
      photos: {
        orderBy: [{ slot: "asc" }, { uploadedAt: "desc" }],
        select: {
          slot: true,
        },
      },
      price: true,
      productIndications: {
        orderBy: { indicationId: "asc" },
        select: {
          indicationId: true,
        },
      },
      productTargets: {
        orderBy: { targetId: "asc" },
        select: {
          targetId: true,
        },
      },
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
    indicationIds: product.productIndications.map((entry) => entry.indicationId),
    isActive: product.isActive,
    minStock: product.minStock == null ? null : Number(product.minStock),
    name: product.name,
    packingSize: product.packingSize == null ? null : Number(product.packingSize),
    packingStock: product.packingStock == null ? null : Number(product.packingStock),
    packingUnitId: product.packingUnitId ?? null,
    photoSlots: product.photos.map((photo) => photo.slot),
    price: product.price == null ? null : Number(product.price),
    srp: product.srp == null ? null : Number(product.srp),
    stock: product.stock == null ? null : Number(product.stock),
    targetIds: product.productTargets.map((entry) => entry.targetId),
    unitId: product.unitId ?? null,
  };
}

export function expectProductTargetIndicationTaggingHappyPathInitialDbState(
  state: ProductTargetIndicationTaggingDbState | null,
  scenario: ProductTargetIndicationTaggingHappyPathScenario,
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
  expect(state?.indicationIds).toEqual([]);
  expect(state?.targetIds).toEqual([]);
  expect(state?.photoSlots).toEqual([]);
}

export function expectProductTargetIndicationTaggingHappyPathUpdatedDbState(
  beforeState: ProductTargetIndicationTaggingDbState | null,
  afterState: ProductTargetIndicationTaggingDbState | null,
  scenario: ProductTargetIndicationTaggingHappyPathScenario,
) {
  expect(beforeState).not.toBeNull();
  expect(afterState).not.toBeNull();
  expect(afterState?.id).toBe(beforeState?.id);
  expect(afterState?.indicationIds).toEqual([scenario.indication.id]);
  expect(afterState?.targetIds).toEqual([scenario.target.id]);
  expect(afterState?.allowPackSale).toBe(beforeState?.allowPackSale);
  expect(afterState?.isActive).toBe(beforeState?.isActive);
  expect(afterState?.categoryId).toBe(beforeState?.categoryId);
  expect(afterState?.brandId).toBe(beforeState?.brandId);
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
  expect(afterState?.photoSlots).toEqual(beforeState?.photoSlots);
}

function findProductTargetIndicationTaggingHappyPathMultiSelectInput(
  page: Page,
  label: string,
) {
  return page
    .locator("label")
    .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`, "i") })
    .first()
    .locator("xpath=..//input[@type='text'][1]");
}

function findProductTargetIndicationTaggingHappyPathMultiSelectWrapper(
  page: Page,
  label: string,
) {
  return page
    .locator("label")
    .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`, "i") })
    .first()
    .locator("xpath=..");
}

export async function selectProductTargetIndicationTaggingHappyPathOption(
  page: Page,
  label: string,
  optionText: string,
) {
  const input = findProductTargetIndicationTaggingHappyPathMultiSelectInput(
    page,
    label,
  );
  await expect(input).toBeVisible();
  await input.fill(optionText);

  const option = findProductTargetIndicationTaggingHappyPathMultiSelectWrapper(
    page,
    label,
  ).getByRole("button", { name: optionText, exact: true });
  await expect(option).toBeVisible();
  await option.click();
}

export function findProductTargetIndicationTaggingHappyPathDetailChip(
  page: Page,
  text: string,
) {
  return page.getByText(text, { exact: true });
}
