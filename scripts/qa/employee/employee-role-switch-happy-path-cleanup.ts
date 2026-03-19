import "dotenv/config";

import { db } from "~/utils/db.server";
import { deleteEmployeeRoleSwitchHappyPathArtifacts } from "./employee-role-switch-happy-path-setup";

async function main() {
  const summary = await deleteEmployeeRoleSwitchHappyPathArtifacts();

  console.log(
    [
      "Employee role switch happy path cleanup completed.",
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
