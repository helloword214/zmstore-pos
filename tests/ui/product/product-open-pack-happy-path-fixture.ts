import "dotenv/config";

import { expect, type BrowserContext, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  deleteProductOpenPackHappyPathArtifacts,
  resetProductOpenPackHappyPathState,
  resolveProductOpenPackHappyPathAdminEmail,
  resolveProductOpenPackHappyPathScenarioContext,
} from "../../../scripts/qa/product/product-open-pack-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const PRODUCT_OPEN_PACK_HAPPY_PATH_ENABLE_ENV =
  "QA_PRODUCT_OPEN_PACK_HAPPY_PATH_ENABLE";

type ProductOpenPackHappyPathScenario = Awaited<
  ReturnType<typeof resolveProductOpenPackHappyPathScenarioContext>
>;

type ProductOpenPackHappyPathDbState = {
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
  price: number | null;
  srp: number | null;
  stock: number | null;
  unitId: number | null;
};

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function isProductOpenPackHappyPathEnabled() {
  return process.env[PRODUCT_OPEN_PACK_HAPPY_PATH_ENABLE_ENV] === "1";
}

export async function resolveProductOpenPackHappyPathScenario() {
  return resolveProductOpenPackHappyPathScenarioContext();
}

export async function resetProductOpenPackHappyPathQaState() {
  return resetProductOpenPackHappyPathState();
}

export async function cleanupProductOpenPackHappyPathQaState() {
  return deleteProductOpenPackHappyPathArtifacts();
}

export async function bootstrapProductOpenPackHappyPathSession(
  context: BrowserContext,
) {
  const adminEmail = resolveProductOpenPackHappyPathAdminEmail();
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
      `Product open-pack happy path requires an active ADMIN account: ${adminEmail}`,
    );
  }

  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    admin.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error("Product open-pack QA session bootstrap did not return a session cookie.");
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

export async function openProductOpenPackHappyPathDetailPage(page: Page) {
  const scenario = await resolveProductOpenPackHappyPathScenario();
  const url = new URL(scenario.detailRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL(
    (target) => target.pathname === `/products/${scenario.productId}`,
    { timeout: 10_000 },
  );
  await expect(
    page.getByRole("heading", { name: /product detail/i }),
  ).toBeVisible();
  await expect(page.getByText(scenario.productName, { exact: true })).toBeVisible();
}

export function findProductOpenPackHappyPathDataRowValue(
  page: Page,
  label: string,
) {
  return page
    .locator("span", {
      hasText: new RegExp(`^${escapeRegExp(label)}$`, "i"),
    })
    .first()
    .locator("xpath=..")
    .locator("span")
    .last();
}

export async function resolveProductOpenPackHappyPathDbState(): Promise<
  ProductOpenPackHappyPathDbState | null
> {
  const scenario = await resolveProductOpenPackHappyPathScenario();
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
    price: product.price == null ? null : Number(product.price),
    srp: product.srp == null ? null : Number(product.srp),
    stock: product.stock == null ? null : Number(product.stock),
    unitId: product.unitId ?? null,
  };
}

export function expectProductOpenPackHappyPathInitialDbState(
  state: ProductOpenPackHappyPathDbState | null,
  scenario: ProductOpenPackHappyPathScenario,
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
  expect(state?.packingSize).toBe(12);
  expect(state?.stock).toBe(Number(scenario.initialWholeStockValue));
  expect(state?.packingStock).toBe(Number(scenario.initialRetailStockValue));
}

export function expectProductOpenPackHappyPathUpdatedDbState(
  beforeState: ProductOpenPackHappyPathDbState | null,
  afterState: ProductOpenPackHappyPathDbState | null,
  scenario: ProductOpenPackHappyPathScenario,
) {
  expect(beforeState).not.toBeNull();
  expect(afterState).not.toBeNull();
  expect(afterState?.id).toBe(beforeState?.id);
  expect(afterState?.stock).toBe(Number(scenario.expectedWholeStockValue));
  expect(afterState?.packingStock).toBe(Number(scenario.expectedRetailStockValue));
  expect(afterState?.allowPackSale).toBe(true);
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
  expect(afterState?.minStock).toBe(beforeState?.minStock);
  expect(afterState?.name).toBe(beforeState?.name);
  expect(afterState?.description).toBe(beforeState?.description);
  expect(afterState?.imageTag).toBe(beforeState?.imageTag);
}

export async function expectProductOpenPackHappyPathDetailSnapshot(
  page: Page,
  args: {
    retailStockValue: string;
    wholeStockValue: string;
  },
) {
  await expect(
    findProductOpenPackHappyPathDataRowValue(page, "Whole Stock"),
  ).toHaveText(args.wholeStockValue);
  await expect(
    findProductOpenPackHappyPathDataRowValue(page, "Retail Stock"),
  ).toHaveText(args.retailStockValue);
}

export function findProductOpenPackHappyPathOpenPackButton(page: Page) {
  return page.getByRole("button", { name: /^Open Pack$/i });
}
