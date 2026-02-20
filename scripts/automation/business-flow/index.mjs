#!/usr/bin/env node
import process from "node:process";
import { resolveEnginePaths } from "./contracts.mjs";
import { runCleanup } from "./steps/cleanup.mjs";
import { runSetup } from "./steps/setup.mjs";
import { runSmoke } from "./steps/smoke.mjs";

function printUsage() {
  console.log("Business Flow Engine commands:");
  console.log("  node scripts/automation/business-flow/index.mjs setup");
  console.log("  node scripts/automation/business-flow/index.mjs cleanup");
  console.log("  node scripts/automation/business-flow/index.mjs smoke");
}

async function main() {
  const command = (process.argv[2] || "help").toLowerCase();
  const paths = resolveEnginePaths();

  if (command === "setup") {
    const context = await runSetup();
    console.log("Business flow setup complete.");
    console.log(`Context file: ${context.artifacts.latestContextFile}`);
    return;
  }

  if (command === "cleanup") {
    const result = await runCleanup({ contextFile: paths.latestContextFile });
    console.log("Business flow cleanup complete.");
    console.log(`Run IDs: ${result.runIds.join(", ") || "none"}`);
    console.log(`Order IDs: ${result.orderIds.join(", ") || "none"}`);
    return;
  }

  if (command === "smoke") {
    const result = await runSmoke();
    if (!result.ok) {
      process.exit(result.exitCode || 1);
    }
    console.log("Business flow smoke passed.");
    return;
  }

  printUsage();
}

main().catch((error) => {
  console.error("Business flow engine failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
