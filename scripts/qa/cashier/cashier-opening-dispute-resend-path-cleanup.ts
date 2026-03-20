import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteCashierOpeningDisputeResendPathArtifacts,
  resolveCashierOpeningDisputeResendPathDeviceId,
} from "./cashier-opening-dispute-resend-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteCashierOpeningDisputeResendPathArtifacts();

  console.log(
    [
      "Cashier opening-dispute resend path cleanup completed.",
      `Device marker: ${resolveCashierOpeningDisputeResendPathDeviceId()}`,
      `Deleted tagged shifts: ${deleted.deletedShifts}`,
      `Deleted shift variances: ${deleted.deletedShiftVariances}`,
      `Deleted cashier charges: ${deleted.deletedCashierCharges}`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
