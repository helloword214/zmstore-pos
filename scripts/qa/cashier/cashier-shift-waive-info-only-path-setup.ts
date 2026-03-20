import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteCashierShiftDisputeShortagePathArtifacts,
  resetCashierShiftDisputeShortagePathState,
  resolveCashierShiftDisputeShortagePathScenarioContext,
} from "./cashier-shift-dispute-shortage-path-setup";

const DEFAULT_DEVICE_ID = "QA-CASHIER-SHIFT-WAIVE-INFO-ONLY-PATH";
const DEFAULT_PAPER_REF_PREFIX = "QA-CS-ALT-DECISION";
const BASE_DEVICE_ENV_KEY = "QA_CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEVICE_ID";
const BASE_PAPER_REF_ENV_KEY = "QA_CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_PAPER_REF_NO";

type DeleteSummary = Awaited<
  ReturnType<typeof deleteCashierShiftDisputeShortagePathArtifacts>
>;

type CashierShiftDisputeShortagePathScenario = Awaited<
  ReturnType<typeof resolveCashierShiftDisputeShortagePathScenarioContext>
>;

export type CashierShiftWaiveInfoOnlyPathScenarioContext =
  Omit<CashierShiftDisputeShortagePathScenario, "paperRefNo"> & {
    infoOnlyPaperRefNo: string;
    paperRefPrefix: string;
    waivePaperRefNo: string;
  };

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function resolveDeviceId() {
  return (
    process.env.QA_CASHIER_SHIFT_WAIVE_INFO_ONLY_PATH_DEVICE_ID ??
    DEFAULT_DEVICE_ID
  ).trim();
}

function resolvePaperRefPrefix() {
  return (
    process.env.QA_CASHIER_SHIFT_WAIVE_INFO_ONLY_PATH_PAPER_REF_PREFIX ??
    DEFAULT_PAPER_REF_PREFIX
  ).trim();
}

async function withScopedBaseOverrides<T>(callback: () => Promise<T>) {
  const previousDeviceId = process.env[BASE_DEVICE_ENV_KEY];
  const previousPaperRef = process.env[BASE_PAPER_REF_ENV_KEY];

  process.env[BASE_DEVICE_ENV_KEY] = resolveDeviceId();
  process.env[BASE_PAPER_REF_ENV_KEY] = resolvePaperRefPrefix();

  try {
    return await callback();
  } finally {
    if (previousDeviceId == null) {
      delete process.env[BASE_DEVICE_ENV_KEY];
    } else {
      process.env[BASE_DEVICE_ENV_KEY] = previousDeviceId;
    }

    if (previousPaperRef == null) {
      delete process.env[BASE_PAPER_REF_ENV_KEY];
    } else {
      process.env[BASE_PAPER_REF_ENV_KEY] = previousPaperRef;
    }
  }
}

export async function deleteCashierShiftWaiveInfoOnlyPathArtifacts(): Promise<DeleteSummary> {
  return withScopedBaseOverrides(() =>
    deleteCashierShiftDisputeShortagePathArtifacts()
  );
}

export async function resetCashierShiftWaiveInfoOnlyPathState() {
  return withScopedBaseOverrides(() =>
    resetCashierShiftDisputeShortagePathState()
  );
}

export async function resolveCashierShiftWaiveInfoOnlyPathScenarioContext(): Promise<CashierShiftWaiveInfoOnlyPathScenarioContext> {
  return withScopedBaseOverrides(async () => {
    const scenario = await resolveCashierShiftDisputeShortagePathScenarioContext();
    const paperRefPrefix = resolvePaperRefPrefix();

    return {
      ...scenario,
      infoOnlyPaperRefNo: `${paperRefPrefix}-INFO`,
      paperRefPrefix,
      waivePaperRefNo: `${paperRefPrefix}-WAIVE`,
    };
  });
}

async function main() {
  const { deleted } = await resetCashierShiftWaiveInfoOnlyPathState();
  const scenario = await resolveCashierShiftWaiveInfoOnlyPathScenarioContext();

  console.log(
    [
      "Cashier shift waive/info-only path setup is ready.",
      `Manager: ${scenario.managerLabel} [userId=${scenario.manager.id}]`,
      `Cashier: ${scenario.cashierLabel} [userId=${scenario.cashier.id}]`,
      `Device marker: ${scenario.deviceId}`,
      `Opening float: ${scenario.openingFloatLabel}`,
      `Short count: ${scenario.shortageCountLabel}`,
      `Paper ref prefix: ${scenario.paperRefPrefix}`,
      `Info-only paper ref: ${scenario.infoOnlyPaperRefNo}`,
      `Waive paper ref: ${scenario.waivePaperRefNo}`,
      `Manager route: ${scenario.managerRoute}`,
      `Cashier route: ${scenario.cashierRoute}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      "Next manual QA steps:",
      "1. Manager opens the tagged shift in /store/cashier-shifts.",
      "2. Cashier accepts the opening float in /cashier/shift.",
      "3. Cashier submits the printed short count.",
      "4. Manager selects INFO_ONLY or WAIVE, enters the matching printed paper ref, and final-closes the shift.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown cashier waive/info-only path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
