import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryRunHandoffAndRemitAccessHappyPathArtifacts,
  resolveDeliveryRunHandoffAndRemitAccessHappyPathCashierStateFilePath,
  resolveDeliveryRunHandoffAndRemitAccessHappyPathDeviceId,
  resolveDeliveryRunHandoffAndRemitAccessHappyPathManagerStateFilePath,
  resolveDeliveryRunHandoffAndRemitAccessHappyPathRiderStateFilePath,
} from "./delivery-run-handoff-and-remit-access-happy-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted =
    await deleteDeliveryRunHandoffAndRemitAccessHappyPathArtifacts();

  console.log(
    [
      "Delivery run handoff and remit access happy path cleanup complete.",
      `Device marker: ${resolveDeliveryRunHandoffAndRemitAccessHappyPathDeviceId()}`,
      `Deleted tagged shifts: ${deleted.deletedShifts}`,
      `Deleted tagged runs: ${deleted.runIds.length}`,
      `Deleted tagged orders: ${deleted.orderIds.length}`,
      `Removed manager state file: ${deleted.removedManagerStateFile ? "yes" : "no"} (${resolveDeliveryRunHandoffAndRemitAccessHappyPathManagerStateFilePath()})`,
      `Removed rider state file: ${deleted.removedRiderStateFile ? "yes" : "no"} (${resolveDeliveryRunHandoffAndRemitAccessHappyPathRiderStateFilePath()})`,
      `Removed cashier state file: ${deleted.removedCashierStateFile ? "yes" : "no"} (${resolveDeliveryRunHandoffAndRemitAccessHappyPathCashierStateFilePath()})`,
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
          : "Unknown delivery handoff/remit access happy-path cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
