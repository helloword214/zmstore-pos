import { readFileSync } from "node:fs";
import path from "node:path";

type RunRoutes = {
  riderCheckin?: string;
  managerRemit?: string;
  cashierRunRemit?: string;
  summary?: string;
};

type RunContext = {
  id: number;
  runCode: string;
  status: string;
  routes: RunRoutes;
};

export type BusinessFlowContext = {
  createdAt: string;
  traceId: string;
  runs: {
    checkedIn: RunContext;
    closed: RunContext;
  };
  routes: {
    riderList?: string;
    cashierShift?: string;
  };
};

const DEFAULT_CONTEXT_FILE = path.resolve(
  "test-results/automation/business-flow/context.latest.json",
);

export function loadBusinessFlowContext(): BusinessFlowContext {
  const file = process.env.FLOW_CONTEXT_FILE
    ? path.resolve(process.env.FLOW_CONTEXT_FILE)
    : DEFAULT_CONTEXT_FILE;

  let parsed: BusinessFlowContext;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as BusinessFlowContext;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing or invalid business flow context (${file}). Run npm run automation:flow:setup first. ${detail}`,
    );
  }

  if (!parsed?.runs?.checkedIn?.id || !parsed?.runs?.closed?.id) {
    throw new Error(
      `Incomplete business flow context (${file}). Expected checkedIn and closed run IDs.`,
    );
  }

  return parsed;
}
