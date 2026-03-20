import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import { deleteEmployeeProfileEditHappyPathArtifacts } from "./employee-profile-edit-happy-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteEmployeeProfileEditHappyPathArtifacts();

  console.log(
    [
      "Employee profile edit happy path cleanup completed.",
      `Deleted tagged users: ${deleted.deletedUsers}`,
      `Deleted tagged employees: ${deleted.deletedEmployees}`,
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
