import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryRiderAcceptancePathArtifacts,
  resolveDeliveryRiderAcceptancePathRiderStateFilePath,
} from "./delivery-rider-acceptance-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteDeliveryRiderAcceptancePathArtifacts();

  console.log(
    [
      "Delivery rider acceptance path cleanup complete.",
      `Deleted tagged shifts: ${deleted.deletedShifts}`,
      `Deleted tagged runs: ${deleted.runIds.length}`,
      `Deleted tagged orders: ${deleted.orderIds.length}`,
      `Removed rider state file: ${deleted.removedRiderStateFile ? "yes" : "no"} (${resolveDeliveryRiderAcceptancePathRiderStateFilePath()})`,
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
          : "Unknown delivery rider-acceptance path cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
