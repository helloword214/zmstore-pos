import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";
const DEFAULT_CASHIER_EMAIL = "cashier1@local";

export const CASHIER_OPENING_DISPUTE_RESEND_PATH_DEVICE_ID =
  "QA-CASHIER-OPENING-DISPUTE-RESEND-PATH";
export const CASHIER_OPENING_DISPUTE_RESEND_PATH_DEFAULT_INITIAL_OPENING_FLOAT =
  500;
export const CASHIER_OPENING_DISPUTE_RESEND_PATH_DEFAULT_DISPUTED_OPENING_COUNT =
  470;
export const CASHIER_OPENING_DISPUTE_RESEND_PATH_DEFAULT_RESEND_OPENING_FLOAT =
  470;
export const CASHIER_OPENING_DISPUTE_RESEND_PATH_DEFAULT_DISPUTE_NOTE =
  "QA opening recount mismatch; manager please resend corrected float.";

type ScenarioUser = {
  id: number;
  email: string | null;
  role: UserRole;
  active: boolean;
  employee: {
    firstName: string;
    lastName: string;
    alias: string | null;
  } | null;
};

type DeleteSummary = {
  deletedArPayments: number;
  deletedCashDrawerTxns: number;
  deletedCashierChargePayments: number;
  deletedCashierCharges: number;
  deletedPayments: number;
  deletedRiderChargePayments: number;
  deletedRiderVariances: number;
  deletedShiftVariances: number;
  deletedShifts: number;
};

type ScenarioContext = {
  cashier: ScenarioUser;
  cashierLabel: string;
  cashierRoute: string;
  deviceId: string;
  disputedOpeningCount: number;
  disputedOpeningCountInput: string;
  disputedOpeningCountLabel: string;
  disputeNote: string;
  initialOpeningFloat: number;
  initialOpeningFloatInput: string;
  initialOpeningFloatLabel: string;
  manager: ScenarioUser;
  managerLabel: string;
  managerRoute: string;
  resendOpeningFloat: number;
  resendOpeningFloatInput: string;
  resendOpeningFloatLabel: string;
};

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

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function toFixedCurrencyInput(value: number) {
  return value.toFixed(2);
}

function parseMoneyEnv(raw: string, label: string, fallback: number) {
  if (!raw.trim()) return fallback;
  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a valid number (>= 0).`);
  }

  return Math.round(parsed * 100) / 100;
}

export function resolveCashierOpeningDisputeResendPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_CASHIER_OPENING_DISPUTE_RESEND_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveCashierOpeningDisputeResendPathCashierEmail() {
  return normalizeEmail(
    process.env.QA_CASHIER_OPENING_DISPUTE_RESEND_PATH_CASHIER_EMAIL ??
      process.env.UI_CASHIER_EMAIL ??
      DEFAULT_CASHIER_EMAIL,
  );
}

export function resolveCashierOpeningDisputeResendPathDeviceId() {
  return (
    process.env.QA_CASHIER_OPENING_DISPUTE_RESEND_PATH_DEVICE_ID ??
    CASHIER_OPENING_DISPUTE_RESEND_PATH_DEVICE_ID
  ).trim();
}

export function resolveCashierOpeningDisputeResendPathInitialOpeningFloat() {
  return parseMoneyEnv(
    process.env.QA_CASHIER_OPENING_DISPUTE_RESEND_PATH_INITIAL_OPENING_FLOAT ??
      "",
    "Cashier opening-dispute resend initial opening float",
    CASHIER_OPENING_DISPUTE_RESEND_PATH_DEFAULT_INITIAL_OPENING_FLOAT,
  );
}

export function resolveCashierOpeningDisputeResendPathDisputedOpeningCount() {
  return parseMoneyEnv(
    process.env.QA_CASHIER_OPENING_DISPUTE_RESEND_PATH_DISPUTED_OPENING_COUNT ??
      "",
    "Cashier opening-dispute resend disputed opening count",
    CASHIER_OPENING_DISPUTE_RESEND_PATH_DEFAULT_DISPUTED_OPENING_COUNT,
  );
}

export function resolveCashierOpeningDisputeResendPathResendOpeningFloat() {
  return parseMoneyEnv(
    process.env.QA_CASHIER_OPENING_DISPUTE_RESEND_PATH_RESEND_OPENING_FLOAT ??
      "",
    "Cashier opening-dispute resend resend opening float",
    CASHIER_OPENING_DISPUTE_RESEND_PATH_DEFAULT_RESEND_OPENING_FLOAT,
  );
}

export function resolveCashierOpeningDisputeResendPathDisputeNote() {
  return (
    process.env.QA_CASHIER_OPENING_DISPUTE_RESEND_PATH_DISPUTE_NOTE ??
    CASHIER_OPENING_DISPUTE_RESEND_PATH_DEFAULT_DISPUTE_NOTE
  ).trim();
}

export function formatCashierOpeningDisputeResendPathUserLabel(
  user: ScenarioUser,
) {
  const employee = user.employee;
  const fullName =
    employee && (employee.firstName || employee.lastName)
      ? `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim()
      : user.email ?? `User #${user.id}`;
  const alias = employee?.alias ? ` (${employee.alias})` : "";
  return `${fullName}${alias}`;
}

async function resolveScenarioUser(email: string, role: UserRole) {
  const user = await db.user.findUnique({
    where: { email },
    include: {
      employee: {
        select: {
          firstName: true,
          lastName: true,
          alias: true,
        },
      },
    },
  });

  if (!user || !user.active || user.role !== role) {
    throw new Error(
      `Cashier opening-dispute resend path requires an active ${role} account: ${email}`,
    );
  }

  return user;
}

async function listTaggedShiftIds() {
  const taggedShifts = await db.cashierShift.findMany({
    where: { deviceId: resolveCashierOpeningDisputeResendPathDeviceId() },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  return taggedShifts.map((shift) => shift.id);
}

export async function resolveCashierOpeningDisputeResendPathUsers() {
  const manager = await resolveScenarioUser(
    resolveCashierOpeningDisputeResendPathManagerEmail(),
    UserRole.STORE_MANAGER,
  );
  const cashier = await resolveScenarioUser(
    resolveCashierOpeningDisputeResendPathCashierEmail(),
    UserRole.CASHIER,
  );

  return { manager, cashier };
}

export async function deleteCashierOpeningDisputeResendPathArtifacts(): Promise<DeleteSummary> {
  const shiftIds = await listTaggedShiftIds();
  if (shiftIds.length === 0) {
    return {
      deletedArPayments: 0,
      deletedCashDrawerTxns: 0,
      deletedCashierChargePayments: 0,
      deletedCashierCharges: 0,
      deletedPayments: 0,
      deletedRiderChargePayments: 0,
      deletedRiderVariances: 0,
      deletedShiftVariances: 0,
      deletedShifts: 0,
    };
  }

  const varianceIds = (
    await db.cashierShiftVariance.findMany({
      where: { shiftId: { in: shiftIds } },
      select: { id: true },
    })
  ).map((variance) => variance.id);

  const cashierChargeWhere =
    varianceIds.length > 0
      ? {
          OR: [
            { shiftId: { in: shiftIds } },
            { varianceId: { in: varianceIds } },
          ],
        }
      : { shiftId: { in: shiftIds } };

  const cashierChargeIds = (
    await db.cashierCharge.findMany({
      where: cashierChargeWhere,
      select: { id: true },
    })
  ).map((charge) => charge.id);

  return db.$transaction(async (tx) => {
    const deletedCashierChargePayments =
      cashierChargeIds.length > 0
        ? await tx.cashierChargePayment.deleteMany({
            where: {
              OR: [
                { shiftId: { in: shiftIds } },
                { chargeId: { in: cashierChargeIds } },
              ],
            },
          })
        : await tx.cashierChargePayment.deleteMany({
            where: { shiftId: { in: shiftIds } },
          });

    const deletedRiderChargePayments = await tx.riderChargePayment.deleteMany({
      where: { shiftId: { in: shiftIds } },
    });
    const deletedPayments = await tx.payment.deleteMany({
      where: { shiftId: { in: shiftIds } },
    });
    const deletedArPayments = await tx.customerArPayment.deleteMany({
      where: { shiftId: { in: shiftIds } },
    });
    const deletedCashDrawerTxns = await tx.cashDrawerTxn.deleteMany({
      where: { shiftId: { in: shiftIds } },
    });
    const deletedRiderVariances = await tx.riderRunVariance.deleteMany({
      where: { shiftId: { in: shiftIds } },
    });
    const deletedCashierCharges =
      cashierChargeIds.length > 0
        ? await tx.cashierCharge.deleteMany({
            where: { id: { in: cashierChargeIds } },
          })
        : await tx.cashierCharge.deleteMany({
            where: { shiftId: { in: shiftIds } },
          });
    const deletedShiftVariances =
      varianceIds.length > 0
        ? await tx.cashierShiftVariance.deleteMany({
            where: { id: { in: varianceIds } },
          })
        : await tx.cashierShiftVariance.deleteMany({
            where: { shiftId: { in: shiftIds } },
          });
    const deletedShifts = await tx.cashierShift.deleteMany({
      where: { id: { in: shiftIds } },
    });

    return {
      deletedArPayments: deletedArPayments.count,
      deletedCashDrawerTxns: deletedCashDrawerTxns.count,
      deletedCashierChargePayments: deletedCashierChargePayments.count,
      deletedCashierCharges: deletedCashierCharges.count,
      deletedPayments: deletedPayments.count,
      deletedRiderChargePayments: deletedRiderChargePayments.count,
      deletedRiderVariances: deletedRiderVariances.count,
      deletedShiftVariances: deletedShiftVariances.count,
      deletedShifts: deletedShifts.count,
    };
  });
}

export async function resetCashierOpeningDisputeResendPathState() {
  const deleted = await deleteCashierOpeningDisputeResendPathArtifacts();
  const users = await resolveCashierOpeningDisputeResendPathUsers();
  const foreignOpenShift = await db.cashierShift.findFirst({
    where: {
      cashierId: users.cashier.id,
      closedAt: null,
      NOT: { deviceId: resolveCashierOpeningDisputeResendPathDeviceId() },
    },
    select: {
      id: true,
      status: true,
      deviceId: true,
    },
    orderBy: { openedAt: "desc" },
  });

  if (foreignOpenShift) {
    throw new Error(
      "Cashier opening-dispute resend setup stopped because the cashier already has a non-QA open shift. " +
        `Resolve shift #${foreignOpenShift.id} (${foreignOpenShift.status}) first.`,
    );
  }

  return { deleted, ...users };
}

export async function resolveCashierOpeningDisputeResendPathScenarioContext(): Promise<ScenarioContext> {
  const { manager, cashier } =
    await resolveCashierOpeningDisputeResendPathUsers();
  const initialOpeningFloat =
    resolveCashierOpeningDisputeResendPathInitialOpeningFloat();
  const disputedOpeningCount =
    resolveCashierOpeningDisputeResendPathDisputedOpeningCount();
  const resendOpeningFloat =
    resolveCashierOpeningDisputeResendPathResendOpeningFloat();

  if (Math.abs(disputedOpeningCount - initialOpeningFloat) < 0.005) {
    throw new Error(
      "Cashier opening-dispute resend path requires the disputed opening count to differ from the initial opening float.",
    );
  }
  if (Math.abs(resendOpeningFloat - initialOpeningFloat) < 0.005) {
    throw new Error(
      "Cashier opening-dispute resend path requires the resent opening float to differ from the initial opening float.",
    );
  }

  return {
    cashier,
    cashierLabel: formatCashierOpeningDisputeResendPathUserLabel(cashier),
    cashierRoute: "/cashier/shift?next=/cashier",
    deviceId: resolveCashierOpeningDisputeResendPathDeviceId(),
    disputedOpeningCount,
    disputedOpeningCountInput: toFixedCurrencyInput(disputedOpeningCount),
    disputedOpeningCountLabel: peso(disputedOpeningCount),
    disputeNote: resolveCashierOpeningDisputeResendPathDisputeNote(),
    initialOpeningFloat,
    initialOpeningFloatInput: toFixedCurrencyInput(initialOpeningFloat),
    initialOpeningFloatLabel: peso(initialOpeningFloat),
    manager,
    managerLabel: formatCashierOpeningDisputeResendPathUserLabel(manager),
    managerRoute: "/store/cashier-shifts",
    resendOpeningFloat,
    resendOpeningFloatInput: toFixedCurrencyInput(resendOpeningFloat),
    resendOpeningFloatLabel: peso(resendOpeningFloat),
  };
}

async function main() {
  const { deleted } = await resetCashierOpeningDisputeResendPathState();
  const scenario =
    await resolveCashierOpeningDisputeResendPathScenarioContext();

  console.log(
    [
      "Cashier opening-dispute resend path setup is ready.",
      `Manager: ${scenario.managerLabel} [userId=${scenario.manager.id}]`,
      `Cashier: ${scenario.cashierLabel} [userId=${scenario.cashier.id}]`,
      `Device marker: ${scenario.deviceId}`,
      `Initial opening float: ${scenario.initialOpeningFloatLabel}`,
      `Disputed opening count: ${scenario.disputedOpeningCountLabel}`,
      `Resent opening float: ${scenario.resendOpeningFloatLabel}`,
      `Dispute note: ${scenario.disputeNote}`,
      `Manager route: ${scenario.managerRoute}`,
      `Cashier route: ${scenario.cashierRoute}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      "Next manual QA steps:",
      "1. Manager opens the tagged shift in /store/cashier-shifts.",
      "2. Cashier disputes the opening float in /cashier/shift using the printed note.",
      "3. Manager resends the opening verification with the printed corrected float.",
      "4. Cashier accepts the resent opening float and confirms the shift reaches OPEN state.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown cashier opening-dispute resend setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
