import "dotenv/config";

import { db } from "~/utils/db.server";
import { deleteWorkforceSchedulePlannerPublishVisibilityHappyPathArtifacts } from "./workforce-schedule-planner-publish-visibility-happy-path-setup";

async function main() {
  const summary =
    await deleteWorkforceSchedulePlannerPublishVisibilityHappyPathArtifacts();

  console.log(
    [
      "Workforce schedule planner publish visibility happy path cleanup completed.",
      `Deleted tagged users: ${summary.deletedUsers}`,
      `Deleted tagged employees: ${summary.deletedEmployees}`,
      `Deleted tagged templates: ${summary.deletedTemplates}`,
      `Deleted tagged assignments: ${summary.deletedAssignments}`,
      `Deleted tagged schedules: ${summary.deletedSchedules}`,
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
