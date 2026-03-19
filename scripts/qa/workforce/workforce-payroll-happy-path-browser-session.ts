import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { WORKFORCE_PAYROLL_HAPPY_PATH_QA_MARKER } from "./workforce-payroll-happy-path-scenario";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_MANAGER_EMAIL = "manager1@local";
const DEFAULT_STATE_FILE = path.join(
  os.tmpdir(),
  "zmstore-pos-2",
  "playwright",
  "workforce-payroll-happy-path-manager.storage-state.json",
);

type PlaywrightStorageState = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Lax";
  }>;
  origins: Array<unknown>;
};

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function resolveManagerEmail() {
  return (
    process.env.QA_WORKFORCE_PAYROLL_HAPPY_PATH_MANAGER_EMAIL ??
    process.env.UI_MANAGER_EMAIL ??
    DEFAULT_MANAGER_EMAIL
  )
    .trim()
    .toLowerCase();
}

function resolveStateFilePath() {
  return (
    process.env.QA_WORKFORCE_PAYROLL_HAPPY_PATH_MANAGER_STATE_FILE ??
    process.env.UI_MANAGER_STATE_FILE ??
    DEFAULT_STATE_FILE
  );
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error("Invalid auth cookie returned while creating the QA browser session.");
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

async function main() {
  const baseUrl = new URL(resolveBaseUrl());
  const managerEmail = resolveManagerEmail();
  const stateFilePath = resolveStateFilePath();

  const manager = await db.user.findUnique({
    where: { email: managerEmail },
    select: {
      id: true,
      active: true,
      role: true,
    },
  });

  if (!manager || !manager.active) {
    throw new Error(`Cannot create a QA browser session for missing/inactive user: ${managerEmail}`);
  }

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    manager.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error("Auth session creation did not return a session cookie.");
  }

  const cookie = parseCookiePair(setCookieHeader);
  const storageState: PlaywrightStorageState = {
    cookies: [
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
    ],
    origins: [],
  };

  mkdirSync(path.dirname(stateFilePath), { recursive: true });
  writeFileSync(stateFilePath, JSON.stringify(storageState, null, 2));

  console.log(
    [
      "Workforce payroll browser session is ready.",
      `Scenario: ${WORKFORCE_PAYROLL_HAPPY_PATH_QA_MARKER}`,
      `Base URL: ${baseUrl.toString()}`,
      `Manager: ${managerEmail}`,
      `Role: ${manager.role}`,
      `Storage state file: ${stateFilePath}`,
      "Use this state with an isolated Playwright browser context or as a storageState file.",
      "This helper uses the app auth layer to bootstrap a local QA session without OTP log scraping.",
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Unknown workforce payroll browser-session setup error.",
    );
    throw error;
  })
  .finally(async () => {
    await db.$disconnect();
  });
