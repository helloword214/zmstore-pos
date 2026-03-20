import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import { deleteDeliveryFinalSettlementGatingArtifacts } from "./delivery-final-settlement-gating-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteDeliveryFinalSettlementGatingArtifacts();

  console.log(
    [
      "Delivery final settlement gating cleanup complete.",
      `Deleted tagged shifts: ${deleted.deletedShifts}`,
      `Deleted tagged runs: ${deleted.runIds.length}`,
      `Deleted tagged orders: ${deleted.orderIds.length}`,
      `Removed cashier state file: ${deleted.removedCashierStateFile ? "yes" : "no"}`,
      `Removed manager state file: ${deleted.removedManagerStateFile ? "yes" : "no"}`,
      `Removed rider state file: ${deleted.removedRiderStateFile ? "yes" : "no"}`,
      `Removed context file: ${deleted.removedContextFile ? "yes" : "no"}`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery final-settlement gating cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
