import "dotenv/config";

import {
  AttendanceDayType,
  AttendanceLateFlag,
  AttendanceResult,
  AttendanceWorkContext,
} from "@prisma/client";
import { recordWorkerAttendanceDutyResult } from "~/services/worker-attendance-duty-result.server";
import {
  getEffectiveEmployeePayProfile,
  getEffectiveEmployeeStatutoryDeductionProfile,
  upsertEmployeePayProfile,
  upsertEmployeeStatutoryDeductionProfile,
} from "~/services/worker-payroll-policy.server";
import { db } from "~/utils/db.server";
import {
  WORKFORCE_PAYROLL_HAPPY_PATH_ATTENDANCE_NOTE,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_DAILY_RATE,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PAG_IBIG_AMOUNT,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PHILHEALTH_AMOUNT,
  WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_SSS_AMOUNT,
  WORKFORCE_PAYROLL_HAPPY_PATH_PAY_PROFILE_NOTE,
  WORKFORCE_PAYROLL_HAPPY_PATH_QA_MARKER,
  WORKFORCE_PAYROLL_HAPPY_PATH_RUN_NOTE,
  WORKFORCE_PAYROLL_HAPPY_PATH_STATUTORY_NOTE,
  formatScenarioDateInput,
  formatScenarioDateLabel,
  formatWorkerLabel,
  resolveWorkforcePayrollHappyPathDutyDates,
  resolveWorkforcePayrollHappyPathTargetEmployee,
  resolveWorkforcePayrollHappyPathWindow,
} from "./workforce-payroll-happy-path-scenario";

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);

async function main() {
  const window = await resolveWorkforcePayrollHappyPathWindow(new Date());
  const worker = await resolveWorkforcePayrollHappyPathTargetEmployee(
    window.periodStart,
  );

  let payProfile = await getEffectiveEmployeePayProfile(
    db,
    worker.id,
    window.periodStart,
  );
  let createdPayProfile = false;

  if (!payProfile) {
    await upsertEmployeePayProfile({
      employeeId: worker.id,
      dailyRate: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_DAILY_RATE,
      halfDayFactor: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_HALF_DAY_FACTOR,
      effectiveFrom: window.periodStart,
      effectiveTo: null,
      note: WORKFORCE_PAYROLL_HAPPY_PATH_PAY_PROFILE_NOTE,
      actorUserId: null,
    });
    createdPayProfile = true;
    payProfile = await getEffectiveEmployeePayProfile(
      db,
      worker.id,
      window.periodStart,
    );
  }

  if (!payProfile) {
    throw new Error("Failed to resolve an active daily salary row for the QA worker.");
  }

  let statutoryProfile = await getEffectiveEmployeeStatutoryDeductionProfile(
    db,
    worker.id,
    window.payDate,
  );
  let createdStatutoryProfile = false;

  if (!statutoryProfile) {
    await upsertEmployeeStatutoryDeductionProfile({
      employeeId: worker.id,
      sssAmount: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_SSS_AMOUNT,
      philhealthAmount: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PHILHEALTH_AMOUNT,
      pagIbigAmount: WORKFORCE_PAYROLL_HAPPY_PATH_DEFAULT_PAG_IBIG_AMOUNT,
      effectiveFrom: window.periodStart,
      effectiveTo: null,
      note: WORKFORCE_PAYROLL_HAPPY_PATH_STATUTORY_NOTE,
      actorUserId: null,
    });
    createdStatutoryProfile = true;
    statutoryProfile = await getEffectiveEmployeeStatutoryDeductionProfile(
      db,
      worker.id,
      window.payDate,
    );
  }

  const dutyDates = await resolveWorkforcePayrollHappyPathDutyDates({
    workerId: worker.id,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    requiredCount: 3,
  });

  const attendancePattern = [
    AttendanceResult.WHOLE_DAY,
    AttendanceResult.WHOLE_DAY,
    AttendanceResult.HALF_DAY,
  ] as const;

  for (const [index, dutyDate] of dutyDates.entries()) {
    await recordWorkerAttendanceDutyResult({
      workerId: worker.id,
      dutyDate,
      dayType: AttendanceDayType.WORK_DAY,
      attendanceResult: attendancePattern[index] ?? AttendanceResult.WHOLE_DAY,
      workContext: AttendanceWorkContext.REGULAR,
      lateFlag: AttendanceLateFlag.NO,
      note: WORKFORCE_PAYROLL_HAPPY_PATH_ATTENDANCE_NOTE,
      recordedById: null,
    });
  }

  const dailyRate = Number(payProfile.dailyRate);
  const halfDayFactor = Number(payProfile.halfDayFactor);
  const expectedBasePay =
    dailyRate * 2 + dailyRate * (Number.isFinite(halfDayFactor) ? halfDayFactor : 0.5);
  const statutoryTotal =
    Number(statutoryProfile?.sssAmount ?? 0) +
    Number(statutoryProfile?.philhealthAmount ?? 0) +
    Number(statutoryProfile?.pagIbigAmount ?? 0);

  const lines = [
    "Workforce payroll happy path setup is ready.",
    `Employee: ${formatWorkerLabel(worker)} [employeeId=${worker.id}]`,
    `Cutoff: ${formatScenarioDateLabel(window.periodStart)} to ${formatScenarioDateLabel(
      window.periodEnd,
    )}`,
    `Pay date: ${formatScenarioDateLabel(window.payDate)}`,
    `Pay frequency: ${window.payFrequency}`,
    `Draft note marker: ${WORKFORCE_PAYROLL_HAPPY_PATH_RUN_NOTE}`,
    `Attendance notes: ${dutyDates
      .map(
        (date, index) =>
          `${formatScenarioDateInput(date)}=${attendancePattern[index]}`,
      )
      .join(", ")}`,
    `Salary row: ${createdPayProfile ? "created" : "existing"} at ${peso(dailyRate)} per day`,
    `Half-day factor: ${halfDayFactor}`,
    `Expected base attendance pay after rebuild: ${peso(expectedBasePay)}`,
    `Statutory row: ${
      createdStatutoryProfile ? "created" : "existing"
    } total ${peso(statutoryTotal)}`,
    `Policy deduction toggles: SSS=${window.statutoryToggles.sss ? "ON" : "OFF"}, PhilHealth=${
      window.statutoryToggles.philhealth ? "ON" : "OFF"
    }, Pag-IBIG=${window.statutoryToggles.pagIbig ? "ON" : "OFF"}`,
    "Next manual QA steps:",
    `1. Open /store/payroll`,
    `2. Create a draft for ${formatScenarioDateInput(window.periodStart)} to ${formatScenarioDateInput(
      window.periodEnd,
    )} with pay date ${formatScenarioDateInput(window.payDate)}`,
    `3. Paste the exact note marker: ${WORKFORCE_PAYROLL_HAPPY_PATH_QA_MARKER}`,
    "4. Rebuild payroll lines and verify the rider appears with positive gross pay",
  ];

  if (!window.statutoryToggles.sss &&
      !window.statutoryToggles.philhealth &&
      !window.statutoryToggles.pagIbig) {
    lines.push(
      "Note: statutory rows are ready, but the current payroll policy has all deduction toggles OFF, so line deductions will stay zero unless you enable them in payroll policy first.",
    );
  }

  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Unknown workforce payroll QA setup error.",
  );
  throw error;
});
