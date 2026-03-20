import "dotenv/config";

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EmployeeRole, UserRole } from "@prisma/client";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryManagerShortageReviewChargePathArtifacts,
  resetDeliveryManagerShortageReviewChargePathState,
  resolveDeliveryManagerShortageReviewChargePathScenarioContext,
} from "./delivery-manager-shortage-review-charge-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const AUTH_DIR = path.resolve(
  "test-results/ui/auth/delivery-rider-acceptance-path",
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

type DeleteSummary = Awaited<
  ReturnType<typeof deleteDeliveryManagerShortageReviewChargePathArtifacts>
> & {
  removedRiderStateFile: boolean;
};

type DeliveryManagerShortageReviewChargePathScenario = Awaited<
  ReturnType<typeof resolveDeliveryManagerShortageReviewChargePathScenarioContext>
>;

export type DeliveryRiderAcceptancePathScenarioContext =
  DeliveryManagerShortageReviewChargePathScenario & {
    rider: ScenarioUser;
    riderStateFilePath: string;
    riderAcceptanceRoute: string;
  };

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function resolveBaseUrl() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the delivery rider-acceptance QA session.",
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

export function resolveDeliveryRiderAcceptancePathRiderStateFilePath() {
  return path.join(AUTH_DIR, "rider.json");
}

async function resolveScenarioRiderByVariance(varianceId: number) {
  const variance = await db.riderRunVariance.findUnique({
    where: { id: varianceId },
    select: {
      riderId: true,
    },
  });

  if (!variance?.riderId) {
    throw new Error(
      `Delivery rider-acceptance path could not resolve rider ownership for variance #${varianceId}.`,
    );
  }

  const user = await db.user.findFirst({
    where: {
      employeeId: variance.riderId,
      role: UserRole.EMPLOYEE,
      active: true,
      employee: {
        is: {
          role: EmployeeRole.RIDER,
        },
      },
    },
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

  if (!user || !user.employee || user.employee.role !== EmployeeRole.RIDER) {
    throw new Error(
      `Delivery rider-acceptance path requires an active EMPLOYEE user linked to rider employee #${variance.riderId}.`,
    );
  }

  return {
    ...user,
    branchIds: user.branches.map((branch) => branch.branchId),
  };
}

async function createRiderStorageState(userId: number, stateFilePath: string) {
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

export async function deleteDeliveryRiderAcceptancePathArtifacts(): Promise<DeleteSummary> {
  const deleted = await deleteDeliveryManagerShortageReviewChargePathArtifacts();

  return {
    ...deleted,
    removedRiderStateFile: removeFileIfPresent(
      resolveDeliveryRiderAcceptancePathRiderStateFilePath(),
    ),
  };
}

export async function resetDeliveryRiderAcceptancePathState() {
  const deleted = await deleteDeliveryRiderAcceptancePathArtifacts();
  await resetDeliveryManagerShortageReviewChargePathState();

  const managerReviewScenario =
    await resolveDeliveryManagerShortageReviewChargePathScenarioContext();
  const rider = await resolveScenarioRiderByVariance(
    managerReviewScenario.varianceId,
  );

  await createRiderStorageState(
    rider.id,
    resolveDeliveryRiderAcceptancePathRiderStateFilePath(),
  );

  return {
    deleted,
    rider,
  };
}

export async function resolveDeliveryRiderAcceptancePathScenarioContext(): Promise<DeliveryRiderAcceptancePathScenarioContext> {
  const managerReviewScenario =
    await resolveDeliveryManagerShortageReviewChargePathScenarioContext();
  const rider = await resolveScenarioRiderByVariance(
    managerReviewScenario.varianceId,
  );

  return {
    ...managerReviewScenario,
    rider,
    riderStateFilePath: resolveDeliveryRiderAcceptancePathRiderStateFilePath(),
    riderAcceptanceRoute: `/rider/variance/${managerReviewScenario.varianceId}`,
  };
}

async function main() {
  const { deleted, rider } = await resetDeliveryRiderAcceptancePathState();
  const scenario = await resolveDeliveryRiderAcceptancePathScenarioContext();

  console.log(
    [
      "Delivery rider acceptance path setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Rider: ${formatUserLabel(rider)} [userId=${rider.id}]`,
      `Closed run code: ${scenario.closedRun.runCode}`,
      `Variance ref: #${scenario.varianceId}`,
      `Acceptance route: ${scenario.riderAcceptanceRoute}`,
      `Rider storage state: ${scenario.riderStateFilePath}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      `Deleted previous runs: ${deleted.runIds.length}`,
      `Deleted previous orders: ${deleted.orderIds.length}`,
      "Next manual QA steps:",
      "1. Open the printed rider acceptance route as the seeded rider.",
      "2. Confirm the charge-rider acknowledgement UI is visible.",
      "3. Click Accept variance and confirm redirect back to the rider queue.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery rider-acceptance path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
