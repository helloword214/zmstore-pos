import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "~/utils/db.server";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export async function allocateReceiptNo(tx: AnyClient = db) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");

  // singleton counter; created on first use
  const row = await tx.receiptCounter.upsert({
    where: { id: 1 },
    create: { id: 1, current: 1 },
    update: { current: { increment: 1 } },
    select: { current: true },
  });

  const seq = String(row.current).padStart(6, "0");
  return `${y}${m}${d}-${seq}`;
}
