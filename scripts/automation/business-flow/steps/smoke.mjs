import { spawnSync } from "node:child_process";
import process from "node:process";
import { resolveEnginePaths } from "../contracts.mjs";
import { runCleanup } from "./cleanup.mjs";
import { runSetup } from "./setup.mjs";

function runCommand(cmd, args, env) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env,
  });
  return result.status ?? 1;
}

function parseProjects(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const DEFAULT_FLOW_PROJECTS = [
  "manager-flow-desktop",
  "rider-flow-desktop",
  "cashier-flow-desktop",
];

export async function runSmoke(options = {}) {
  const keepData = options.keepData ?? process.env.FLOW_KEEP_DATA === "1";
  const paths = resolveEnginePaths();

  await runSetup(options.setupOptions ?? {});

  const setupEnv = {
    ...process.env,
    FLOW_CONTEXT_FILE: paths.latestContextFile,
  };

  const authExit = runCommand("npm", ["run", "ui:test:auth"], setupEnv);
  if (authExit !== 0) {
    if (!keepData) await runCleanup({ contextFile: paths.latestContextFile });
    return { ok: false, stage: "auth", exitCode: authExit };
  }

  const selectedProjects = parseProjects(process.env.FLOW_PROJECTS);
  const projects = selectedProjects.length > 0 ? selectedProjects : DEFAULT_FLOW_PROJECTS;
  const projectArgs = projects.flatMap((project) => ["--project", project]);

  const smokeExit = runCommand(
    "npm",
    [
      "exec",
      "--yes",
      "--package=@playwright/test",
      "--",
      "playwright",
      "test",
      "--config=playwright.business-flow.config.ts",
      ...projectArgs,
    ],
    {
      ...process.env,
      FLOW_CONTEXT_FILE: paths.latestContextFile,
      UI_SKIP_AUTH_SETUP: "1",
    },
  );

  if (!keepData) {
    await runCleanup({ contextFile: paths.latestContextFile });
  }

  return {
    ok: smokeExit === 0,
    stage: "smoke",
    exitCode: smokeExit,
    keptData: keepData,
  };
}
