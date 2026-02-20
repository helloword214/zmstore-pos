import type { BrowserContext, Page } from "@playwright/test";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

export function resolveBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function parseLocalStorageEntries(raw: string | undefined) {
  if (!raw) return [] as Array<[string, string]>;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).map(([key, value]) => [
      key,
      value == null ? "" : String(value),
    ]);
  } catch {
    return [] as Array<[string, string]>;
  }
}

export async function bootstrapSession(page: Page, context: BrowserContext) {
  const baseURL = resolveBaseURL();
  const cookieName = process.env.UI_AUTH_COOKIE_NAME;
  const cookieValue = process.env.UI_AUTH_COOKIE_VALUE;

  if (cookieName && cookieValue) {
    const parsed = new URL(baseURL);
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        domain: parsed.hostname,
        path: "/",
        secure: parsed.protocol === "https:",
        httpOnly: false,
        sameSite: "Lax",
      },
    ]);
  }

  const localStorageEntries = parseLocalStorageEntries(
    process.env.UI_AUTH_LOCAL_STORAGE,
  );
  if (localStorageEntries.length === 0) return;

  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.evaluate((entries: Array<[string, string]>) => {
    for (const [key, value] of entries) {
      window.localStorage.setItem(key, value);
    }
  }, localStorageEntries);
}

