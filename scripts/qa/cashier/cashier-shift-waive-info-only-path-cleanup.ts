import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import { deleteCashierShiftWaiveInfoOnlyPathArtifacts } from "./cashier-shift-waive-info-only-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteCashierShiftWaiveInfoOnlyPathArtifacts();

  console.log(
    [
      "Cashier shift waive/info-only path cleanup complete.",
      `Deleted tagged shifts: ${deleted.deletedShifts}`,
      `Deleted shift variances: ${deleted.deletedShiftVariances}`,
      `Deleted cashier charges: ${deleted.deletedCashierCharges}`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown cashier waive/info-only cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
