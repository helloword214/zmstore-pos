import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CashierShiftStatus, Prisma, UnitKind, UserRole } from "@prisma/client";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import { runCleanup } from "../../automation/business-flow/steps/cleanup.mjs";
import { runSetup } from "../../automation/business-flow/steps/setup.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_CASHIER_EMAIL = "cashier1@local";
const AUTH_DIR = path.resolve(
  "test-results/ui/auth/delivery-cashier-order-remit-posting-happy-path",
);
const CONTEXT_FILE = path.resolve(
  "test-results/automation/business-flow/context.latest.json",
);

export const DELIVERY_CASHIER_ORDER_REMIT_POSTING_HAPPY_PATH_DEVICE_ID =
  "QA-DELIVERY-CASHIER-ORDER-REMIT-POSTING-HAPPY-PATH";

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

type BusinessFlowOrderContext = {
  id: number;
  orderCode: string;
  runId: number;
};

type BusinessFlowContext = {
  createdAt: string;
  traceId: string;
  runs: {
    checkedIn: RunRouteContext;
    closed: RunRouteContext;
  };
  orders: BusinessFlowOrderContext[];
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
  runIds: number[];
  orderIds: number[];
};

type ScenarioContext = {
  cashier: ScenarioUser;
  closedRun: RunRouteContext;
  remitOrder: {
    id: number;
    orderCode: string;
    remitRoute: string;
    runHubRoute: string;
  };
  cashierShiftDeviceId: string;
  cashierStateFilePath: string;
  cashGivenInput: string;
  cashGivenLabel: string;
  createdAt: string;
  traceId: string;
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

function peso(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);
}

function toFixedCurrencyInput(value: number) {
  return value.toFixed(2);
}

export function resolveDeliveryCashierOrderRemitPostingHappyPathCashierEmail() {
  return normalizeEmail(
    process.env.QA_DELIVERY_CASHIER_ORDER_REMIT_POSTING_HAPPY_PATH_CASHIER_EMAIL ??
      process.env.UI_CASHIER_EMAIL ??
      DEFAULT_CASHIER_EMAIL,
  );
}

export function resolveDeliveryCashierOrderRemitPostingHappyPathDeviceId() {
  return (
    process.env.QA_DELIVERY_CASHIER_ORDER_REMIT_POSTING_HAPPY_PATH_DEVICE_ID ??
    DELIVERY_CASHIER_ORDER_REMIT_POSTING_HAPPY_PATH_DEVICE_ID
  ).trim();
}

export function resolveDeliveryCashierOrderRemitPostingHappyPathCashierStateFilePath() {
  return path.join(AUTH_DIR, "cashier.json");
}

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(
      "Invalid auth cookie returned while creating the delivery cashier-remit QA session.",
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

  if (!parsed?.runs?.closed?.id || !Array.isArray(parsed.orders) || parsed.orders.length === 0) {
    throw new Error(
      `Incomplete business flow context (${CONTEXT_FILE}). Expected a closed run and linked orders.`,
    );
  }

  return parsed;
}

async function resolveScenarioCashier(email: string) {
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

  if (!user || !user.active || user.role !== UserRole.CASHIER) {
    throw new Error(
      `Delivery cashier-remit happy path requires an active CASHIER account: ${email}`,
    );
  }

  return {
    ...user,
    branchIds: user.branches.map((branch) => branch.branchId),
  };
}

async function createCashierStorageState(userId: number, stateFilePath: string) {
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

async function listTaggedShiftIds() {
  const taggedShifts = await db.cashierShift.findMany({
    where: { deviceId: resolveDeliveryCashierOrderRemitPostingHappyPathDeviceId() },
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
      deviceId: resolveDeliveryCashierOrderRemitPostingHappyPathDeviceId(),
      notes: "QA delivery cashier remit open shift",
      status: CashierShiftStatus.OPEN,
    },
    select: {
      id: true,
      deviceId: true,
      status: true,
    },
  });
}

async function seedClosedRunParentReceipt(orderId: number, runId: number) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerId: true,
      customer: {
        select: {
          alias: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
      items: {
        select: {
          productId: true,
          name: true,
          qty: true,
          unitKind: true,
          unitPrice: true,
          lineTotal: true,
          baseUnitPrice: true,
          discountAmount: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!order) {
    throw new Error(`Delivery cashier-remit happy path is missing order #${orderId}.`);
  }

  const customerName =
    (order.customer?.alias && order.customer.alias.trim()) ||
    [order.customer?.firstName, order.customer?.lastName]
      .filter(Boolean)
      .join(" ") ||
    null;

  const frozenTotal = Number(
    (order.items || [])
      .reduce((sum, item) => sum + Number(item.lineTotal ?? 0), 0)
      .toFixed(2),
  );

  const receiptKey = `PARENT:${order.id}`;
  const receipt = await db.runReceipt.upsert({
    where: { runId_receiptKey: { runId, receiptKey } },
    create: {
      runId,
      kind: "PARENT",
      receiptKey,
      parentOrderId: order.id,
      customerId: order.customerId ?? null,
      customerName,
      customerPhone: order.customer?.phone ?? null,
      cashCollected: new Prisma.Decimal(frozenTotal.toFixed(2)),
    },
    update: {
      customerId: order.customerId ?? null,
      customerName,
      customerPhone: order.customer?.phone ?? null,
      cashCollected: new Prisma.Decimal(frozenTotal.toFixed(2)),
    },
    select: {
      id: true,
    },
  });

  await db.runReceiptLine.deleteMany({
    where: { receiptId: receipt.id },
  });

  const lines = (order.items || [])
    .map((item) => {
      const productId = Number(item.productId ?? 0);
      const qty = Math.max(0, Number(item.qty ?? 0));
      if (!productId || qty <= 0) return null;
      return {
        receiptId: receipt.id,
        productId,
        name: String(item.name ?? ""),
        qty: new Prisma.Decimal(qty),
        unitKind: (item.unitKind ?? UnitKind.PACK) as UnitKind,
        unitPrice: new Prisma.Decimal(Number(item.unitPrice ?? 0).toFixed(2)),
        lineTotal: new Prisma.Decimal(Number(item.lineTotal ?? 0).toFixed(2)),
        baseUnitPrice:
          item.baseUnitPrice != null
            ? new Prisma.Decimal(Number(item.baseUnitPrice).toFixed(2))
            : null,
        discountAmount:
          item.discountAmount != null
            ? new Prisma.Decimal(Number(item.discountAmount).toFixed(2))
            : null,
      };
    })
    .filter(Boolean) as Array<{
      receiptId: number;
      productId: number;
      name: string;
      qty: Prisma.Decimal;
      unitKind: UnitKind;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      baseUnitPrice: Prisma.Decimal | null;
      discountAmount: Prisma.Decimal | null;
    }>;

  if (lines.length === 0) {
    throw new Error(
      `Delivery cashier-remit happy path requires frozen order items for order #${order.id}.`,
    );
  }

  await db.runReceiptLine.createMany({
    data: lines,
  });

  return {
    frozenTotal,
    receiptId: receipt.id,
  };
}

export async function deleteDeliveryCashierOrderRemitPostingHappyPathArtifacts(): Promise<DeleteSummary> {
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

          return {
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
      resolveDeliveryCashierOrderRemitPostingHappyPathCashierStateFilePath(),
    ),
    removedContextFile: removeFileIfPresent(CONTEXT_FILE),
    runIds: cleanup.runIds ?? [],
    orderIds: cleanup.orderIds ?? [],
  };
}

export async function resetDeliveryCashierOrderRemitPostingHappyPathState() {
  const deleted = await deleteDeliveryCashierOrderRemitPostingHappyPathArtifacts();
  const cashier = await resolveScenarioCashier(
    resolveDeliveryCashierOrderRemitPostingHappyPathCashierEmail(),
  );

  const foreignOpenShift = await db.cashierShift.findFirst({
    where: {
      cashierId: cashier.id,
      closedAt: null,
      NOT: {
        deviceId: resolveDeliveryCashierOrderRemitPostingHappyPathDeviceId(),
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
      "Delivery cashier-remit happy path setup stopped because the cashier already has a non-QA open shift. " +
        `Resolve shift #${foreignOpenShift.id} (${foreignOpenShift.status}) first.`,
    );
  }

  const businessFlowContext = await runSetup({ contextFile: CONTEXT_FILE });
  const closedOrder = businessFlowContext.orders.find(
    (order) => Number(order.runId) === Number(businessFlowContext.runs.closed.id),
  );

  if (!closedOrder) {
    throw new Error("Delivery cashier-remit happy path could not find the closed run order.");
  }

  const parentReceipt = await seedClosedRunParentReceipt(
    closedOrder.id,
    businessFlowContext.runs.closed.id,
  );
  const taggedShift = await ensureTaggedCashierOpenShift(cashier);

  await createCashierStorageState(
    cashier.id,
    resolveDeliveryCashierOrderRemitPostingHappyPathCashierStateFilePath(),
  );

  return {
    cashier,
    closedOrder,
    deleted,
    parentReceipt,
    taggedShift,
  };
}

export async function resolveDeliveryCashierOrderRemitPostingHappyPathScenarioContext(): Promise<ScenarioContext> {
  const businessFlowContext = readBusinessFlowContext();
  const cashier = await resolveScenarioCashier(
    resolveDeliveryCashierOrderRemitPostingHappyPathCashierEmail(),
  );
  const closedOrder = businessFlowContext.orders.find(
    (order) => Number(order.runId) === Number(businessFlowContext.runs.closed.id),
  );

  if (!closedOrder) {
    throw new Error("Delivery cashier-remit happy path could not resolve the closed run order.");
  }

  const order = await db.order.findUnique({
    where: { id: closedOrder.id },
    select: {
      id: true,
      orderCode: true,
      items: {
        select: {
          lineTotal: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error(`Delivery cashier-remit happy path is missing order #${closedOrder.id}.`);
  }

  const finalTotal = Number(
    (order.items || [])
      .reduce((sum, item) => sum + Number(item.lineTotal ?? 0), 0)
      .toFixed(2),
  );

  return {
    cashier,
    closedRun: businessFlowContext.runs.closed,
    remitOrder: {
      id: order.id,
      orderCode: order.orderCode,
      remitRoute: `/delivery-remit/${order.id}?fromRunId=${businessFlowContext.runs.closed.id}`,
      runHubRoute: `/cashier/delivery/${businessFlowContext.runs.closed.id}`,
    },
    cashierShiftDeviceId: resolveDeliveryCashierOrderRemitPostingHappyPathDeviceId(),
    cashierStateFilePath:
      resolveDeliveryCashierOrderRemitPostingHappyPathCashierStateFilePath(),
    cashGivenInput: toFixedCurrencyInput(finalTotal),
    cashGivenLabel: peso(finalTotal),
    createdAt: businessFlowContext.createdAt,
    traceId: businessFlowContext.traceId,
  };
}

async function main() {
  const { deleted, cashier, closedOrder, parentReceipt, taggedShift } =
    await resetDeliveryCashierOrderRemitPostingHappyPathState();
  const scenario =
    await resolveDeliveryCashierOrderRemitPostingHappyPathScenarioContext();

  console.log(
    [
      "Delivery cashier order remit posting happy path setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Cashier: ${formatUserLabel(cashier)} [userId=${cashier.id}]`,
      `Closed run code: ${scenario.closedRun.runCode}`,
      `Order: ${closedOrder.orderCode} [orderId=${closedOrder.id}]`,
      `Order remit route: ${scenario.remitOrder.remitRoute}`,
      `Run hub route: ${scenario.remitOrder.runHubRoute}`,
      `Seeded parent receipt: #${parentReceipt.receiptId} with rider cash ${scenario.cashGivenLabel}`,
      `Tagged cashier shift: #${taggedShift.id} (${taggedShift.status}) via ${taggedShift.deviceId ?? "no-device"}`,
      `Cashier storage state: ${scenario.cashierStateFilePath}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      `Deleted previous runs: ${deleted.runIds.length}`,
      `Deleted previous orders: ${deleted.orderIds.length}`,
      "Next manual QA steps:",
      "1. Open the printed order remit route as CASHIER.",
      "2. Uncheck print after posting so the flow returns to the run hub.",
      "3. Post the exact printed cash amount and confirm redirect back to the closed run remit hub.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery cashier-remit happy-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
