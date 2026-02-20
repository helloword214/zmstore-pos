import path from "node:path";
import process from "node:process";

export const ENGINE_NAME = "business-flow-engine";
export const ENGINE_VERSION = "1.0.0";
export const DEFAULT_TAG_PREFIX = "AUTO-BFLOW";

export function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function shortToken(length = 6) {
  const raw = Math.random().toString(36).replace(/[^a-z0-9]/gi, "");
  return raw.slice(0, length).padEnd(length, "0");
}

export function resolveEnginePaths({ root = process.cwd(), stamp = nowStamp() } = {}) {
  const docsRoot = path.join(root, "docs", "automation", "business-flow");
  const runDir = path.join(docsRoot, "runs", stamp);
  const testResultsRoot = path.join(root, "test-results", "automation", "business-flow");

  return {
    root,
    stamp,
    docsRoot,
    runsDir: path.join(docsRoot, "runs"),
    incidentsDir: path.join(docsRoot, "incidents"),
    runDir,
    runContextFile: path.join(runDir, "context.json"),
    runSummaryFile: path.join(runDir, "summary.md"),
    latestContextFile: path.join(testResultsRoot, "context.latest.json"),
    latestSummaryFile: path.join(testResultsRoot, "summary.latest.md"),
    smokeReportFile: path.join(testResultsRoot, "smoke.result.json"),
  };
}
