import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import { deleteDeliveryPayrollDeductionFollowThroughArtifacts } from "./delivery-payroll-deduction-follow-through-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteDeliveryPayrollDeductionFollowThroughArtifacts();

  console.log(
    [
      "Delivery payroll deduction follow-through cleanup complete.",
      `Deleted tagged payroll runs: ${deleted.deletedPayrollRuns}`,
      `Deleted tagged attendance rows: ${deleted.deletedAttendanceRows}`,
      `Deleted tagged statutory rows: ${deleted.deletedStatutoryProfiles}`,
      `Deleted tagged salary rows: ${deleted.deletedPayProfiles}`,
      `Deleted tagged shifts: ${deleted.deletedShifts}`,
      `Deleted tagged runs: ${deleted.runIds.length}`,
      `Deleted tagged orders: ${deleted.orderIds.length}`,
      `Removed manager state file: ${deleted.removedManagerStateFile ? "yes" : "no"}`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery payroll deduction follow-through cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
