import process from "node:process";
import { resolveEnginePaths } from "../contracts.mjs";
import { createDbClient } from "../adapters/db.mjs";
import { readJsonSafe, relativeToRoot, writeJson } from "../fs-utils.mjs";

function uniqIds(values) {
  const set = new Set();
  for (const value of values || []) {
    const asNum = Number(value);
    if (!Number.isFinite(asNum) || asNum <= 0) continue;
    set.add(asNum);
  }
  return [...set];
}

async function collectIdsByPrefix(db, prefix) {
  const runs = await db.deliveryRun.findMany({
    where: { runCode: { startsWith: prefix } },
    select: { id: true },
  });
  const orders = await db.order.findMany({
    where: { orderCode: { startsWith: prefix } },
    select: { id: true },
  });

  return {
    runIds: runs.map((r) => r.id),
    orderIds: orders.map((o) => o.id),
  };
}

export async function runCleanup(options = {}) {
  const defaultPaths = resolveEnginePaths();
  const contextFile =
    options.contextFile ??
    process.env.FLOW_CONTEXT_FILE ??
    defaultPaths.latestContextFile;
  const sweepPrefix = options.sweepPrefix ?? process.env.FLOW_CLEANUP_SWEEP_PREFIX;

  const context = readJsonSafe(contextFile);
  const db = createDbClient();

  try {
    const seededRunIds = uniqIds(context?.cleanup?.runIds ?? []);
    const seededOrderIds = uniqIds(context?.cleanup?.orderIds ?? []);

    let runIds = [...seededRunIds];
    let orderIds = [...seededOrderIds];

    if (sweepPrefix) {
      const tagged = await collectIdsByPrefix(db, sweepPrefix);
      runIds = uniqIds([...runIds, ...tagged.runIds]);
      orderIds = uniqIds([...orderIds, ...tagged.orderIds]);
    }

    if (runIds.length === 0 && orderIds.length === 0) {
      return {
        contextFile: relativeToRoot(defaultPaths.root, contextFile),
        runIds: [],
        orderIds: [],
        deleted: {},
      };
    }

    const deleted = {};

    if (runIds.length > 0) {
      deleted.customerArPaymentsByRun = (
        await db.customerArPayment.deleteMany({
          where: { ar: { runId: { in: runIds } } },
        })
      ).count;
      deleted.customerArByRun = (
        await db.customerAr.deleteMany({
          where: { runId: { in: runIds } },
        })
      ).count;
      deleted.clearanceDecisionsByRun = (
        await db.clearanceDecision.deleteMany({
          where: { clearanceCase: { runId: { in: runIds } } },
        })
      ).count;
      deleted.clearanceClaimsByRun = (
        await db.clearanceClaim.deleteMany({
          where: { clearanceCase: { runId: { in: runIds } } },
        })
      ).count;
      deleted.clearanceCasesByRun = (
        await db.clearanceCase.deleteMany({
          where: { runId: { in: runIds } },
        })
      ).count;
      deleted.riderChargePaymentsByRun = (
        await db.riderChargePayment.deleteMany({
          where: { charge: { runId: { in: runIds } } },
        })
      ).count;
      deleted.riderChargesByRun = (
        await db.riderCharge.deleteMany({
          where: { runId: { in: runIds } },
        })
      ).count;
      deleted.riderVariancesByRun = (
        await db.riderRunVariance.deleteMany({
          where: { runId: { in: runIds } },
        })
      ).count;
      deleted.runReceiptLinesByRun = (
        await db.runReceiptLine.deleteMany({
          where: { receipt: { runId: { in: runIds } } },
        })
      ).count;
      deleted.runReceiptsByRun = (
        await db.runReceipt.deleteMany({
          where: { runId: { in: runIds } },
        })
      ).count;
      deleted.runAdhocSalesByRun = (
        await db.runAdhocSale.deleteMany({
          where: { runId: { in: runIds } },
        })
      ).count;
      deleted.runOrderLinksByRun = (
        await db.deliveryRunOrder.deleteMany({
          where: { runId: { in: runIds } },
        })
      ).count;
    }

    if (orderIds.length > 0) {
      deleted.customerArPaymentsByOrder = (
        await db.customerArPayment.deleteMany({
          where: { ar: { orderId: { in: orderIds } } },
        })
      ).count;
      deleted.customerArByOrder = (
        await db.customerAr.deleteMany({
          where: { orderId: { in: orderIds } },
        })
      ).count;
      deleted.clearanceDecisionsByOrder = (
        await db.clearanceDecision.deleteMany({
          where: { clearanceCase: { orderId: { in: orderIds } } },
        })
      ).count;
      deleted.clearanceClaimsByOrder = (
        await db.clearanceClaim.deleteMany({
          where: { clearanceCase: { orderId: { in: orderIds } } },
        })
      ).count;
      deleted.clearanceCasesByOrder = (
        await db.clearanceCase.deleteMany({
          where: { orderId: { in: orderIds } },
        })
      ).count;
      deleted.paymentsByOrder = (
        await db.payment.deleteMany({
          where: { orderId: { in: orderIds } },
        })
      ).count;
      deleted.orderItems = (
        await db.orderItem.deleteMany({
          where: { orderId: { in: orderIds } },
        })
      ).count;
      deleted.runOrderLinksByOrder = (
        await db.deliveryRunOrder.deleteMany({
          where: { orderId: { in: orderIds } },
        })
      ).count;
    }

    if (runIds.length > 0) {
      deleted.runs = (
        await db.deliveryRun.deleteMany({
          where: { id: { in: runIds } },
        })
      ).count;
    }
    if (orderIds.length > 0) {
      deleted.orders = (
        await db.order.deleteMany({
          where: { id: { in: orderIds } },
        })
      ).count;
    }

    const result = {
      cleanedAt: new Date().toISOString(),
      contextFile: relativeToRoot(defaultPaths.root, contextFile),
      runIds,
      orderIds,
      sweepPrefix: sweepPrefix ?? null,
      deleted,
    };

    writeJson(defaultPaths.smokeReportFile, result);
    return result;
  } finally {
    await db.$disconnect();
  }
}
