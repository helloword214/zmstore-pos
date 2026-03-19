import "dotenv/config";

import { expect, type BrowserContext, type Page } from "@playwright/test";
import {
  getEffectiveEmployeePayProfile,
  getEffectiveEmployeeStatutoryDeductionProfile,
} from "~/services/worker-payroll-policy.server";
import { createUserSession } from "~/utils/auth.server";
import { db } from "~/utils/db.server";
import {
  WORKFORCE_PAYROLL_HAPPY_PATH_ATTENDANCE_NOTE,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR,
  WORKFORCE_PAYROLL_HAPPY_PATH_RUN_NOTE,
  formatScenarioDateInput,
  formatWorkerLabel,
  resolveWorkforcePayrollHappyPathTargetEmployee,
  resolveWorkforcePayrollHappyPathWindow,
} from "../../../scripts/qa/workforce/workforce-payroll-happy-path-scenario";

const DEFAULT_BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_MANAGER_EMAIL = "manager1@local";

export const WORKFORCE_PAYROLL_HAPPY_PATH_ENABLE_ENV =
  "QA_WORKFORCE_PAYROLL_HAPPY_PATH_ENABLE";

type WorkforcePayrollHappyPathScenarioContext = {
  draftNote: string;
  employeeLabel: string;
  expectedBasePayLabel: string;
  expectedGovernmentDeductionsLabel: string;
  payDateInput: string;
  periodEndInput: string;
  periodStartInput: string;
};

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);

function parseCookiePair(setCookieHeader: string) {
  const [cookiePair] = setCookieHeader.split(";");
  const separatorIndex = cookiePair.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error("Invalid auth cookie returned while creating the payroll QA session.");
  }

  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
  };
}

async function resolveScenarioManager(email: string) {
  const manager = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      active: true,
      role: true,
    },
  });

  if (!manager || !manager.active || manager.role !== "STORE_MANAGER") {
    throw new Error(
      `Workforce payroll happy path requires an active STORE_MANAGER account: ${email}`,
    );
  }

  return manager;
}

export function isWorkforcePayrollHappyPathEnabled() {
  return process.env[WORKFORCE_PAYROLL_HAPPY_PATH_ENABLE_ENV] === "1";
}

export function resolveWorkforcePayrollHappyPathBaseURL() {
  return process.env.UI_BASE_URL ?? DEFAULT_BASE_URL;
}

export function resolveWorkforcePayrollHappyPathManagerEmail() {
  return (
    process.env.QA_WORKFORCE_PAYROLL_HAPPY_PATH_MANAGER_EMAIL ??
    process.env.UI_MANAGER_EMAIL ??
    DEFAULT_MANAGER_EMAIL
  )
    .trim()
    .toLowerCase();
}

export async function bootstrapWorkforcePayrollHappyPathSession(
  context: BrowserContext,
) {
  const baseUrl = new URL(resolveWorkforcePayrollHappyPathBaseURL());
  const manager = await resolveScenarioManager(
    resolveWorkforcePayrollHappyPathManagerEmail(),
  );

  const { headers } = await createUserSession(
    new Request(new URL("/login", baseUrl).toString()),
    manager.id,
  );

  const setCookieHeader = headers["Set-Cookie"];
  if (!setCookieHeader) {
    throw new Error("Payroll QA session bootstrap did not return a session cookie.");
  }

  const cookie = parseCookiePair(setCookieHeader);
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: baseUrl.hostname,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
      httpOnly: true,
      secure: baseUrl.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

export async function resetWorkforcePayrollHappyPathDraftState() {
  const taggedRuns = await db.payrollRun.findMany({
    where: {
      note: WORKFORCE_PAYROLL_HAPPY_PATH_RUN_NOTE,
    },
    select: {
      id: true,
      payrollRunLines: {
        select: {
          chargeDeductionAmount: true,
        },
      },
    },
  });

  const blockedRunIds = taggedRuns
    .filter((run) =>
      run.payrollRunLines.some(
        (line) => Number(line.chargeDeductionAmount) > 0.009,
      ),
    )
    .map((run) => run.id);

  if (blockedRunIds.length > 0) {
    throw new Error(
      "Payroll QA reset stopped because tagged runs still have charge deductions. " +
        `Resolve run id(s): ${blockedRunIds.join(", ")} and rerun cleanup first.`,
    );
  }

  if (taggedRuns.length > 0) {
    await db.payrollRun.deleteMany({
      where: {
        id: {
          in: taggedRuns.map((run) => run.id),
        },
      },
    });
  }
}

export async function resolveWorkforcePayrollHappyPathScenarioContext(): Promise<WorkforcePayrollHappyPathScenarioContext> {
  const window = await resolveWorkforcePayrollHappyPathWindow(new Date());
  const worker = await resolveWorkforcePayrollHappyPathTargetEmployee(
    window.periodStart,
  );
  const payProfile = await getEffectiveEmployeePayProfile(
    db,
    worker.id,
    window.periodStart,
  );

  if (!payProfile) {
    throw new Error(
      "Missing workforce payroll pay profile for the happy-path worker. " +
        "Run `npm run qa:workforce:payroll:happy-path:setup` first.",
    );
  }

  const taggedAttendanceCount = await db.attendanceDutyResult.count({
    where: {
      workerId: worker.id,
      note: WORKFORCE_PAYROLL_HAPPY_PATH_ATTENDANCE_NOTE,
      dutyDate: {
        gte: window.periodStart,
        lte: window.periodEnd,
      },
    },
  });

  if (taggedAttendanceCount < 3) {
    throw new Error(
      "Missing tagged attendance rows for the workforce payroll happy path. " +
        "Run `npm run qa:workforce:payroll:happy-path:setup` first.",
    );
  }

  const statutoryProfile = await getEffectiveEmployeeStatutoryDeductionProfile(
    db,
    worker.id,
    window.payDate,
  );

  const dailyRate = Number(payProfile.dailyRate);
  const halfDayFactor = Number(payProfile.halfDayFactor);
  const safeHalfDayFactor = Number.isFinite(halfDayFactor)
    ? halfDayFactor
    : WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR;
  const expectedBasePay = dailyRate * 2 + dailyRate * safeHalfDayFactor;
  const expectedGovernmentDeductions =
    (window.statutoryToggles.sss ? Number(statutoryProfile?.sssAmount ?? 0) : 0) +
    (window.statutoryToggles.philhealth
      ? Number(statutoryProfile?.philhealthAmount ?? 0)
      : 0) +
    (window.statutoryToggles.pagIbig
      ? Number(statutoryProfile?.pagIbigAmount ?? 0)
      : 0);

  return {
    draftNote: WORKFORCE_PAYROLL_HAPPY_PATH_RUN_NOTE,
    employeeLabel: formatWorkerLabel(worker),
    expectedBasePayLabel: peso(expectedBasePay),
    expectedGovernmentDeductionsLabel: peso(expectedGovernmentDeductions),
    payDateInput: formatScenarioDateInput(window.payDate),
    periodEndInput: formatScenarioDateInput(window.periodEnd),
    periodStartInput: formatScenarioDateInput(window.periodStart),
  };
}

export async function openWorkforcePayrollHappyPath(page: Page) {
  const url = new URL(
    "/store/payroll",
    resolveWorkforcePayrollHappyPathBaseURL(),
  ).toString();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForURL((target) => target.pathname === "/store/payroll", {
    timeout: 10_000,
  });
  await expect(page.getByRole("heading", { name: /payroll runs/i })).toBeVisible();
}
