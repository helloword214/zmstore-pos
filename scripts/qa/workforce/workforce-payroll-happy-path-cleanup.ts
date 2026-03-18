import "dotenv/config";

import { db } from "~/utils/db.server";
import {
  WORKFORCE_PAYROLL_HAPPY_PATH_ATTENDANCE_NOTE,
  WORKFORCE_PAYROLL_HAPPY_PATH_PAY_PROFILE_NOTE,
  WORKFORCE_PAYROLL_HAPPY_PATH_RUN_NOTE,
  WORKFORCE_PAYROLL_HAPPY_PATH_STATUTORY_NOTE,
} from "./workforce-payroll-happy-path-scenario";

async function main() {
  const taggedRuns = await db.payrollRun.findMany({
    where: {
      note: WORKFORCE_PAYROLL_HAPPY_PATH_RUN_NOTE,
    },
    select: {
      id: true,
      status: true,
      payrollRunLines: {
        select: {
          chargeDeductionAmount: true,
        },
      },
    },
    orderBy: [{ id: "asc" }],
  });

  const deletableRunIds: number[] = [];
  const blockedRunIds: number[] = [];

  for (const run of taggedRuns) {
    const hasChargeDeductions = run.payrollRunLines.some(
      (line) => Number(line.chargeDeductionAmount) > 0.009,
    );
    if (hasChargeDeductions) {
      blockedRunIds.push(run.id);
      continue;
    }
    deletableRunIds.push(run.id);
  }

  if (deletableRunIds.length > 0) {
    await db.payrollRun.deleteMany({
      where: {
        id: { in: deletableRunIds },
      },
    });
  }

  if (blockedRunIds.length > 0) {
    console.log(
      [
        "Cleanup stopped before deleting QA setup rows.",
        `Tagged payroll run(s) with charge deductions still exist: ${blockedRunIds.join(", ")}`,
        "Resolve or manually inspect those payroll runs first, then rerun cleanup.",
      ].join("\n"),
    );
    return;
  }

  const deletedAttendance = await db.attendanceDutyResult.deleteMany({
    where: {
      note: WORKFORCE_PAYROLL_HAPPY_PATH_ATTENDANCE_NOTE,
    },
  });

  const deletedStatutory = await db.employeeStatutoryDeductionProfile.deleteMany({
    where: {
      note: WORKFORCE_PAYROLL_HAPPY_PATH_STATUTORY_NOTE,
    },
  });

  const deletedPayProfiles = await db.employeePayProfile.deleteMany({
    where: {
      note: WORKFORCE_PAYROLL_HAPPY_PATH_PAY_PROFILE_NOTE,
    },
  });

  console.log(
    [
      "Workforce payroll happy path cleanup is complete.",
      `Deleted payroll runs: ${deletableRunIds.length}`,
      `Deleted attendance rows: ${deletedAttendance.count}`,
      `Deleted deduction rows: ${deletedStatutory.count}`,
      `Deleted salary rows: ${deletedPayProfiles.count}`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Unknown workforce payroll QA cleanup error.",
  );
  throw error;
});
