import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CashierShiftStatus, Prisma, UserRole } from "@prisma/client";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { runCleanup } from "../../automation/business-flow/steps/cleanup.mjs";
import { runSetup } from "../../automation/business-flow/steps/setup.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_MANAGER_EMAIL = "manager1@local";
const DEFAULT_CASHIER_EMAIL = "cashier1@local";
const AUTH_DIR = path.resolve(
  "test-results/ui/auth/delivery-order-attempt-outcome-path",
);
const CONTEXT_FILE = path.resolve(
  "test-results/automation/business-flow/context.latest.json",
);

export const DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_DEVICE_ID =
  "QA-DELIVERY-ORDER-ATTEMPT-OUTCOME-PATH";

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

type OrderRouteContext = {
  id: number;
  orderCode: string;
  runId: number;
};

type BusinessFlowContext = {
  createdAt: string;
  traceId: string;
  seed: {
    riderId: number;
    riderLabel: string;
    productId: number;
    productName: string;
  };
  runs: {
    checkedIn: RunRouteContext;
    closed: RunRouteContext;
  };
  orders: OrderRouteContext[];
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

export type DeliveryOrderAttemptOutcomePathScenarioContext = {
  manager: ScenarioUser;
  rider: ScenarioUser;
  cashier: ScenarioUser;
  activeRun: RunRouteContext;
  activeOrder: OrderRouteContext;
  createdAt: string;
  traceId: string;
  productId: number;
  productName: string;
  dispatchRoute: string;
  cashierRunRemitRoute: string;
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

export function resolveDeliveryOrderAttemptOutcomePathManagerEmail() {
  return normalizeEmail(
    process.env.QA_DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveDeliveryOrderAttemptOutcomePathCashierEmail() {
  return normalizeEmail(
    process.env.QA_DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_CASHIER_EMAIL ??
      process.env.UI_CASHIER_EMAIL ??
      DEFAULT_CASHIER_EMAIL,
  );
}

export function resolveDeliveryOrderAttemptOutcomePathDeviceId() {
  return (
    process.env.QA_DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_DEVICE_ID ??
    DELIVERY_ORDER_ATTEMPT_OUTCOME_PATH_DEVICE_ID
  ).trim();
}

export function resolveDeliveryOrderAttemptOutcomePathManagerStateFilePath() {
  return path.join(AUTH_DIR, "manager.json");
}

export function resolveDeliveryOrderAttemptOutcomePathRiderStateFilePath() {
  return path.join(AUTH_DIR, "rider.json");
}

export function resolveDeliveryOrderAttemptOutcomePathCashierStateFilePath() {
  return path.join(AUTH_DIR, "cashier.json");
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the delivery order-attempt-outcome QA session.",
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

  if (!parsed?.runs?.checkedIn?.id || !parsed?.seed?.riderId || !parsed?.orders?.length) {
    throw new Error(
      `Incomplete business flow context (${CONTEXT_FILE}). Expected an active run, seeded rider, and at least one order.`,
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
      `Delivery order-attempt-outcome path requires an active ${role} account: ${email}`,
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
      `Delivery order-attempt-outcome path requires an active linked user for rider employee #${employeeId}.`,
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
    where: { deviceId: resolveDeliveryOrderAttemptOutcomePathDeviceId() },
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
      deviceId: resolveDeliveryOrderAttemptOutcomePathDeviceId(),
      notes: "QA delivery order attempt outcome open shift",
      status: CashierShiftStatus.OPEN,
    },
    select: {
      id: true,
      deviceId: true,
      status: true,
    },
  });
}

async function ensureEditableActiveRun(runId: number) {
  return db.deliveryRun.update({
    where: { id: runId },
    data: {
      status: "DISPATCHED",
      riderCheckinAt: null,
      riderCheckinSnapshot: Prisma.DbNull,
      riderCheckinNotes: null,
      closedAt: null,
    },
    select: {
      id: true,
      status: true,
    },
  });
}

export async function deleteDeliveryOrderAttemptOutcomePathArtifacts(): Promise<DeleteSummary> {
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
      resolveDeliveryOrderAttemptOutcomePathCashierStateFilePath(),
    ),
    removedContextFile: removeFileIfPresent(CONTEXT_FILE),
    removedManagerStateFile: removeFileIfPresent(
      resolveDeliveryOrderAttemptOutcomePathManagerStateFilePath(),
    ),
    removedRiderStateFile: removeFileIfPresent(
      resolveDeliveryOrderAttemptOutcomePathRiderStateFilePath(),
    ),
    runIds: cleanup.runIds ?? [],
    orderIds: cleanup.orderIds ?? [],
  };
}

export async function resetDeliveryOrderAttemptOutcomePathState() {
  const deleted = await deleteDeliveryOrderAttemptOutcomePathArtifacts();

  const manager = await resolveScenarioUserByEmail(
    resolveDeliveryOrderAttemptOutcomePathManagerEmail(),
    UserRole.STORE_MANAGER,
  );
  const cashier = await resolveScenarioUserByEmail(
    resolveDeliveryOrderAttemptOutcomePathCashierEmail(),
    UserRole.CASHIER,
  );

  const foreignOpenShift = await db.cashierShift.findFirst({
    where: {
      cashierId: cashier.id,
      closedAt: null,
      NOT: {
        deviceId: resolveDeliveryOrderAttemptOutcomePathDeviceId(),
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
      "Delivery order-attempt-outcome path setup stopped because the cashier already has a non-QA open shift. " +
        `Resolve shift #${foreignOpenShift.id} (${foreignOpenShift.status}) first.`,
    );
  }

  const businessFlowContext = await runSetup({ contextFile: CONTEXT_FILE });
  const rider = await resolveScenarioRiderByEmployeeId(
    Number(businessFlowContext.seed.riderId),
  );

  const taggedShift = await ensureTaggedCashierOpenShift(cashier);
  await ensureEditableActiveRun(businessFlowContext.runs.checkedIn.id);

  await createStorageStateForUser({
    userId: manager.id,
    stateFilePath: resolveDeliveryOrderAttemptOutcomePathManagerStateFilePath(),
  });
  await createStorageStateForUser({
    userId: rider.id,
    stateFilePath: resolveDeliveryOrderAttemptOutcomePathRiderStateFilePath(),
  });
  await createStorageStateForUser({
    userId: cashier.id,
    stateFilePath: resolveDeliveryOrderAttemptOutcomePathCashierStateFilePath(),
  });

  return {
    cashier,
    deleted,
    manager,
    rider,
    taggedShift,
  };
}

export async function resolveDeliveryOrderAttemptOutcomePathScenarioContext(): Promise<DeliveryOrderAttemptOutcomePathScenarioContext> {
  const businessFlowContext = readBusinessFlowContext();
  const manager = await resolveScenarioUserByEmail(
    resolveDeliveryOrderAttemptOutcomePathManagerEmail(),
    UserRole.STORE_MANAGER,
  );
  const cashier = await resolveScenarioUserByEmail(
    resolveDeliveryOrderAttemptOutcomePathCashierEmail(),
    UserRole.CASHIER,
  );
  const rider = await resolveScenarioRiderByEmployeeId(
    Number(businessFlowContext.seed.riderId),
  );

  const activeOrder = businessFlowContext.orders.find(
    (order) => order.runId === businessFlowContext.runs.checkedIn.id,
  );
  if (!activeOrder) {
    throw new Error(
      `Missing active checked-in order in ${CONTEXT_FILE} for run #${businessFlowContext.runs.checkedIn.id}.`,
    );
  }

  const activeRunRecord = await db.deliveryRun.findUnique({
    where: { id: businessFlowContext.runs.checkedIn.id },
    select: { status: true },
  });

  return {
    manager,
    rider,
    cashier,
    activeRun: {
      ...businessFlowContext.runs.checkedIn,
      status: activeRunRecord?.status ?? businessFlowContext.runs.checkedIn.status,
    },
    activeOrder,
    createdAt: businessFlowContext.createdAt,
    traceId: businessFlowContext.traceId,
    productId: Number(businessFlowContext.seed.productId),
    productName: businessFlowContext.seed.productName,
    dispatchRoute: "/store/dispatch",
    cashierRunRemitRoute: `/cashier/delivery/${businessFlowContext.runs.checkedIn.id}`,
    cashierShiftDeviceId: resolveDeliveryOrderAttemptOutcomePathDeviceId(),
    managerStateFilePath: resolveDeliveryOrderAttemptOutcomePathManagerStateFilePath(),
    riderStateFilePath: resolveDeliveryOrderAttemptOutcomePathRiderStateFilePath(),
    cashierStateFilePath: resolveDeliveryOrderAttemptOutcomePathCashierStateFilePath(),
  };
}

async function main() {
  const { deleted, manager, rider, cashier, taggedShift } =
    await resetDeliveryOrderAttemptOutcomePathState();
  const scenario = await resolveDeliveryOrderAttemptOutcomePathScenarioContext();

  console.log(
    [
      "Delivery order attempt outcome path setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Manager: ${formatUserLabel(manager)} [userId=${manager.id}]`,
      `Assigned rider: ${formatUserLabel(rider)} [userId=${rider.id}]`,
      `Cashier: ${formatUserLabel(cashier)} [userId=${cashier.id}]`,
      `Active rider-checkin route: ${scenario.activeRun.routes.riderCheckin ?? "missing"}`,
      `Manager remit route: ${scenario.activeRun.routes.managerRemit ?? "missing"}`,
      `Dispatch route: ${scenario.dispatchRoute}`,
      `Cashier run-remit route: ${scenario.cashierRunRemitRoute}`,
      `Tagged cashier shift: #${taggedShift.id} (${taggedShift.status}) via ${taggedShift.deviceId ?? "no-device"}`,
      `Manager storage state: ${scenario.managerStateFilePath}`,
      `Rider storage state: ${scenario.riderStateFilePath}`,
      `Cashier storage state: ${scenario.cashierStateFilePath}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      `Deleted previous runs: ${deleted.runIds.length}`,
      `Deleted previous orders: ${deleted.orderIds.length}`,
      "Next manual QA steps:",
      "1. Open the active rider-checkin route as the assigned rider and choose a no-release outcome.",
      "2. Submit rider check-in, then open the manager remit route and finalize either reattempt or cancel.",
      "3. Confirm the closed run stays empty on cashier remit and the order behaves correctly in dispatch.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery order-attempt-outcome path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
