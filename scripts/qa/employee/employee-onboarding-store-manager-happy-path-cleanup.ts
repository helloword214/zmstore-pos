import "dotenv/config";

import { db } from "~/utils/db.server";
import { deleteEmployeeOnboardingStoreManagerHappyPathArtifacts } from "./employee-onboarding-store-manager-happy-path-setup";

async function main() {
  const summary =
    await deleteEmployeeOnboardingStoreManagerHappyPathArtifacts();

  console.log(
    [
      "Employee onboarding store manager happy path cleanup completed.",
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

