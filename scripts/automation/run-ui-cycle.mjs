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

function toPositiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthy(raw, fallback = false) {
  if (raw == null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseDbTarget(databaseUrl) {
  if (!nonEmpty(databaseUrl)) return null;
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname || "localhost",
      port: Number(parsed.port || "5432"),
    };
  } catch {
    return null;
  }
}

function probeDbPort(databaseUrl) {
  if (!nonEmpty(databaseUrl)) {
    return {
      ok: false,
      detail: "DATABASE_URL is missing",
    };
  }

  const js = `
const net = require("node:net");
const raw = process.argv[1];
let parsed;
try {
  parsed = new URL(raw);
} catch {
  process.stderr.write("invalid DATABASE_URL");
  process.exit(2);
}
const host = parsed.hostname || "localhost";
const port = Number(parsed.port || "5432");
const socket = net.connect({ host, port, timeout: 1200 });
socket.once("connect", () => {
  process.stdout.write(host + ":" + port);
  socket.destroy();
  process.exit(0);
});
socket.once("timeout", () => {
  process.stderr.write("timeout to " + host + ":" + port);
  socket.destroy();
  process.exit(1);
});
socket.once("error", (err) => {
  process.stderr.write(String(err && err.message ? err.message : err));
  socket.destroy();
  process.exit(1);
});
`;

  const probe = spawnSync("node", ["-e", js, databaseUrl], {
    stdio: "pipe",
    encoding: "utf8",
  });

  if ((probe.status ?? 1) === 0) {
    const detail = String(probe.stdout || "").trim() || "tcp probe passed";
    return { ok: true, detail };
  }

  const detail =
    String(probe.stderr || "").trim() ||
    String(probe.stdout || "").trim() ||
    "tcp probe failed";
  return { ok: false, detail };
}

function waitForDbReady() {
  const attempts = toPositiveInt(process.env.UI_DB_PRECHECK_RETRIES, 15);
  const delayMs = toPositiveInt(process.env.UI_DB_PRECHECK_DELAY_MS, 1000);
  let lastDetail = "not checked";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const probe = probeDbPort(process.env.DATABASE_URL);
    lastDetail = probe.detail;
    if (probe.ok) {
      return {
        ok: true,
        attempts: attempt,
        detail: probe.detail,
      };
    }
    if (attempt < attempts) {
      sleepMs(delayMs);
    }
  }

  return {
    ok: false,
    attempts,
    detail: lastDetail,
  };
}

function commandExists(command) {
  const check = spawnSync("which", [command], {
    stdio: "pipe",
    encoding: "utf8",
  });
  return (check.status ?? 1) === 0;
}

function runCommand(command, args) {
  const run = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
  });
  const stdout = String(run.stdout || "").trim();
  const stderr = String(run.stderr || "").trim();
  return {
    ok: (run.status ?? 1) === 0,
    status: run.status ?? 1,
    detail: stderr || stdout || "no output",
  };
}

function attemptLocalDbAutostart(databaseUrl) {
  const target = parseDbTarget(databaseUrl);
  if (!target) {
    return {
      attempted: false,
      ok: false,
      detail: "skipped: invalid DATABASE_URL",
    };
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(target.host)) {
    return {
      attempted: false,
      ok: false,
      detail: `skipped: non-local host (${target.host})`,
    };
  }

  const attempts = [];

  if (process.platform === "darwin" && commandExists("open")) {
    attempts.push({ command: "open", args: ["-a", "Postgres"] });
  }

  if (commandExists("brew")) {
    attempts.push({ command: "brew", args: ["services", "start", "postgresql@15"] });
    attempts.push({ command: "brew", args: ["services", "start", "postgresql"] });
  }

  if (attempts.length === 0) {
    return {
      attempted: false,
      ok: false,
      detail: "skipped: no autostart command available",
    };
  }

  const notes = [];
  for (const candidate of attempts) {
    const label = `${candidate.command} ${candidate.args.join(" ")}`.trim();
    const result = runCommand(candidate.command, candidate.args);
    notes.push(`${label}: ${result.ok ? "ok" : `exit ${result.status}`}`);

    if (result.ok) {
      return {
        attempted: true,
        ok: true,
        detail: notes.join(" | "),
      };
    }
  }

  return {
    attempted: true,
    ok: false,
    detail: notes.join(" | "),
  };
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
const dbAutostartEnabled = isTruthy(process.env.UI_DB_AUTOSTART, true);
let dbPreflightAttempted = false;
let dbPreflightReady = "n/a";
let dbPreflightAttempts = "n/a";
let dbPreflightDetail = "n/a";
let dbAutostartAttempted = "n/a";
let dbAutostartResult = "n/a";
let dbAutostartDetail = "n/a";
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

if (!dryRun) {
  dbPreflightAttempted = true;
  let dbReady = waitForDbReady();
  dbPreflightReady = dbReady.ok ? "yes" : "no";
  dbPreflightAttempts = String(dbReady.attempts);
  dbPreflightDetail = dbReady.detail;

  if (!dbReady.ok && dbAutostartEnabled) {
    const autostart = attemptLocalDbAutostart(process.env.DATABASE_URL);
    dbAutostartAttempted = autostart.attempted ? "yes" : "no";
    dbAutostartResult = autostart.ok ? "success" : "failed";
    dbAutostartDetail = autostart.detail;

    if (autostart.attempted && autostart.ok) {
      sleepMs(1200);
      dbReady = waitForDbReady();
      dbPreflightReady = dbReady.ok ? "yes" : "no";
      dbPreflightAttempts = String(dbReady.attempts);
      dbPreflightDetail = dbReady.detail;
    }
  } else {
    dbAutostartAttempted = "no";
    dbAutostartResult = dbAutostartEnabled ? "skipped" : "disabled";
    dbAutostartDetail = dbAutostartEnabled
      ? "skipped: initial preflight passed"
      : "disabled via UI_DB_AUTOSTART=0";
  }

  if (!dbReady.ok) {
    preflightError =
      dbAutostartEnabled && dbAutostartAttempted === "yes"
        ? `DB_AUTOSTART_FAILED after ${dbReady.attempts} attempts (${dbReady.detail}). Autostart detail: ${dbAutostartDetail}`
        : `DB_NOT_READY after ${dbReady.attempts} attempts (${dbReady.detail}). Start PostgreSQL and retry.`;
  }
}

const managerRoutesMissing = () =>
  !routeHasValue(checkInRoute) || !routeHasValue(remitRoute);

if (!dryRun && !preflightError && managerCoverageEnabled && managerRoutesMissing()) {
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
  `- DB preflight attempted: ${dbPreflightAttempted ? "yes" : "no"}`,
  `- DB preflight ready: ${dbPreflightReady}`,
  `- DB preflight attempts: ${dbPreflightAttempts}`,
  `- DB preflight detail: ${dbPreflightDetail}`,
  `- DB autostart enabled: ${dbAutostartEnabled ? "yes" : "no"}`,
  `- DB autostart attempted: ${dbAutostartAttempted}`,
  `- DB autostart result: ${dbAutostartResult}`,
  `- DB autostart detail: ${dbAutostartDetail}`,
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
