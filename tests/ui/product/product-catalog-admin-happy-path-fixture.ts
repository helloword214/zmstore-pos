import "dotenv/config";

import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  resolveProductCatalogAdminHappyPathScenarioContext,
  resetProductCatalogAdminHappyPathState,
} from "../../../scripts/qa/product/product-catalog-admin-happy-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export const PRODUCT_CATALOG_ADMIN_HAPPY_PATH_ENABLE_ENV =
  "QA_PRODUCT_CATALOG_ADMIN_HAPPY_PATH_ENABLE";

export type ProductCatalogAdminHappyPathScenario =
  Awaited<ReturnType<typeof resolveProductCatalogAdminHappyPathScenarioContext>>;

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

export function isProductCatalogAdminHappyPathEnabled() {
  return process.env[PRODUCT_CATALOG_ADMIN_HAPPY_PATH_ENABLE_ENV] === "1";
}

export async function resolveProductCatalogAdminHappyPathContext() {
  return resolveProductCatalogAdminHappyPathScenarioContext();
}

export async function resetProductCatalogAdminHappyPathQaState() {
  return resetProductCatalogAdminHappyPathState();
}

export async function bootstrapProductCatalogAdminHappyPathSession(
  context: BrowserContext,
) {
  const scenario = await resolveProductCatalogAdminHappyPathContext();
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    scenario.admin.id,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error("Product QA session bootstrap did not return a session cookie.");
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

export async function openProductCatalogAdminHappyPathCreatePage(page: Page) {
  const scenario = await resolveProductCatalogAdminHappyPathContext();
  const url = new URL(scenario.adminRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/products/new", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /new product/i })).toBeVisible();
}

export async function openProductCatalogAdminHappyPathListPage(page: Page) {
  const scenario = await resolveProductCatalogAdminHappyPathContext();
  const url = new URL(scenario.listRoute, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/products", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /product list/i })).toBeVisible();
}

export async function openProductCatalogAdminHappyPathEditPage(
  page: Page,
  productId: number,
) {
  const url = new URL(`/products/${productId}/edit`, resolveBaseUrl()).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === `/products/${productId}/edit`, {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /edit product/i })).toBeVisible();
}

export async function confirmProductCatalogAdminHappyPathAction(
  page: Page,
  action: () => Promise<void>,
) {
  const dialogPromise = page.waitForEvent("dialog");
  await action();
  const dialog = await dialogPromise;
  await dialog.accept();
}

export async function selectProductCatalogAdminHappyPathOption(
  page: Page,
  label: string,
  optionText: string,
) {
  const labelLocator = page
    .locator("label")
    .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`, "i") })
    .first();
  await expect(labelLocator).toBeVisible();

  const button = labelLocator.locator("xpath=following-sibling::button[1]");
  await button.click();
  await page.getByRole("option", { name: optionText, exact: true }).click();
}

export function resolveProductCatalogAdminHappyPathProductId(url: string) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/products\/(\d+)$/);
  const productId = match ? Number(match[1]) : 0;

  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error(`Unable to resolve the created product id from URL: ${url}`);
  }

  return productId;
}

export function findProductCatalogAdminHappyPathListRow(
  page: Page,
  productId: number,
) {
  return page.locator(`a[href="/products/${productId}"]`);
}

export async function resolveProductCatalogAdminHappyPathProductState(productId: number) {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: {
      allowPackSale: true,
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
      price: true,
      productIndications: {
        select: { indicationId: true },
      },
      productTargets: {
        select: { targetId: true },
      },
      srp: true,
      stock: true,
      unitId: true,
    },
  });

  if (!product) return null;

  return {
    allowPackSale: product.allowPackSale,
    categoryId: product.categoryId ?? null,
    dealerPrice: product.dealerPrice == null ? null : Number(product.dealerPrice),
    description: product.description ?? null,
    id: product.id,
    imageTag: product.imageTag ?? null,
    indicationCount: product.productIndications.length,
    isActive: product.isActive,
    minStock: product.minStock == null ? null : Number(product.minStock),
    name: product.name,
    packingSize: product.packingSize == null ? null : Number(product.packingSize),
    packingStock: product.packingStock == null ? null : Number(product.packingStock),
    packingUnitId: product.packingUnitId ?? null,
    price: product.price == null ? null : Number(product.price),
    srp: product.srp == null ? null : Number(product.srp),
    stock: product.stock == null ? null : Number(product.stock),
    targetCount: product.productTargets.length,
    unitId: product.unitId ?? null,
  };
}

export async function expectProductCatalogAdminHappyPathDetail(
  page: Page,
  productName: string,
  expectedStatus: "Active" | "Inactive",
) {
  await page.waitForURL((target) => /^\/products\/\d+$/.test(target.pathname), {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /product detail/i })).toBeVisible();
  await expect(page.getByText(productName, { exact: true })).toBeVisible();
  await expect(page.getByText(expectedStatus, { exact: true })).toBeVisible();
}

export function findProductCatalogAdminHappyPathSaveButton(page: Page) {
  return page.getByRole("button", { name: /save product|update product/i });
}

export function findProductCatalogAdminHappyPathActiveCheckbox(page: Page) {
  return page.getByLabel(/product is active/i);
}

export function findProductCatalogAdminHappyPathRetailCheckbox(page: Page) {
  return page.getByLabel(/enable retail selling mode/i);
}
