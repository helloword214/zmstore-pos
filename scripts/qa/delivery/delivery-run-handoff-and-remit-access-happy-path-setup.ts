import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CashierShiftStatus, UserRole } from "@prisma/client";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { runCleanup } from "../../automation/business-flow/steps/cleanup.mjs";
import { runSetup } from "../../automation/business-flow/steps/setup.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_MANAGER_EMAIL = "manager1@local";
const DEFAULT_CASHIER_EMAIL = "cashier1@local";
const AUTH_DIR = path.resolve(
  "test-results/ui/auth/delivery-run-handoff-and-remit-access-happy-path",
);
const CONTEXT_FILE = path.resolve(
  "test-results/automation/business-flow/context.latest.json",
);

export const DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_DEVICE_ID =
  "QA-DELIVERY-HANDOFF-REMIT-ACCESS-HAPPY-PATH";

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
  seed: {
    riderId: number;
    riderLabel: string;
  };
  runs: {
    checkedIn: RunRouteContext;
    closed: RunRouteContext;
  };
};

type DeleteSummary = {
  deletedArPayments: number;
  deletedCashDrawerTxns: number;
  deletedCashierChargePayments: number;
  deletedCashierCharges: number;
  deletedPayments: number;
  deletedRiderChargePayments: number;
  deletedRiderVariances: number;
  deletedShiftVariances: number;
  deletedShifts: number;
  removedCashierStateFile: boolean;
  removedContextFile: boolean;
  removedManagerStateFile: boolean;
  removedRiderStateFile: boolean;
  runIds: number[];
  orderIds: number[];
};

type ScenarioContext = {
  manager: ScenarioUser;
  rider: ScenarioUser;
  cashier: ScenarioUser;
  checkedInRun: RunRouteContext;
  closedRun: RunRouteContext;
  createdAt: string;
  traceId: string;
  cashierShiftDeviceId: string;
  managerStateFilePath: string;
  riderStateFilePath: string;
  cashierStateFilePath: string;
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

export function resolveDeliveryRunHandoffAndRemitAccessHappyPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveDeliveryRunHandoffAndRemitAccessHappyPathCashierEmail() {
  return normalizeEmail(
    process.env.QA_DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_CASHIER_EMAIL ??
      process.env.UI_CASHIER_EMAIL ??
      DEFAULT_CASHIER_EMAIL,
  );
}

export function resolveDeliveryRunHandoffAndRemitAccessHappyPathDeviceId() {
  return (
    process.env.QA_DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_DEVICE_ID ??
    DELIVERY_RUN_HANDOFF_AND_REMIT_ACCESS_HAPPY_PATH_DEVICE_ID
  ).trim();
}

export function resolveDeliveryRunHandoffAndRemitAccessHappyPathManagerStateFilePath() {
  return path.join(AUTH_DIR, "manager.json");
}

export function resolveDeliveryRunHandoffAndRemitAccessHappyPathRiderStateFilePath() {
  return path.join(AUTH_DIR, "rider.json");
}

export function resolveDeliveryRunHandoffAndRemitAccessHappyPathCashierStateFilePath() {
  return path.join(AUTH_DIR, "cashier.json");
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the delivery handoff/remit QA session.",
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

  if (!parsed?.runs?.checkedIn?.id || !parsed?.runs?.closed?.id || !parsed?.seed?.riderId) {
    throw new Error(
      `Incomplete business flow context (${CONTEXT_FILE}). Expected checked-in run, closed run, and seed rider.`,
    );
  }

  return parsed;
}

async function resolveScenarioUserByEmail(email: string, role: UserRole) {
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

  if (!user || !user.active || user.role !== role) {
    throw new Error(
      `Delivery handoff/remit happy path requires an active ${role} account: ${email}`,
    );
  }

  return {
    ...user,
    branchIds: user.branches.map((branch) => branch.branchId),
  };
}

async function resolveScenarioRiderByEmployeeId(employeeId: number) {
  const user = await db.user.findFirst({
    where: {
      active: true,
      role: UserRole.EMPLOYEE,
      employee: {
        is: {
          id: employeeId,
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

  if (!user || !user.employee) {
    throw new Error(
      `Delivery handoff/remit happy path requires an active linked user for rider employee #${employeeId}.`,
    );
  }

  return {
    ...user,
    branchIds: user.branches.map((branch) => branch.branchId),
  };
}

async function createStorageStateForUser(args: {
  userId: number;
  stateFilePath: string;
}) {
  const baseUrl = new URL(resolveBaseUrl());
  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    args.userId,
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

  mkdirSync(path.dirname(args.stateFilePath), { recursive: true });
  writeFileSync(args.stateFilePath, JSON.stringify(storageState, null, 2));
}

async function listTaggedShiftIds() {
  const taggedShifts = await db.cashierShift.findMany({
    where: { deviceId: resolveDeliveryRunHandoffAndRemitAccessHappyPathDeviceId() },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  return taggedShifts.map((shift) => shift.id);
}

async function ensureTaggedCashierOpenShift(cashier: ScenarioUser) {
  const branchId = cashier.branchIds[0] ?? null;
  return db.cashierShift.create({
    data: {
      cashierId: cashier.id,
      branchId,
      openingFloat: 0,
      openingCounted: 0,
      openingVerifiedAt: new Date(),
      openingVerifiedById: cashier.id,
      deviceId: resolveDeliveryRunHandoffAndRemitAccessHappyPathDeviceId(),
      notes: "QA delivery handoff/remit access open shift",
      status: CashierShiftStatus.OPEN,
    },
    select: {
      id: true,
      deviceId: true,
      status: true,
    },
  });
}

export async function deleteDeliveryRunHandoffAndRemitAccessHappyPathArtifacts(): Promise<DeleteSummary> {
  const cleanup = await runCleanup({ contextFile: CONTEXT_FILE });
  const shiftIds = await listTaggedShiftIds();

  const deletedShiftArtifacts =
    shiftIds.length > 0
      ? await db.$transaction(async (tx) => {
          const varianceIds = (
            await tx.cashierShiftVariance.findMany({
              where: { shiftId: { in: shiftIds } },
              select: { id: true },
            })
          ).map((variance) => variance.id);

          const cashierChargeIds = (
            await tx.cashierCharge.findMany({
              where:
                varianceIds.length > 0
                  ? {
                      OR: [
                        { shiftId: { in: shiftIds } },
                        { varianceId: { in: varianceIds } },
                      ],
                    }
                  : { shiftId: { in: shiftIds } },
              select: { id: true },
            })
          ).map((charge) => charge.id);

          const deletedCashierChargePayments =
            cashierChargeIds.length > 0
              ? await tx.cashierChargePayment.deleteMany({
                  where: {
                    OR: [
                      { shiftId: { in: shiftIds } },
                      { chargeId: { in: cashierChargeIds } },
                    ],
                  },
                })
              : await tx.cashierChargePayment.deleteMany({
                  where: { shiftId: { in: shiftIds } },
                });

          const deleted = {
            deletedArPayments: (
              await tx.customerArPayment.deleteMany({
                where: { shiftId: { in: shiftIds } },
              })
            ).count,
            deletedCashDrawerTxns: (
              await tx.cashDrawerTxn.deleteMany({
                where: { shiftId: { in: shiftIds } },
              })
            ).count,
            deletedCashierChargePayments: deletedCashierChargePayments.count,
            deletedCashierCharges: (
              cashierChargeIds.length > 0
                ? await tx.cashierCharge.deleteMany({
                    where: { id: { in: cashierChargeIds } },
                  })
                : await tx.cashierCharge.deleteMany({
                    where: { shiftId: { in: shiftIds } },
                  })
            ).count,
            deletedPayments: (
              await tx.payment.deleteMany({
                where: { shiftId: { in: shiftIds } },
              })
            ).count,
            deletedRiderChargePayments: (
              await tx.riderChargePayment.deleteMany({
                where: { shiftId: { in: shiftIds } },
              })
            ).count,
            deletedRiderVariances: (
              await tx.riderRunVariance.deleteMany({
                where: { shiftId: { in: shiftIds } },
              })
            ).count,
            deletedShiftVariances: (
              varianceIds.length > 0
                ? await tx.cashierShiftVariance.deleteMany({
                    where: { id: { in: varianceIds } },
                  })
                : await tx.cashierShiftVariance.deleteMany({
                    where: { shiftId: { in: shiftIds } },
                  })
            ).count,
            deletedShifts: (
              await tx.cashierShift.deleteMany({
                where: { id: { in: shiftIds } },
              })
            ).count,
          };

          return deleted;
        })
      : {
          deletedArPayments: 0,
          deletedCashDrawerTxns: 0,
          deletedCashierChargePayments: 0,
          deletedCashierCharges: 0,
          deletedPayments: 0,
          deletedRiderChargePayments: 0,
          deletedRiderVariances: 0,
          deletedShiftVariances: 0,
          deletedShifts: 0,
        };

  return {
    ...deletedShiftArtifacts,
    removedCashierStateFile: removeFileIfPresent(
      resolveDeliveryRunHandoffAndRemitAccessHappyPathCashierStateFilePath(),
    ),
    removedContextFile: removeFileIfPresent(CONTEXT_FILE),
    removedManagerStateFile: removeFileIfPresent(
      resolveDeliveryRunHandoffAndRemitAccessHappyPathManagerStateFilePath(),
    ),
    removedRiderStateFile: removeFileIfPresent(
      resolveDeliveryRunHandoffAndRemitAccessHappyPathRiderStateFilePath(),
    ),
    runIds: cleanup.runIds ?? [],
    orderIds: cleanup.orderIds ?? [],
  };
}

export async function resetDeliveryRunHandoffAndRemitAccessHappyPathState() {
  const deleted = await deleteDeliveryRunHandoffAndRemitAccessHappyPathArtifacts();

  const manager = await resolveScenarioUserByEmail(
    resolveDeliveryRunHandoffAndRemitAccessHappyPathManagerEmail(),
    UserRole.STORE_MANAGER,
  );
  const cashier = await resolveScenarioUserByEmail(
    resolveDeliveryRunHandoffAndRemitAccessHappyPathCashierEmail(),
    UserRole.CASHIER,
  );

  const foreignOpenShift = await db.cashierShift.findFirst({
    where: {
      cashierId: cashier.id,
      closedAt: null,
      NOT: {
        deviceId: resolveDeliveryRunHandoffAndRemitAccessHappyPathDeviceId(),
      },
    },
    select: {
      id: true,
      status: true,
      deviceId: true,
    },
    orderBy: { openedAt: "desc" },
  });

  if (foreignOpenShift) {
    throw new Error(
      "Delivery handoff/remit happy path setup stopped because the cashier already has a non-QA open shift. " +
        `Resolve shift #${foreignOpenShift.id} (${foreignOpenShift.status}) first.`,
    );
  }

  const businessFlowContext = await runSetup({ contextFile: CONTEXT_FILE });
  const rider = await resolveScenarioRiderByEmployeeId(
    Number(businessFlowContext.seed.riderId),
  );

  const taggedShift = await ensureTaggedCashierOpenShift(cashier);

  await createStorageStateForUser({
    userId: manager.id,
    stateFilePath: resolveDeliveryRunHandoffAndRemitAccessHappyPathManagerStateFilePath(),
  });
  await createStorageStateForUser({
    userId: rider.id,
    stateFilePath: resolveDeliveryRunHandoffAndRemitAccessHappyPathRiderStateFilePath(),
  });
  await createStorageStateForUser({
    userId: cashier.id,
    stateFilePath: resolveDeliveryRunHandoffAndRemitAccessHappyPathCashierStateFilePath(),
  });

  return {
    cashier,
    deleted,
    manager,
    rider,
    taggedShift,
  };
}

export async function resolveDeliveryRunHandoffAndRemitAccessHappyPathScenarioContext(): Promise<ScenarioContext> {
  const businessFlowContext = readBusinessFlowContext();
  const manager = await resolveScenarioUserByEmail(
    resolveDeliveryRunHandoffAndRemitAccessHappyPathManagerEmail(),
    UserRole.STORE_MANAGER,
  );
  const cashier = await resolveScenarioUserByEmail(
    resolveDeliveryRunHandoffAndRemitAccessHappyPathCashierEmail(),
    UserRole.CASHIER,
  );
  const rider = await resolveScenarioRiderByEmployeeId(
    Number(businessFlowContext.seed.riderId),
  );

  return {
    manager,
    rider,
    cashier,
    checkedInRun: businessFlowContext.runs.checkedIn,
    closedRun: businessFlowContext.runs.closed,
    createdAt: businessFlowContext.createdAt,
    traceId: businessFlowContext.traceId,
    cashierShiftDeviceId: resolveDeliveryRunHandoffAndRemitAccessHappyPathDeviceId(),
    managerStateFilePath:
      resolveDeliveryRunHandoffAndRemitAccessHappyPathManagerStateFilePath(),
    riderStateFilePath:
      resolveDeliveryRunHandoffAndRemitAccessHappyPathRiderStateFilePath(),
    cashierStateFilePath:
      resolveDeliveryRunHandoffAndRemitAccessHappyPathCashierStateFilePath(),
  };
}

async function main() {
  const { deleted, manager, rider, cashier, taggedShift } =
    await resetDeliveryRunHandoffAndRemitAccessHappyPathState();
  const scenario =
    await resolveDeliveryRunHandoffAndRemitAccessHappyPathScenarioContext();

  console.log(
    [
      "Delivery run handoff and remit access happy path setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Manager: ${formatUserLabel(manager)} [userId=${manager.id}]`,
      `Assigned rider: ${formatUserLabel(rider)} [userId=${rider.id}]`,
      `Cashier: ${formatUserLabel(cashier)} [userId=${cashier.id}]`,
      `Checked-in rider-checkin route: ${scenario.checkedInRun.routes.riderCheckin ?? "missing"}`,
      `Checked-in manager remit route: ${scenario.checkedInRun.routes.managerRemit ?? "missing"}`,
      `Closed cashier remit route: ${scenario.closedRun.routes.cashierRunRemit ?? "missing"}`,
      `Tagged cashier shift: #${taggedShift.id} (${taggedShift.status}) via ${taggedShift.deviceId ?? "no-device"}`,
      `Manager storage state: ${scenario.managerStateFilePath}`,
      `Rider storage state: ${scenario.riderStateFilePath}`,
      `Cashier storage state: ${scenario.cashierStateFilePath}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      `Deleted previous runs: ${deleted.runIds.length}`,
      `Deleted previous orders: ${deleted.orderIds.length}`,
      "Next manual QA steps:",
      "1. Open the checked-in remit route as STORE_MANAGER and confirm manager review is visible.",
      "2. Open the checked-in rider-checkin route as the printed assigned rider and confirm rider-only access works.",
      "3. Open the closed cashier remit route as the printed cashier and confirm the tagged open shift unlocks remit hub access.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery handoff/remit access happy-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
