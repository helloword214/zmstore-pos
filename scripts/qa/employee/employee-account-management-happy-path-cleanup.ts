import "dotenv/config";

import { db } from "~/utils/db.server";
import { deleteEmployeeAccountManagementHappyPathArtifacts } from "./employee-account-management-happy-path-setup";

async function main() {
  const summary = await deleteEmployeeAccountManagementHappyPathArtifacts();

  console.log(
    [
      "Employee account management happy path cleanup completed.",
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

