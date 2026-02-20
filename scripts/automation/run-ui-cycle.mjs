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

function resolveRoute(envKey, fallbackPath) {
  if (process.env[envKey]) return process.env[envKey];
  if (process.env.UI_RUN_ID) return fallbackPath(process.env.UI_RUN_ID);
  return "not-set";
}

const dryRun = process.argv.includes("--dry-run");
const root = process.cwd();
const stamp = nowStamp();

const runsDir = path.join(root, "docs/automation/runs");
const incidentsDir = path.join(root, "docs/automation/incidents");
const runDir = path.join(runsDir, stamp);

ensureDir(runDir);
ensureDir(incidentsDir);

const reportJsonPath = path.join(runDir, "playwright-report.json");
const summaryPath = path.join(runDir, "summary.md");
const incidentPath = path.join(incidentsDir, `${stamp}.md`);

let exitCode = 0;
if (!dryRun) {
  const run = spawnSync(
    "npm",
    [
      "run",
      "ui:test",
      "--",
      `--reporter=line,json=${reportJsonPath}`,
      "--output",
      "test-results/ui/artifacts",
    ],
    { stdio: "inherit", env: process.env },
  );
  exitCode = run.status ?? 1;
}

const report = readJsonSafe(reportJsonPath);
const stats = report?.stats ?? {};
const unexpected = Number(stats.unexpected ?? 0);
const expected = Number(stats.expected ?? 0);
const skipped = Number(stats.skipped ?? 0);
const flaky = Number(stats.flaky ?? 0);
const durationMs = Number(stats.duration ?? 0);
const failures = collectUnexpectedTests(report?.suites ?? []).slice(0, 10);

const checkInRoute = resolveRoute("UI_ROUTE_CHECKIN", (runId) => {
  return `/runs/${runId}/rider-checkin`;
});
const remitRoute = resolveRoute("UI_ROUTE_REMIT", (runId) => {
  return `/runs/${runId}/remit`;
});

const summaryLines = [
  `# UI Automation Run — ${stamp}`,
  "",
  `- Status: ${dryRun ? "DRY_RUN" : exitCode === 0 ? "PASS" : "FAIL"}`,
  `- Timestamp: ${new Date().toISOString()}`,
  `- Base URL: ${process.env.UI_BASE_URL ?? "http://127.0.0.1:4173"}`,
  `- Check-in route: ${checkInRoute}`,
  `- Remit route: ${remitRoute}`,
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
  summaryLines.push("- None");
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
  const incidentLines = [
    `# UI Incident — ${stamp}`,
    "",
    "## Trigger",
    "",
    "- Source: `npm run ui:cycle`",
    "- Classification: `UI_REGRESSION`",
    `- Unexpected tests: ${unexpected}`,
    "",
    "## Failure Samples",
    "",
  ];

  if (failures.length === 0) {
    incidentLines.push("- Failure detail unavailable from JSON report.");
  } else {
    for (const f of failures) {
      incidentLines.push(`- [${f.status}] ${f.title} (${f.file})`);
    }
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

