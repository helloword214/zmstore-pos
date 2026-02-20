import { PrismaClient } from "@prisma/client";

export function createDbClient() {
  return new PrismaClient();
}
