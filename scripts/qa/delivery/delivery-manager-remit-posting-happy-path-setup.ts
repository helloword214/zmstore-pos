import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { runCleanup } from "../../automation/business-flow/steps/cleanup.mjs";
import { runSetup } from "../../automation/business-flow/steps/setup.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_MANAGER_EMAIL = "manager1@local";
const AUTH_DIR = path.resolve(
  "test-results/ui/auth/delivery-manager-remit-posting-happy-path",
);
const CONTEXT_FILE = path.resolve(
  "test-results/automation/business-flow/context.latest.json",
);

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

type ScenarioUser = {
  id: number;
  email: string | null;
  role: UserRole;
  active: boolean;
  branchIds: number[];
  employee: {
    id: number;
    firstName: string;
    lastName: string;
    alias: string | null;
    role: string;
  } | null;
};

type RunRouteContext = {
  id: number;
  runCode: string;
  status: string;
  routes: {
    riderCheckin?: string;
    managerRemit?: string;
    cashierRunRemit?: string;
    summary?: string;
  };
};

type BusinessFlowContext = {
  createdAt: string;
  traceId: string;
  runs: {
    checkedIn: RunRouteContext;
    closed: RunRouteContext;
  };
};

type DeleteSummary = {
  removedContextFile: boolean;
  removedManagerStateFile: boolean;
  runIds: number[];
  orderIds: number[];
};

type ScenarioContext = {
  manager: ScenarioUser;
  checkedInRun: RunRouteContext;
  createdAt: string;
  traceId: string;
  managerStateFilePath: string;
};

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export function resolveDeliveryManagerRemitPostingHappyPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_DELIVERY_MANAGER_REMIT_POSTING_HAPPY_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveDeliveryManagerRemitPostingHappyPathManagerStateFilePath() {
  return path.join(AUTH_DIR, "manager.json");
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the delivery manager-remit QA session.",
    );
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

function removeFileIfPresent(filePath: string) {
  const exists = existsSync(filePath);
  try {
    rmSync(filePath, { force: true });
    return exists;
  } catch {
    return false;
  }
}

function formatUserLabel(user: ScenarioUser) {
  const employee = user.employee;
  const fullName =
    employee && (employee.firstName || employee.lastName)
      ? `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim()
      : user.email ?? `User #${user.id}`;
  const alias = employee?.alias ? ` (${employee.alias})` : "";
  return `${fullName}${alias}`;
}

function readBusinessFlowContext(): BusinessFlowContext {
  let parsed: BusinessFlowContext;

  try {
    parsed = JSON.parse(readFileSync(CONTEXT_FILE, "utf8")) as BusinessFlowContext;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing or invalid business flow context (${CONTEXT_FILE}). ${detail}`,
    );
  }

  if (!parsed?.runs?.checkedIn?.id || !parsed?.runs?.checkedIn?.routes?.managerRemit) {
    throw new Error(
      `Incomplete business flow context (${CONTEXT_FILE}). Expected a checked-in run with a manager remit route.`,
    );
  }

  return parsed;
}

async function resolveScenarioManager(email: string) {
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      branches: {
        select: {
          branchId: true,
        },
      },
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          alias: true,
          role: true,
        },
      },
    },
  });

  if (!user || !user.active || user.role !== UserRole.STORE_MANAGER) {
    throw new Error(
      `Delivery manager-remit happy path requires an active STORE_MANAGER account: ${email}`,
    );
  }

  return {
    ...user,
    branchIds: user.branches.map((branch) => branch.branchId),
  };
}

async function createManagerStorageState(userId: number, stateFilePath: string) {
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    userId,
  );
  const setCookieHeader = headers["Set-Cookie"];

  if (!setCookieHeader) {
    throw new Error("Auth session creation did not return a session cookie.");
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
}

export async function deleteDeliveryManagerRemitPostingHappyPathArtifacts(): Promise<DeleteSummary> {
  const cleanup = await runCleanup({ contextFile: CONTEXT_FILE });

  return {
    removedContextFile: removeFileIfPresent(CONTEXT_FILE),
    removedManagerStateFile: removeFileIfPresent(
      resolveDeliveryManagerRemitPostingHappyPathManagerStateFilePath(),
    ),
    runIds: cleanup.runIds ?? [],
    orderIds: cleanup.orderIds ?? [],
  };
}

export async function resetDeliveryManagerRemitPostingHappyPathState() {
  const deleted = await deleteDeliveryManagerRemitPostingHappyPathArtifacts();
  const manager = await resolveScenarioManager(
    resolveDeliveryManagerRemitPostingHappyPathManagerEmail(),
  );

  const businessFlowContext = await runSetup({ contextFile: CONTEXT_FILE });

  await createManagerStorageState(
    manager.id,
    resolveDeliveryManagerRemitPostingHappyPathManagerStateFilePath(),
  );

  return {
    deleted,
    manager,
    businessFlowContext,
  };
}

export async function resolveDeliveryManagerRemitPostingHappyPathScenarioContext(): Promise<ScenarioContext> {
  const businessFlowContext = readBusinessFlowContext();
  const manager = await resolveScenarioManager(
    resolveDeliveryManagerRemitPostingHappyPathManagerEmail(),
  );

  return {
    manager,
    checkedInRun: businessFlowContext.runs.checkedIn,
    createdAt: businessFlowContext.createdAt,
    traceId: businessFlowContext.traceId,
    managerStateFilePath:
      resolveDeliveryManagerRemitPostingHappyPathManagerStateFilePath(),
  };
}

async function main() {
  const { deleted, manager } =
    await resetDeliveryManagerRemitPostingHappyPathState();
  const scenario =
    await resolveDeliveryManagerRemitPostingHappyPathScenarioContext();

  console.log(
    [
      "Delivery manager remit posting happy path setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Manager: ${formatUserLabel(manager)} [userId=${manager.id}]`,
      `Checked-in run code: ${scenario.checkedInRun.runCode}`,
      `Manager remit route: ${scenario.checkedInRun.routes.managerRemit ?? "missing"}`,
      `Summary route: ${scenario.checkedInRun.routes.summary ?? "missing"}`,
      `Manager storage state: ${scenario.managerStateFilePath}`,
      `Deleted previous runs: ${deleted.runIds.length}`,
      `Deleted previous orders: ${deleted.orderIds.length}`,
      "Next manual QA steps:",
      "1. Open the printed checked-in manager remit route as STORE_MANAGER.",
      "2. Confirm the page shows the normal no-missing happy path.",
      "3. Click Approve Remit & Close Run and confirm redirect to the run summary report.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery manager-remit happy-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
