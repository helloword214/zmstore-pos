import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteCashierShiftDisputeShortagePathArtifacts,
  resolveCashierShiftDisputeShortagePathDeviceId,
} from "./cashier-shift-dispute-shortage-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteCashierShiftDisputeShortagePathArtifacts();

  console.log(
    [
      "Cashier shift dispute-shortage path cleanup is complete.",
      `Device marker: ${resolveCashierShiftDisputeShortagePathDeviceId()}`,
      `Deleted shifts: ${deleted.deletedShifts}`,
      `Deleted shift variances: ${deleted.deletedShiftVariances}`,
      `Deleted cashier charges: ${deleted.deletedCashierCharges}`,
      `Deleted cashier charge payments: ${deleted.deletedCashierChargePayments}`,
      `Deleted rider charge payments: ${deleted.deletedRiderChargePayments}`,
      `Deleted rider variances: ${deleted.deletedRiderVariances}`,
      `Deleted drawer txns: ${deleted.deletedCashDrawerTxns}`,
      `Deleted payments: ${deleted.deletedPayments}`,
      `Deleted A/R payments: ${deleted.deletedArPayments}`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown cashier shortage-path cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
