import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import { deleteDeliveryFinalSettlementInfoOnlyWaivePathArtifacts } from "./delivery-final-settlement-info-only-waive-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteDeliveryFinalSettlementInfoOnlyWaivePathArtifacts();

  console.log(
    [
      "Delivery final settlement info-only/waive path cleanup complete.",
      `Deleted tagged shifts: ${deleted.deletedShifts}`,
      `Deleted tagged runs: ${deleted.runIds.length}`,
      `Deleted tagged orders: ${deleted.orderIds.length}`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery final-settlement info-only/waive cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
