import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryRiderAcceptancePathArtifacts,
  resetDeliveryRiderAcceptancePathState,
  resolveDeliveryRiderAcceptancePathScenarioContext,
} from "./delivery-rider-acceptance-path-setup";

type DeleteSummary = Awaited<
  ReturnType<typeof deleteDeliveryRiderAcceptancePathArtifacts>
>;

type RiderAcceptanceScenario = Awaited<
  ReturnType<typeof resolveDeliveryRiderAcceptancePathScenarioContext>
>;

export type DeliveryFinalSettlementGatingScenarioContext =
  RiderAcceptanceScenario & {
    settledListingRoute: string;
    settlementRoute: string;
  };

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

async function seedAcceptedVariance(scenario: RiderAcceptanceScenario) {
  const variance = await db.riderRunVariance.findUnique({
    where: { id: scenario.varianceId },
    select: {
      id: true,
      resolution: true,
      status: true,
    },
  });

  if (!variance) {
    throw new Error(
      `Missing rider variance #${scenario.varianceId} for delivery final-settlement setup.`,
    );
  }

  if (variance.resolution !== "CHARGE_RIDER") {
    throw new Error(
      `Delivery final-settlement gating requires CHARGE_RIDER resolution on variance #${scenario.varianceId}. Found: ${variance.resolution ?? "null"}`,
    );
  }

  const riderCharge = await db.riderCharge.findUnique({
    where: { varianceId: scenario.varianceId },
    select: { id: true },
  });

  if (!riderCharge) {
    throw new Error(
      `Missing RiderCharge for variance #${scenario.varianceId} during delivery final-settlement setup.`,
    );
  }

  if (variance.status !== "RIDER_ACCEPTED") {
    await db.riderRunVariance.update({
      where: { id: scenario.varianceId },
      data: {
        resolution: "CHARGE_RIDER",
        riderAcceptedAt: new Date(),
        riderAcceptedById: scenario.rider.id,
        status: "RIDER_ACCEPTED",
      },
    });
  }
}

export async function deleteDeliveryFinalSettlementGatingArtifacts(): Promise<DeleteSummary> {
  return deleteDeliveryRiderAcceptancePathArtifacts();
}

export async function resetDeliveryFinalSettlementGatingState() {
  const deleted = await deleteDeliveryFinalSettlementGatingArtifacts();
  await resetDeliveryRiderAcceptancePathState();
  const scenario = await resolveDeliveryRiderAcceptancePathScenarioContext();
  await seedAcceptedVariance(scenario);

  return { deleted };
}

export async function resolveDeliveryFinalSettlementGatingScenarioContext(): Promise<DeliveryFinalSettlementGatingScenarioContext> {
  const scenario = await resolveDeliveryRiderAcceptancePathScenarioContext();

  return {
    ...scenario,
    settledListingRoute: `/cashier/delivery?settled=1&runId=${scenario.closedRun.id}`,
    settlementRoute:
      scenario.remitOrder.runHubRoute ?? `/cashier/delivery/${scenario.closedRun.id}`,
  };
}

async function main() {
  const { deleted } = await resetDeliveryFinalSettlementGatingState();
  const scenario = await resolveDeliveryFinalSettlementGatingScenarioContext();

  console.log(
    [
      "Delivery final settlement gating setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Closed run code: ${scenario.closedRun.runCode}`,
      `Variance ref: #${scenario.varianceId}`,
      `Settlement route: ${scenario.settlementRoute}`,
      `Settled listing route: ${scenario.settledListingRoute}`,
      `Tagged cashier shift device: ${scenario.cashierShiftDeviceId}`,
      `Cashier storage state: ${scenario.cashierStateFilePath}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      `Deleted previous tagged runs: ${deleted.runIds.length}`,
      `Deleted previous tagged orders: ${deleted.orderIds.length}`,
      "Next manual QA steps:",
      "1. Open the printed settlement route as CASHIER.",
      "2. Confirm the page shows the accepted shortage and enabled Finalize run settlement action.",
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
          : "Unknown delivery final-settlement gating setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
