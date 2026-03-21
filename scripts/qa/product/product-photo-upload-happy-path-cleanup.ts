import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteProductPhotoUploadHappyPathArtifacts,
  resolveProductPhotoUploadHappyPathImageTag,
} from "./product-photo-upload-happy-path-setup";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function main() {
  const deleted = await deleteProductPhotoUploadHappyPathArtifacts();

  console.log(
    [
      "Product photo upload happy path cleanup is complete.",
      `Image tag marker: ${resolveProductPhotoUploadHappyPathImageTag()}`,
      `Deleted products: ${deleted.deletedProducts}`,
      `Deleted photo files: ${deleted.deletedPhotoFiles}`,
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown product photo upload happy-path cleanup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
