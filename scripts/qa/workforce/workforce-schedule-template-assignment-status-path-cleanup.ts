import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import { deleteWorkforceScheduleTemplateAssignmentStatusPathArtifacts } from "./workforce-schedule-template-assignment-status-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted =
    await deleteWorkforceScheduleTemplateAssignmentStatusPathArtifacts();

  console.log(
    [
      "Workforce schedule template assignment status path cleanup complete.",
      `Deleted tagged users: ${deleted.deletedUsers}`,
      `Deleted tagged employees: ${deleted.deletedEmployees}`,
      `Deleted tagged templates: ${deleted.deletedTemplates}`,
      `Deleted tagged assignments: ${deleted.deletedAssignments}`,
      `Deleted tagged schedules: ${deleted.deletedSchedules}`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown workforce schedule template assignment status cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
