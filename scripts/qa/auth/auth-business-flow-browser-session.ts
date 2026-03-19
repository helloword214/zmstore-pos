import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createUserSession, type Role } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const AUTH_DIR = path.resolve("test-results/ui/auth");

type BrowserSessionStorageState = {
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

type RoleSessionConfig = {
  label: string;
  role: Role;
  emailEnvKey: string;
  fallbackEmail: string;
  stateEnvKey: string;
  fallbackFileName: string;
};

const ROLE_SESSION_CONFIGS: RoleSessionConfig[] = [
  {
    label: "manager",
    role: "STORE_MANAGER",
    emailEnvKey: "UI_MANAGER_EMAIL",
    fallbackEmail: "manager1@local",
    stateEnvKey: "UI_MANAGER_STATE_FILE",
    fallbackFileName: "manager.json",
  },
  {
    label: "rider",
    role: "EMPLOYEE",
    emailEnvKey: "UI_RIDER_EMAIL",
    fallbackEmail: "rider1@local",
    stateEnvKey: "UI_RIDER_STATE_FILE",
    fallbackFileName: "rider.json",
  },
  {
    label: "cashier",
    role: "CASHIER",
    emailEnvKey: "UI_CASHIER_EMAIL",
    fallbackEmail: "cashier1@local",
    stateEnvKey: "UI_CASHIER_STATE_FILE",
    fallbackFileName: "cashier.json",
  },
];

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function resolveEmail(config: RoleSessionConfig) {
  return (process.env[config.emailEnvKey] ?? config.fallbackEmail).trim().toLowerCase();
}

function resolveStateFilePath(config: RoleSessionConfig) {
  return process.env[config.stateEnvKey] ?? path.join(AUTH_DIR, config.fallbackFileName);
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error("Invalid auth cookie returned while creating the browser session state.");
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

async function createRoleSessionState(config: RoleSessionConfig, baseUrl: URL) {
  const email = resolveEmail(config);
  const stateFilePath = resolveStateFilePath(config);

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      active: true,
      role: true,
    },
  });

  if (!user || !user.active || user.role !== config.role) {
    throw new Error(
      `Cannot create ${config.label} browser session state for missing/inactive user or wrong role: ${email}`,
    );
  }

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    user.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error(`Auth session creation did not return a session cookie for ${email}.`);
  }

  const cookie = parseCookiePair(setCookieHeader);
  const storageState: BrowserSessionStorageState = {
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

  return {
    label: config.label,
    email,
    role: user.role,
    stateFilePath,
  };
}

async function main() {
  const baseUrl = new URL(resolveBaseUrl());
  const createdSessions = [];

  for (const config of ROLE_SESSION_CONFIGS) {
    createdSessions.push(await createRoleSessionState(config, baseUrl));
  }

  const lines = [
    "Business-flow browser session states are ready.",
    `Base URL: ${baseUrl.toString()}`,
    "These storageState files use the app auth layer to bootstrap isolated local QA sessions.",
  ];

  for (const session of createdSessions) {
    lines.push(
      `${session.label}: ${session.email} (${session.role}) -> ${session.stateFilePath}`,
    );
  }

  console.log(lines.join("\n"));
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Unknown business-flow browser-session setup error.",
    );
    throw error;
  })
  .finally(async () => {
    await db.$disconnect();
  });
