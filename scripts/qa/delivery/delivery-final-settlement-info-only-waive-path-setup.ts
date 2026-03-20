import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryManagerShortageWaiveInfoOnlyPathArtifacts,
  resetDeliveryManagerShortageWaiveInfoOnlyPathState,
  resolveDeliveryManagerShortageWaiveInfoOnlyPathScenarioContext,
} from "./delivery-manager-shortage-waive-info-only-path-setup";

type DeleteSummary = Awaited<
  ReturnType<typeof deleteDeliveryManagerShortageWaiveInfoOnlyPathArtifacts>
>;

type DeliveryManagerShortageWaiveInfoOnlyPathScenario = Awaited<
  ReturnType<typeof resolveDeliveryManagerShortageWaiveInfoOnlyPathScenarioContext>
>;

export type DeliveryFinalSettlementInfoOnlyWaiveResolution =
  | "INFO_ONLY"
  | "WAIVE";

export type DeliveryFinalSettlementInfoOnlyWaivePathScenarioContext =
  DeliveryManagerShortageWaiveInfoOnlyPathScenario & {
    defaultResolution: DeliveryFinalSettlementInfoOnlyWaiveResolution;
    settledListingRoute: string;
    settlementRoute: string;
  };

const DEFAULT_RESOLUTION: DeliveryFinalSettlementInfoOnlyWaiveResolution =
  "INFO_ONLY";

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

export function resolveDeliveryFinalSettlementInfoOnlyWaivePathResolution() {
  const raw = String(
    process.env.QA_DELIVERY_FINAL_SETTLEMENT_INFO_ONLY_WAIVE_PATH_RESOLUTION ??
      DEFAULT_RESOLUTION,
  )
    .trim()
    .toUpperCase();

  if (raw === "INFO_ONLY" || raw === "WAIVE") {
    return raw as DeliveryFinalSettlementInfoOnlyWaiveResolution;
  }

  throw new Error(
    `Unsupported delivery final-settlement resolution: ${raw}. Expected INFO_ONLY or WAIVE.`,
  );
}

function resolveDecisionNote(
  scenario: DeliveryManagerShortageWaiveInfoOnlyPathScenario,
  resolution: DeliveryFinalSettlementInfoOnlyWaiveResolution,
) {
  return resolution === "INFO_ONLY"
    ? scenario.infoOnlyDecisionNote
    : scenario.waiveDecisionNote;
}

async function seedResolvedVariance(
  scenario: DeliveryManagerShortageWaiveInfoOnlyPathScenario,
  resolution: DeliveryFinalSettlementInfoOnlyWaiveResolution,
) {
  const variance = await db.riderRunVariance.findUnique({
    where: { id: scenario.varianceId },
    select: {
      id: true,
      runId: true,
    },
  });

  if (!variance) {
    throw new Error(
      `Missing rider variance #${scenario.varianceId} for delivery final-settlement alternate setup.`,
    );
  }

  await db.$transaction(async (tx) => {
    await tx.riderCharge.deleteMany({
      where: {
        runId: variance.runId,
      },
    });

    await tx.riderRunVariance.update({
      where: { id: variance.id },
      data: {
        status: resolution === "INFO_ONLY" ? "MANAGER_APPROVED" : "WAIVED",
        resolution,
        note: resolveDecisionNote(scenario, resolution),
        managerApprovedAt: new Date(),
        managerApprovedById: scenario.manager.id,
        riderAcceptedAt: null,
        riderAcceptedById: null,
        resolvedAt: null,
      },
    });
  });
}

export async function deleteDeliveryFinalSettlementInfoOnlyWaivePathArtifacts(): Promise<DeleteSummary> {
  return deleteDeliveryManagerShortageWaiveInfoOnlyPathArtifacts();
}

export async function resetDeliveryFinalSettlementInfoOnlyWaivePathState(
  resolution = resolveDeliveryFinalSettlementInfoOnlyWaivePathResolution(),
) {
  const { deleted } = await resetDeliveryManagerShortageWaiveInfoOnlyPathState();
  const scenario =
    await resolveDeliveryManagerShortageWaiveInfoOnlyPathScenarioContext();

  await seedResolvedVariance(scenario, resolution);

  return {
    deleted,
    resolution,
  };
}

export async function resolveDeliveryFinalSettlementInfoOnlyWaivePathScenarioContext(): Promise<DeliveryFinalSettlementInfoOnlyWaivePathScenarioContext> {
  const scenario =
    await resolveDeliveryManagerShortageWaiveInfoOnlyPathScenarioContext();

  return {
    ...scenario,
    defaultResolution:
      resolveDeliveryFinalSettlementInfoOnlyWaivePathResolution(),
    settledListingRoute: `/cashier/delivery?settled=1&runId=${scenario.closedRun.id}`,
    settlementRoute:
      scenario.remitOrder.runHubRoute ?? `/cashier/delivery/${scenario.closedRun.id}`,
  };
}

async function main() {
  const resolution = resolveDeliveryFinalSettlementInfoOnlyWaivePathResolution();
  const { deleted } =
    await resetDeliveryFinalSettlementInfoOnlyWaivePathState(resolution);
  const scenario =
    await resolveDeliveryFinalSettlementInfoOnlyWaivePathScenarioContext();

  console.log(
    [
      "Delivery final settlement info-only/waive path setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Resolution: ${resolution}`,
      `Closed run code: ${scenario.closedRun.runCode}`,
      `Variance ref: #${scenario.varianceId}`,
      `Settlement route: ${scenario.settlementRoute}`,
      `Settled listing route: ${scenario.settledListingRoute}`,
      `Cashier storage state: ${scenario.cashierStateFilePath}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      `Deleted previous tagged runs: ${deleted.runIds.length}`,
      `Deleted previous tagged orders: ${deleted.orderIds.length}`,
      "Next manual QA steps:",
      "1. Open the printed settlement route as CASHIER.",
      "2. Confirm the run shows the manager-cleared shortage state with Finalize run settlement enabled.",
      "3. Click Finalize run settlement and confirm redirect to the printed settled listing route.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery final-settlement info-only/waive setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
