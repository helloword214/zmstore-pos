import { RunStatus } from "@prisma/client";
import { db } from "~/utils/db.server";

export const ACTIVE_DELIVERY_RUN_STATUSES = [
  RunStatus.PLANNED,
  RunStatus.DISPATCHED,
  RunStatus.CHECKED_IN,
] as const;

type DeliveryRunOrderReader = Pick<typeof db, "deliveryRunOrder">;

export type ActiveDeliveryRunLink = {
  orderId: number;
  runId: number;
  runCode: string | null;
  runStatus: RunStatus;
};

export async function loadActiveDeliveryRunLinksByOrderIds(
  tx: DeliveryRunOrderReader,
  orderIds: number[],
  options: { excludeRunId?: number | null } = {},
) {
  const uniqueOrderIds = Array.from(
    new Set(
      orderIds.filter((orderId) => Number.isFinite(orderId) && Number(orderId) > 0),
    ),
  );

  if (uniqueOrderIds.length === 0) {
    return new Map<number, ActiveDeliveryRunLink>();
  }

  const rows = await tx.deliveryRunOrder.findMany({
    where: {
      orderId: { in: uniqueOrderIds },
      ...(options.excludeRunId && Number(options.excludeRunId) > 0
        ? { runId: { not: Number(options.excludeRunId) } }
        : {}),
      run: {
        status: {
          in: [...ACTIVE_DELIVERY_RUN_STATUSES],
        },
      },
    },
    orderBy: [{ orderId: "asc" }, { runId: "desc" }],
    select: {
      orderId: true,
      runId: true,
      run: {
        select: {
          runCode: true,
          status: true,
        },
      },
    },
  });

  const activeLinks = new Map<number, ActiveDeliveryRunLink>();
  for (const row of rows) {
    const orderId = Number(row.orderId || 0);
    if (!orderId || activeLinks.has(orderId)) continue;

    activeLinks.set(orderId, {
      orderId,
      runId: Number(row.runId),
      runCode: row.run?.runCode ?? null,
      runStatus: row.run?.status ?? RunStatus.PLANNED,
    });
  }

  return activeLinks;
}
