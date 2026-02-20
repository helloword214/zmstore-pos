import process from "node:process";
import {
  DEFAULT_TAG_PREFIX,
  ENGINE_NAME,
  ENGINE_VERSION,
  nowStamp,
  resolveEnginePaths,
  shortToken,
} from "../contracts.mjs";
import { createDbClient } from "../adapters/db.mjs";
import { ensureDir, relativeToRoot, writeJson, writeText } from "../fs-utils.mjs";

function r2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function pickUnitPrice(product) {
  const srp = Number(product?.srp ?? 0);
  if (srp > 0) return r2(srp);

  const price = Number(product?.price ?? 0);
  if (price > 0) return r2(price);

  return 1;
}

function riderLabel(rider) {
  return (
    (rider?.alias || "").trim() ||
    [rider?.firstName, rider?.lastName].filter(Boolean).join(" ").trim() ||
    `Rider #${rider?.id ?? "?"}`
  );
}

function customerLabel(customer) {
  if (!customer) return null;
  return (
    (customer.alias || "").trim() ||
    [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() ||
    `Customer #${customer.id}`
  );
}

function buildCode(prefix, kind, stamp, segment) {
  const cleanStamp = stamp.replace(/[^0-9TZ-]/g, "").slice(0, 19);
  return `${prefix}-${kind}-${segment}-${cleanStamp}-${shortToken(4)}`;
}

async function createDeliveryOrder(db, args) {
  const {
    prefix,
    stamp,
    segment,
    now,
    expiresAt,
    rider,
    riderDisplayName,
    product,
    customer,
    customerDisplayName,
    traceId,
  } = args;

  const unitPrice = pickUnitPrice(product);
  const qty = 1;
  const lineTotal = r2(unitPrice * qty);
  const orderCode = buildCode(prefix, "ORD", stamp, segment);

  const order = await db.order.create({
    data: {
      orderCode,
      status: "UNPAID",
      channel: "DELIVERY",
      subtotal: lineTotal,
      totalBeforeDiscount: lineTotal,
      printedAt: now,
      expiryAt: expiresAt,
      terminalId: "AUTO-BFLOW",
      customerId: customer?.id ?? null,
      deliverTo: customerDisplayName ?? `Automation ${segment}`,
      deliverPhone: customer?.phone ?? null,
      fulfillmentStatus: "DISPATCHED",
      dispatchedAt: now,
      riderId: rider.id,
      riderName: riderDisplayName,
      remitGroup: traceId,
      items: {
        create: [
          {
            productId: product.id,
            name: product.name,
            qty,
            unitPrice,
            lineTotal,
            unitKind: "PACK",
            baseUnitPrice: unitPrice,
            discountAmount: 0,
            isLpg: false,
          },
        ],
      },
    },
    select: { id: true, orderCode: true },
  });

  return order;
}

export async function runSetup(options = {}) {
  const stamp = options.stamp ?? nowStamp();
  const paths = resolveEnginePaths({ stamp });
  ensureDir(paths.runDir);
  ensureDir(paths.runsDir);
  ensureDir(paths.incidentsDir);

  const prefix = process.env.FLOW_TAG_PREFIX ?? DEFAULT_TAG_PREFIX;
  const traceId = `${prefix}-${stamp}-${shortToken(5)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const db = createDbClient();

  try {
    const rider = await db.employee.findFirst({
      where: { role: "RIDER", active: true },
      orderBy: { id: "asc" },
      select: { id: true, firstName: true, lastName: true, alias: true },
    });
    if (!rider) {
      throw new Error("No active rider found. Seed employee data before setup.");
    }

    const product = await db.product.findFirst({
      where: { isActive: true },
      orderBy: { id: "asc" },
      select: { id: true, name: true, price: true, srp: true },
    });
    if (!product) {
      throw new Error("No active product found. Seed catalog data before setup.");
    }

    const customer = await db.customer.findFirst({
      orderBy: { id: "asc" },
      select: {
        id: true,
        alias: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    });
    const customerDisplayName = customerLabel(customer);

    const riderDisplayName = riderLabel(rider);
    const orderCheckedIn = await createDeliveryOrder(db, {
      prefix,
      stamp,
      segment: "CHK",
      now,
      expiresAt,
      rider,
      riderDisplayName,
      product,
      customer,
      customerDisplayName,
      traceId,
    });
    const orderClosed = await createDeliveryOrder(db, {
      prefix,
      stamp,
      segment: "CLS",
      now,
      expiresAt,
      rider,
      riderDisplayName,
      product,
      customer,
      customerDisplayName,
      traceId,
    });

    const checkedInRun = await db.deliveryRun.create({
      data: {
        runCode: buildCode(prefix, "RUN", stamp, "CHK"),
        status: "CHECKED_IN",
        riderId: rider.id,
        dispatchedAt: now,
        riderCheckinAt: now,
        loadoutSnapshot: [
          {
            productId: product.id,
            name: product.name,
            qty: 1,
            unitKind: "PACK",
          },
        ],
        riderCheckinSnapshot: {
          source: ENGINE_NAME,
          traceId,
        },
        notes: `AUTOMATION_TRACE:${traceId}`,
      },
      select: { id: true, runCode: true, status: true },
    });

    const closedRun = await db.deliveryRun.create({
      data: {
        runCode: buildCode(prefix, "RUN", stamp, "CLS"),
        status: "CLOSED",
        riderId: rider.id,
        dispatchedAt: now,
        riderCheckinAt: now,
        closedAt: now,
        loadoutSnapshot: [
          {
            productId: product.id,
            name: product.name,
            qty: 1,
            unitKind: "PACK",
          },
        ],
        riderCheckinSnapshot: {
          source: ENGINE_NAME,
          traceId,
        },
        notes: `AUTOMATION_TRACE:${traceId}`,
      },
      select: { id: true, runCode: true, status: true },
    });

    await db.deliveryRunOrder.createMany({
      data: [
        { runId: checkedInRun.id, orderId: orderCheckedIn.id, sequence: 1 },
        { runId: closedRun.id, orderId: orderClosed.id, sequence: 1 },
      ],
      skipDuplicates: true,
    });

    const context = {
      engine: {
        name: ENGINE_NAME,
        version: ENGINE_VERSION,
      },
      createdAt: now.toISOString(),
      traceId,
      tagPrefix: prefix,
      seed: {
        riderId: rider.id,
        riderLabel: riderDisplayName,
        productId: product.id,
        productName: product.name,
        customerId: customer?.id ?? null,
        customerLabel: customerDisplayName,
      },
      runs: {
        checkedIn: {
          id: checkedInRun.id,
          runCode: checkedInRun.runCode,
          status: checkedInRun.status,
          routes: {
            riderCheckin: `/runs/${checkedInRun.id}/rider-checkin`,
            managerRemit: `/runs/${checkedInRun.id}/remit`,
            summary: `/runs/${checkedInRun.id}/summary`,
          },
        },
        closed: {
          id: closedRun.id,
          runCode: closedRun.runCode,
          status: closedRun.status,
          routes: {
            managerRemit: `/runs/${closedRun.id}/remit`,
            cashierRunRemit: `/cashier/delivery/${closedRun.id}`,
            summary: `/runs/${closedRun.id}/summary`,
          },
        },
      },
      orders: [
        {
          id: orderCheckedIn.id,
          orderCode: orderCheckedIn.orderCode,
          runId: checkedInRun.id,
        },
        {
          id: orderClosed.id,
          orderCode: orderClosed.orderCode,
          runId: closedRun.id,
        },
      ],
      routes: {
        riderList: process.env.UI_ROUTE_RIDER_LIST ?? "/rider/variances",
        cashierShift: process.env.UI_ROUTE_CASHIER_SHIFT ?? "/cashier/shift",
      },
      cleanup: {
        runIds: [checkedInRun.id, closedRun.id],
        orderIds: [orderCheckedIn.id, orderClosed.id],
        traceId,
        tagPrefix: prefix,
      },
      artifacts: {
        runContextFile: relativeToRoot(paths.root, paths.runContextFile),
        runSummaryFile: relativeToRoot(paths.root, paths.runSummaryFile),
        latestContextFile: relativeToRoot(paths.root, paths.latestContextFile),
      },
    };

    writeJson(paths.runContextFile, context);
    writeJson(paths.latestContextFile, context);

    const summary = [
      `# Business Flow Setup — ${stamp}`,
      "",
      `- Trace ID: ${traceId}`,
      `- Created At: ${context.createdAt}`,
      `- Checked-in run: ${checkedInRun.runCode} (#${checkedInRun.id})`,
      `- Closed run: ${closedRun.runCode} (#${closedRun.id})`,
      `- Orders: ${orderCheckedIn.orderCode}, ${orderClosed.orderCode}`,
      "",
      "## Routes",
      "",
      `- Rider check-in: ${context.runs.checkedIn.routes.riderCheckin}`,
      `- Manager remit (checked-in): ${context.runs.checkedIn.routes.managerRemit}`,
      `- Manager remit (closed): ${context.runs.closed.routes.managerRemit}`,
      `- Cashier run remit: ${context.runs.closed.routes.cashierRunRemit}`,
      "",
      "## Cleanup Targets",
      "",
      `- Run IDs: ${context.cleanup.runIds.join(", ")}`,
      `- Order IDs: ${context.cleanup.orderIds.join(", ")}`,
      "",
      "## Context Artifacts",
      "",
      `- ${context.artifacts.runContextFile}`,
      `- ${context.artifacts.latestContextFile}`,
      "",
    ].join("\n");

    writeText(paths.runSummaryFile, summary);
    writeText(paths.latestSummaryFile, summary);

    return context;
  } finally {
    await db.$disconnect();
  }
}
