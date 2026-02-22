import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function readJsonSafe(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function toRouteOrNull(value) {
  if (!nonEmpty(value)) return null;
  return String(value).trim();
}

function routeHasValue(value) {
  return nonEmpty(value) && String(value).trim() !== "not-set";
}

function collectUnexpectedTests(suites, carry = [], parentTitle = "") {
  for (const suite of suites ?? []) {
    const suitePrefix = [parentTitle, suite.title].filter(Boolean).join(" > ");

    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = Array.isArray(test.results) ? test.results : [];
        const last = [...results].reverse().find((r) => r?.status);
        const status = String(last?.status ?? "unknown");

        if (["failed", "timedOut", "interrupted"].includes(status)) {
          carry.push({
            file: suite.file ?? "unknown-file",
            title: [suitePrefix, spec.title, test.projectName]
              .filter(Boolean)
              .join(" > "),
            status,
          });
        }
      }
    }

    collectUnexpectedTests(suite.suites, carry, suitePrefix);
  }

  return carry;
}

function collectRunnerErrors(report, limit = 10) {
  const errors = Array.isArray(report?.errors) ? report.errors : [];
  const out = [];

  for (const error of errors) {
    const message = String(error?.message ?? error?.value ?? "").trim();
    if (!message) continue;
    out.push(message.split("\n")[0]);
    if (out.length >= limit) break;
  }

  return out;
}

function readBusinessFlowContext(contextFilePath) {
  const parsed = readJsonSafe(contextFilePath);
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

function toRelative(root, filePath) {
  return path.relative(root, filePath);
}

function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveProjects() {
  const explicit = parseCsv(process.env.UI_PROJECTS);
  if (explicit.length > 0) return explicit;

  const roleToProjects = {
    manager: ["manager-desktop", "manager-mobile"],
    rider: ["rider-desktop", "rider-mobile"],
    cashier: ["cashier-desktop"],
  };

  const rawScope = (process.env.UI_ROLE_SCOPE ?? "manager").trim().toLowerCase();
  const scopes =
    rawScope === "all"
      ? ["manager", "rider", "cashier"]
      : parseCsv(rawScope).map((s) => s.toLowerCase());

  const out = [];
  for (const scope of scopes) {
    const projects = roleToProjects[scope];
    if (!projects) continue;
    out.push(...projects);
  }
  return Array.from(new Set(out));
}

const dryRun = process.argv.includes("--dry-run");
const root = process.cwd();
const stamp = nowStamp();
const selectedProjectsRaw = resolveProjects();
const selectedProjects =
  selectedProjectsRaw.length > 0
    ? selectedProjectsRaw
    : ["manager-desktop", "manager-mobile"];
const projectArgs = selectedProjects.flatMap((project) => ["--project", project]);

const runsDir = path.join(root, "docs/automation/runs");
const incidentsDir = path.join(root, "docs/automation/incidents");
const runDir = path.join(runsDir, stamp);

ensureDir(runDir);
ensureDir(incidentsDir);

const reportJsonPath = path.join(runDir, "playwright-report.json");
const summaryPath = path.join(runDir, "summary.md");
const incidentPath = path.join(incidentsDir, `${stamp}.md`);

const managerCoverageEnabled = selectedProjects.some((project) =>
  project.startsWith("manager-")
);
const businessFlowContextFile = path.join(
  root,
  "test-results/automation/business-flow/context.latest.json"
);
let businessFlowContext = readBusinessFlowContext(businessFlowContextFile);
let businessFlowSetupAttempted = false;
let businessFlowSetupExitCode = null;
let preflightError = null;
let failureStage = null;

const routeSource = {
  checkIn: "not-set",
  remit: "not-set",
  riderList: "not-set",
  cashierShift: "not-set",
};

let checkInRoute = "not-set";
let remitRoute = "not-set";

const explicitCheckIn = toRouteOrNull(process.env.UI_ROUTE_CHECKIN);
const explicitRemit = toRouteOrNull(process.env.UI_ROUTE_REMIT);
const uiRunId = toRouteOrNull(process.env.UI_RUN_ID);

if (explicitCheckIn) {
  checkInRoute = explicitCheckIn;
  routeSource.checkIn = "env:UI_ROUTE_CHECKIN";
} else if (uiRunId) {
  checkInRoute = `/runs/${uiRunId}/rider-checkin`;
  routeSource.checkIn = "env:UI_RUN_ID";
}

if (explicitRemit) {
  remitRoute = explicitRemit;
  routeSource.remit = "env:UI_ROUTE_REMIT";
} else if (uiRunId) {
  remitRoute = `/runs/${uiRunId}/remit`;
  routeSource.remit = "env:UI_RUN_ID";
}

let riderRoute = toRouteOrNull(process.env.UI_ROUTE_RIDER_LIST);
if (riderRoute) routeSource.riderList = "env:UI_ROUTE_RIDER_LIST";

let cashierRoute = toRouteOrNull(process.env.UI_ROUTE_CASHIER_SHIFT);
if (cashierRoute) routeSource.cashierShift = "env:UI_ROUTE_CASHIER_SHIFT";

function applyContextRoutes(context, sourceLabel) {
  const ctxCheckIn = toRouteOrNull(context?.runs?.checkedIn?.routes?.riderCheckin);
  if (!routeHasValue(checkInRoute) && ctxCheckIn) {
    checkInRoute = ctxCheckIn;
    routeSource.checkIn = sourceLabel;
  }

  const ctxRemit = toRouteOrNull(context?.runs?.checkedIn?.routes?.managerRemit);
  if (!routeHasValue(remitRoute) && ctxRemit) {
    remitRoute = ctxRemit;
    routeSource.remit = sourceLabel;
  }

  const ctxRiderList = toRouteOrNull(context?.routes?.riderList);
  if (!riderRoute && ctxRiderList) {
    riderRoute = ctxRiderList;
    routeSource.riderList = sourceLabel;
  }

  const ctxCashierShift = toRouteOrNull(context?.routes?.cashierShift);
  if (!cashierRoute && ctxCashierShift) {
    cashierRoute = ctxCashierShift;
    routeSource.cashierShift = sourceLabel;
  }
}

if (businessFlowContext) {
  applyContextRoutes(businessFlowContext, "business-flow:context.latest");
}

const managerRoutesMissing = () =>
  !routeHasValue(checkInRoute) || !routeHasValue(remitRoute);

if (!dryRun && managerCoverageEnabled && managerRoutesMissing()) {
  businessFlowSetupAttempted = true;
  const setupRun = spawnSync(
    "npm",
    ["run", "automation:flow:setup"],
    { stdio: "inherit", env: process.env }
  );
  businessFlowSetupExitCode = setupRun.status ?? 1;

  if (businessFlowSetupExitCode !== 0) {
    preflightError =
      "Business-flow setup failed while auto-resolving manager routes.";
  } else {
    businessFlowContext = readBusinessFlowContext(businessFlowContextFile);
    if (!businessFlowContext) {
      preflightError =
        "Business-flow setup succeeded but context.latest.json is missing.";
    } else {
      applyContextRoutes(businessFlowContext, "business-flow:setup");
    }
  }
}

if (!riderRoute) {
  riderRoute = "/rider/variances";
  routeSource.riderList = "default";
}

if (!cashierRoute) {
  cashierRoute = "/cashier/shift";
  routeSource.cashierShift = "default";
}

if (!dryRun && managerCoverageEnabled && managerRoutesMissing()) {
  preflightError =
    preflightError ??
    "Manager routes unresolved. Provide UI_ROUTE_CHECKIN/UI_ROUTE_REMIT or allow business-flow setup.";
}

let exitCode = 0;
if (!dryRun) {
  if (preflightError) {
    exitCode = 1;
    failureStage = "preflight";
  } else {
    const testEnv = {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportJsonPath,
      UI_ROUTE_RIDER_LIST: riderRoute,
      UI_ROUTE_CASHIER_SHIFT: cashierRoute,
    };

    if (routeHasValue(checkInRoute)) {
      testEnv.UI_ROUTE_CHECKIN = checkInRoute;
    }
    if (routeHasValue(remitRoute)) {
      testEnv.UI_ROUTE_REMIT = remitRoute;
    }

    const run = spawnSync(
      "npm",
      [
        "run",
        "ui:test",
        "--",
        ...projectArgs,
        "--reporter=line,json",
        "--output",
        "test-results/ui/artifacts",
      ],
      { stdio: "inherit", env: testEnv },
    );
    exitCode = run.status ?? 1;
    if (exitCode !== 0) {
      failureStage = "ui-test";
    }
  }
}

const report = readJsonSafe(reportJsonPath);
const stats = report?.stats ?? {};
const unexpected = Number(stats.unexpected ?? 0);
const expected = Number(stats.expected ?? 0);
const skipped = Number(stats.skipped ?? 0);
const flaky = Number(stats.flaky ?? 0);
const durationMs = Number(stats.duration ?? 0);
const failures = collectUnexpectedTests(report?.suites ?? []).slice(0, 10);
const runnerErrors = collectRunnerErrors(report, 10);

if (!dryRun && exitCode !== 0 && !failureStage) {
  failureStage = runnerErrors.length > 0 ? "runner" : "ui-test";
}

const summaryLines = [
  `# UI Automation Run — ${stamp}`,
  "",
  `- Status: ${dryRun ? "DRY_RUN" : exitCode === 0 ? "PASS" : "FAIL"}`,
  `- Timestamp: ${new Date().toISOString()}`,
  `- Base URL: ${process.env.UI_BASE_URL ?? "http://127.0.0.1:4173"}`,
  `- Role scope: ${process.env.UI_ROLE_SCOPE ?? "manager"}`,
  `- Projects: ${selectedProjects.length ? selectedProjects.join(", ") : "none"}`,
  `- Failure stage: ${dryRun ? "n/a" : failureStage ?? "none"}`,
  `- Check-in route: ${checkInRoute}`,
  `- Check-in route source: ${routeSource.checkIn}`,
  `- Remit route: ${remitRoute}`,
  `- Remit route source: ${routeSource.remit}`,
  `- Rider list route: ${riderRoute}`,
  `- Rider list route source: ${routeSource.riderList}`,
  `- Cashier shift route: ${cashierRoute}`,
  `- Cashier shift route source: ${routeSource.cashierShift}`,
  `- Business-flow context file: ${toRelative(root, businessFlowContextFile)}`,
  `- Business-flow context loaded: ${businessFlowContext ? "yes" : "no"}`,
  `- Business-flow setup attempted: ${businessFlowSetupAttempted ? "yes" : "no"}`,
  `- Business-flow setup exit code: ${businessFlowSetupExitCode ?? "n/a"}`,
  `- Preflight note: ${preflightError ?? "none"}`,
  "",
  "## Stats",
  "",
  `- Expected: ${expected}`,
  `- Unexpected: ${unexpected}`,
  `- Skipped: ${skipped}`,
  `- Flaky: ${flaky}`,
  `- Duration (ms): ${durationMs}`,
  "",
  "## Top Failures",
  "",
];

if (failures.length === 0) {
  if (runnerErrors.length === 0) {
    summaryLines.push("- None");
  } else {
    for (const message of runnerErrors) {
      summaryLines.push(`- [runner] ${message}`);
    }
  }
} else {
  for (const f of failures) {
    summaryLines.push(`- [${f.status}] ${f.title} (${f.file})`);
  }
}

summaryLines.push("");
summaryLines.push("## Artifact Paths");
summaryLines.push("");
summaryLines.push(`- JSON report: \`${path.relative(root, reportJsonPath)}\``);
summaryLines.push(`- Summary: \`${path.relative(root, summaryPath)}\``);
summaryLines.push(
  `- Playwright output: \`test-results/ui/artifacts\` (shared output dir)`,
);
summaryLines.push("");

writeFileSync(summaryPath, summaryLines.join("\n"), "utf8");

if (!dryRun && exitCode !== 0) {
  const classification =
    failureStage === "preflight"
      ? "AUTOMATION_SETUP_FAILURE"
      : runnerErrors.length > 0 && unexpected === 0
        ? "AUTOMATION_INFRA_FAILURE"
        : "UI_REGRESSION";

  const incidentLines = [
    `# UI Incident — ${stamp}`,
    "",
    "## Trigger",
    "",
    "- Source: `npm run ui:cycle`",
    `- Classification: \`${classification}\``,
    `- Failure stage: ${failureStage ?? "unknown"}`,
    `- Unexpected tests: ${unexpected}`,
    "",
    "## Failure Samples",
    "",
  ];

  if (failures.length > 0) {
    for (const f of failures) {
      incidentLines.push(`- [${f.status}] ${f.title} (${f.file})`);
    }
  } else if (runnerErrors.length > 0) {
    for (const message of runnerErrors) {
      incidentLines.push(`- [runner] ${message}`);
    }
  } else {
    incidentLines.push("- Failure detail unavailable from JSON report.");
  }

  incidentLines.push("");
  incidentLines.push("## Follow-up");
  incidentLines.push("");
  incidentLines.push("- Reproduce failing case locally.");
  incidentLines.push("- Apply targeted UI patch only.");
  incidentLines.push("- Re-run `npm run ui:cycle` and close incident if PASS.");
  incidentLines.push("");
  incidentLines.push(`Linked run summary: \`${path.relative(root, summaryPath)}\``);

  writeFileSync(incidentPath, incidentLines.join("\n"), "utf8");
}

if (dryRun) {
  // Keep dry-run success so teams can validate wiring without browsers.
  process.exit(0);
}

process.exit(exitCode);
