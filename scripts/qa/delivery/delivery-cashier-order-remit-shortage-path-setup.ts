import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "~/utils/db.server";
import {
  deleteDeliveryCashierOrderRemitPostingHappyPathArtifacts,
  resetDeliveryCashierOrderRemitPostingHappyPathState,
  resolveDeliveryCashierOrderRemitPostingHappyPathCashierEmail,
  resolveDeliveryCashierOrderRemitPostingHappyPathCashierStateFilePath,
  resolveDeliveryCashierOrderRemitPostingHappyPathDeviceId,
  resolveDeliveryCashierOrderRemitPostingHappyPathScenarioContext,
} from "./delivery-cashier-order-remit-posting-happy-path-setup";

type DeleteSummary = Awaited<
  ReturnType<typeof deleteDeliveryCashierOrderRemitPostingHappyPathArtifacts>
>;

type HappyPathScenarioContext = Awaited<
  ReturnType<
    typeof resolveDeliveryCashierOrderRemitPostingHappyPathScenarioContext
  >
>;

type ShortageAmounts = {
  shortageCashInput: string;
  shortageCashLabel: string;
  shortageAmountInput: string;
  shortageAmountLabel: string;
};

export type DeliveryCashierOrderRemitShortagePathScenarioContext =
  HappyPathScenarioContext & {
    exactCashInput: string;
    exactCashLabel: string;
  } & ShortageAmounts;

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function peso(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);
}

function computeShortageAmounts(exactCash: number): ShortageAmounts {
  if (!Number.isFinite(exactCash) || exactCash <= 0.01) {
    throw new Error(
      `Delivery cashier-remit shortage path requires a positive exact cash total. Received: ${exactCash}`,
    );
  }

  const preferredShortage =
    exactCash >= 100
      ? 100
      : exactCash >= 20
      ? 20
      : exactCash >= 5
      ? 5
      : exactCash >= 1
      ? 1
      : 0.01;

  const cappedShortage = Number(
    Math.min(preferredShortage, Number((exactCash - 0.01).toFixed(2))).toFixed(2),
  );
  const shortageCash = Number((exactCash - cappedShortage).toFixed(2));

  if (!(cappedShortage > 0) || !(shortageCash >= 0) || !(shortageCash < exactCash)) {
    throw new Error(
      `Could not compute a valid shortage amount for total ${exactCash}.`,
    );
  }

  return {
    shortageCashInput: shortageCash.toFixed(2),
    shortageCashLabel: peso(shortageCash),
    shortageAmountInput: cappedShortage.toFixed(2),
    shortageAmountLabel: peso(cappedShortage),
  };
}

export function resolveDeliveryCashierOrderRemitShortagePathCashierEmail() {
  return resolveDeliveryCashierOrderRemitPostingHappyPathCashierEmail();
}

export function resolveDeliveryCashierOrderRemitShortagePathDeviceId() {
  return resolveDeliveryCashierOrderRemitPostingHappyPathDeviceId();
}

export function resolveDeliveryCashierOrderRemitShortagePathCashierStateFilePath() {
  return resolveDeliveryCashierOrderRemitPostingHappyPathCashierStateFilePath();
}

export async function deleteDeliveryCashierOrderRemitShortagePathArtifacts(): Promise<DeleteSummary> {
  return deleteDeliveryCashierOrderRemitPostingHappyPathArtifacts();
}

export async function resetDeliveryCashierOrderRemitShortagePathState() {
  return resetDeliveryCashierOrderRemitPostingHappyPathState();
}

export async function resolveDeliveryCashierOrderRemitShortagePathScenarioContext(): Promise<DeliveryCashierOrderRemitShortagePathScenarioContext> {
  const happyScenario =
    await resolveDeliveryCashierOrderRemitPostingHappyPathScenarioContext();
  const exactCash = Number(happyScenario.cashGivenInput);
  const shortageAmounts = computeShortageAmounts(exactCash);

  return {
    ...happyScenario,
    exactCashInput: happyScenario.cashGivenInput,
    exactCashLabel: happyScenario.cashGivenLabel,
    ...shortageAmounts,
  };
}

async function main() {
  await resetDeliveryCashierOrderRemitShortagePathState();
  const scenario =
    await resolveDeliveryCashierOrderRemitShortagePathScenarioContext();

  console.log(
    [
      "Delivery cashier order remit shortage path setup is ready.",
      `Trace ID: ${scenario.traceId}`,
      `Created At: ${scenario.createdAt}`,
      `Cashier: ${scenario.cashier.email ?? `userId=${scenario.cashier.id}`}`,
      `Closed run code: ${scenario.closedRun.runCode}`,
      `Order: ${scenario.remitOrder.orderCode} [orderId=${scenario.remitOrder.id}]`,
      `Order remit route: ${scenario.remitOrder.remitRoute}`,
      `Run hub route: ${scenario.remitOrder.runHubRoute}`,
      `Exact rider cash: ${scenario.exactCashLabel}`,
      `Short cash to post: ${scenario.shortageCashLabel}`,
      `Expected rider-shortage bridge: ${scenario.shortageAmountLabel}`,
      `Tagged cashier shift device: ${scenario.cashierShiftDeviceId}`,
      `Cashier storage state: ${scenario.cashierStateFilePath}`,
      "Next manual QA steps:",
      "1. Open the printed order remit route as CASHIER.",
      "2. Uncheck print after posting so the flow returns to the run hub.",
      "3. Post the short printed cash amount and confirm redirect back to the closed run remit hub.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown delivery cashier-remit shortage-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
