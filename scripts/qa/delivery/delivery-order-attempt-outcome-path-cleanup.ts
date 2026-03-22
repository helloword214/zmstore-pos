import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryOrderAttemptOutcomePathArtifacts,
  resolveDeliveryOrderAttemptOutcomePathCashierStateFilePath,
  resolveDeliveryOrderAttemptOutcomePathManagerStateFilePath,
  resolveDeliveryOrderAttemptOutcomePathRiderStateFilePath,
} from "./delivery-order-attempt-outcome-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteDeliveryOrderAttemptOutcomePathArtifacts();

  console.log(
    [
      "Delivery order attempt outcome path cleanup complete.",
      `Deleted tagged shifts: ${deleted.deletedShifts}`,
      `Deleted tagged runs: ${deleted.runIds.length}`,
      `Deleted tagged orders: ${deleted.orderIds.length}`,
      `Removed manager state file: ${deleted.removedManagerStateFile ? "yes" : "no"} (${resolveDeliveryOrderAttemptOutcomePathManagerStateFilePath()})`,
      `Removed rider state file: ${deleted.removedRiderStateFile ? "yes" : "no"} (${resolveDeliveryOrderAttemptOutcomePathRiderStateFilePath()})`,
      `Removed cashier state file: ${deleted.removedCashierStateFile ? "yes" : "no"} (${resolveDeliveryOrderAttemptOutcomePathCashierStateFilePath()})`,
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
          : "Unknown delivery order-attempt-outcome path cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
