import "dotenv/config";

import { db } from "~/utils/db.server";
import { deleteEmployeeOnboardingRiderHappyPathArtifacts } from "./employee-onboarding-rider-happy-path-setup";

async function main() {
  const summary = await deleteEmployeeOnboardingRiderHappyPathArtifacts();

  console.log(
    [
      "Employee onboarding rider happy path cleanup completed.",
      `Deleted tagged users: ${summary.deletedUsers}`,
      `Deleted tagged employees: ${summary.deletedEmployees}`,
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

