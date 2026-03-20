import "dotenv/config";

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, UserRole } from "@prisma/client";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { allocateReceiptNo } from "~/utils/receipt";
import {
  deleteDeliveryCashierOrderRemitShortagePathArtifacts,
  resetDeliveryCashierOrderRemitShortagePathState,
  resolveDeliveryCashierOrderRemitShortagePathScenarioContext,
} from "./delivery-cashier-order-remit-shortage-path-setup";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_MANAGER_EMAIL = "manager1@local";
const AUTH_DIR = path.resolve(
  "test-results/ui/auth/delivery-manager-shortage-review-charge-path",
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
  ReturnType<typeof deleteDeliveryCashierOrderRemitShortagePathArtifacts>
> & {
  removedManagerStateFile: boolean;
};

type DeliveryCashierOrderRemitShortagePathScenario = Awaited<
  ReturnType<typeof resolveDeliveryCashierOrderRemitShortagePathScenarioContext>
>;

export type DeliveryManagerShortageReviewChargePathScenarioContext =
  DeliveryCashierOrderRemitShortagePathScenario & {
    decisionNote: string;
    manager: ScenarioUser;
    managerStateFilePath: string;
    reviewRoute: string;
    awaitingRoute: string;
    varianceId: number;
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

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the delivery manager-shortage-review QA session.",
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

function buildDecisionNote(runCode: string) {
  return `QA manager charge rider decision for ${runCode}`;
}

export function resolveDeliveryManagerShortageReviewChargePathManagerEmail() {
  return normalizeEmail(
    process.env.QA_DELIVERY_MANAGER_SHORTAGE_REVIEW_CHARGE_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveDeliveryManagerShortageReviewChargePathManagerStateFilePath() {
  return path.join(AUTH_DIR, "manager.json");
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
      `Delivery manager-shortage-review charge path requires an active STORE_MANAGER account: ${email}`,
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

async function seedOpenRiderShortageVariance(
  scenario: DeliveryCashierOrderRemitShortagePathScenario,
) {
  const [order, taggedShift, run] = await Promise.all([
    db.order.findUnique({
      where: { id: scenario.remitOrder.id },
      select: {
        id: true,
        status: true,
        paidAt: true,
        receiptNo: true,
        dispatchedAt: true,
        deliveredAt: true,
        isOnCredit: true,
        riderId: true,
        payments: {
          orderBy: { id: "asc" },
          select: {
            id: true,
          },
        },
        runReceipts: {
          orderBy: { id: "asc" },
          select: {
            id: true,
          },
        },
      },
    }),
    db.cashierShift.findFirst({
      where: {
        deviceId: scenario.cashierShiftDeviceId,
        cashierId: scenario.cashier.id,
        closedAt: null,
      },
      select: {
        id: true,
      },
      orderBy: { openedAt: "desc" },
    }),
    db.deliveryRun.findUnique({
      where: { id: scenario.closedRun.id },
      select: {
        id: true,
        riderId: true,
      },
    }),
  ]);

  if (!order) {
    throw new Error(
      `Missing delivery order #${scenario.remitOrder.id} for manager shortage review setup.`,
    );
  }
  if (!taggedShift) {
    throw new Error(
      "Missing tagged open cashier shift for delivery manager shortage review setup.",
    );
  }
  if (!run?.riderId) {
    throw new Error(
      `Delivery run #${scenario.closedRun.id} is missing rider ownership for shortage review setup.`,
    );
  }
  if (order.runReceipts.length !== 1) {
    throw new Error(
      `Expected exactly one parent receipt for order #${order.id} during shortage review setup.`,
    );
  }
  if (order.payments.length > 0) {
    throw new Error(
      `Order #${order.id} already has payments before shortage review setup.`,
    );
  }

  const receiptId = order.runReceipts[0].id;
  const riderId = Number(run.riderId);
  const exactCash = Number(scenario.exactCashInput);
  const shortageCash = Number(scenario.shortageCashInput);
  const shortageAmount = Number(scenario.shortageAmountInput);
  const varianceValue = Number((shortageCash - exactCash).toFixed(2));
  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: order.id,
        method: "CASH",
        amount: new Prisma.Decimal(shortageCash.toFixed(2)),
        tendered: new Prisma.Decimal(shortageCash.toFixed(2)),
        change: new Prisma.Decimal("0.00"),
        refNo: "MAIN-DELIVERY",
        shiftId: taggedShift.id,
        cashierId: scenario.cashier.id,
      },
    });

    await tx.payment.create({
      data: {
        orderId: order.id,
        method: "INTERNAL_CREDIT",
        amount: new Prisma.Decimal(shortageAmount.toFixed(2)),
        tendered: new Prisma.Decimal("0.00"),
        change: new Prisma.Decimal("0.00"),
        refNo: `RIDER-SHORTAGE:RR:${receiptId}`,
        shiftId: taggedShift.id,
        cashierId: scenario.cashier.id,
      },
    });

    await tx.riderRunVariance.upsert({
      where: { receiptId },
      create: {
        receiptId,
        runId: scenario.closedRun.id,
        riderId,
        shiftId: taggedShift.id,
        expected: new Prisma.Decimal(exactCash.toFixed(2)),
        actual: new Prisma.Decimal(shortageCash.toFixed(2)),
        variance: new Prisma.Decimal(varianceValue.toFixed(2)),
        note: `AUTO: cashier shortage settlement for Order#${order.id}`,
        status: "OPEN",
      },
      update: {
        runId: scenario.closedRun.id,
        riderId,
        shiftId: taggedShift.id,
        expected: new Prisma.Decimal(exactCash.toFixed(2)),
        actual: new Prisma.Decimal(shortageCash.toFixed(2)),
        variance: new Prisma.Decimal(varianceValue.toFixed(2)),
        note: `AUTO: cashier shortage settlement for Order#${order.id}`,
        status: "OPEN",
        resolution: undefined,
        managerApprovedAt: null,
        managerApprovedById: undefined,
        riderAcceptedAt: null,
        riderAcceptedById: undefined,
      },
    });

    const receiptNo = await allocateReceiptNo(tx);
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        paidAt: now,
        receiptNo,
        lockedAt: null,
        lockedBy: null,
        dispatchedAt: order.dispatchedAt ?? now,
        deliveredAt: order.deliveredAt ?? now,
        isOnCredit: false,
      },
    });
  });
}

export async function deleteDeliveryManagerShortageReviewChargePathArtifacts(): Promise<DeleteSummary> {
  const deleted = await deleteDeliveryCashierOrderRemitShortagePathArtifacts();

  return {
    ...deleted,
    removedManagerStateFile: removeFileIfPresent(
      resolveDeliveryManagerShortageReviewChargePathManagerStateFilePath(),
    ),
  };
}

export async function resetDeliveryManagerShortageReviewChargePathState() {
  const deleted = await deleteDeliveryManagerShortageReviewChargePathArtifacts();
  await resetDeliveryCashierOrderRemitShortagePathState();
  const manager = await resolveScenarioManager(
    resolveDeliveryManagerShortageReviewChargePathManagerEmail(),
  );

  await createManagerStorageState(
    manager.id,
    resolveDeliveryManagerShortageReviewChargePathManagerStateFilePath(),
  );

  const shortageScenario =
    await resolveDeliveryCashierOrderRemitShortagePathScenarioContext();
  await seedOpenRiderShortageVariance(shortageScenario);

  return {
    deleted,
    manager,
  };
}

export async function resolveDeliveryManagerShortageReviewChargePathScenarioContext(): Promise<DeliveryManagerShortageReviewChargePathScenarioContext> {
  const [manager, shortageScenario] = await Promise.all([
    resolveScenarioManager(
      resolveDeliveryManagerShortageReviewChargePathManagerEmail(),
    ),
    resolveDeliveryCashierOrderRemitShortagePathScenarioContext(),
  ]);

  const variance = await db.riderRunVariance.findFirst({
    where: {
      runId: shortageScenario.closedRun.id,
      receiptId: {
        in: (
          await db.runReceipt.findMany({
            where: {
              runId: shortageScenario.closedRun.id,
              parentOrderId: shortageScenario.remitOrder.id,
              kind: "PARENT",
            },
            select: { id: true },
          })
        ).map((receipt) => receipt.id),
      },
    },
    orderBy: { id: "desc" },
    select: { id: true },
  });

  if (!variance) {
    throw new Error(
      "Delivery manager shortage review charge path could not resolve the seeded rider variance.",
    );
  }

  return {
    ...shortageScenario,
    decisionNote: buildDecisionNote(shortageScenario.closedRun.runCode),
    manager,
    managerStateFilePath:
      resolveDeliveryManagerShortageReviewChargePathManagerStateFilePath(),
    reviewRoute: "/store/rider-variances?tab=open",
    awaitingRoute: "/store/rider-variances?tab=awaiting",
    varianceId: variance.id,
  };
}

async function main() {
  const { deleted, manager } =
    await resetDeliveryManagerShortageReviewChargePathState();
  const scenario =
    await resolveDeliveryManagerShortageReviewChargePathScenarioContext();

  console.log(
    [
      "Delivery manager shortage review charge path setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Manager: ${formatUserLabel(manager)} [userId=${manager.id}]`,
      `Closed run code: ${scenario.closedRun.runCode}`,
      `Variance ref: #${scenario.varianceId}`,
      `Review route: ${scenario.reviewRoute}`,
      `Awaiting route: ${scenario.awaitingRoute}`,
      `Decision note: ${scenario.decisionNote}`,
      `Manager storage state: ${scenario.managerStateFilePath}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      `Deleted previous runs: ${deleted.runIds.length}`,
      `Deleted previous orders: ${deleted.orderIds.length}`,
      "Next manual QA steps:",
      "1. Open the printed review route as STORE_MANAGER.",
      "2. Find the seeded variance row for the printed run code.",
      "3. Choose Charge rider, enter the printed decision note, and save.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery manager-shortage-review charge-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
