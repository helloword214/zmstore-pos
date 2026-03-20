import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryCashierOrderRemitShortagePathArtifacts,
  resolveDeliveryCashierOrderRemitShortagePathCashierStateFilePath,
  resolveDeliveryCashierOrderRemitShortagePathDeviceId,
} from "./delivery-cashier-order-remit-shortage-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteDeliveryCashierOrderRemitShortagePathArtifacts();

  console.log(
    [
      "Delivery cashier order remit shortage path cleanup complete.",
      `Device marker: ${resolveDeliveryCashierOrderRemitShortagePathDeviceId()}`,
      `Deleted tagged shifts: ${deleted.deletedShifts}`,
      `Deleted tagged runs: ${deleted.runIds.length}`,
      `Deleted tagged orders: ${deleted.orderIds.length}`,
      `Removed cashier state file: ${deleted.removedCashierStateFile ? "yes" : "no"} (${resolveDeliveryCashierOrderRemitShortagePathCashierStateFilePath()})`,
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
          : "Unknown delivery cashier-remit shortage-path cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
