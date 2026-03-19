import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteProductCatalogAdminHappyPathArtifacts,
  resolveProductCatalogAdminHappyPathImageTag,
} from "./product-catalog-admin-happy-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteProductCatalogAdminHappyPathArtifacts();

  console.log(
    [
      "Product catalog admin happy path cleanup is complete.",
      `Image tag marker: ${resolveProductCatalogAdminHappyPathImageTag()}`,
      `Deleted products: ${deleted.deletedProducts}`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown product catalog happy-path cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
