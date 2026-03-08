import { PrismaClient } from "@prisma/client";

type GlobalWithDb = typeof globalThis & { __db?: PrismaClient };
const globalForDb = globalThis as GlobalWithDb;
const db = globalForDb.__db ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__db = db;
}

export { db };
