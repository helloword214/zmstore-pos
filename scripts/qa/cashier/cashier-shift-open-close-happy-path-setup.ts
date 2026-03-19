import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";
const DEFAULT_CASHIER_EMAIL = "cashier1@local";

export const CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_DEVICE_ID =
  "QA-CASHIER-SHIFT-OPEN-CLOSE-HAPPY-PATH";
export const CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_DEFAULT_OPENING_FLOAT = 500;

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
  manager: ScenarioUser;
  managerLabel: string;
  managerRoute: string;
  openingFloat: number;
  openingFloatInput: string;
  openingFloatLabel: string;
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

export function resolveCashierShiftOpenCloseHappyPathManagerEmail() {
  return normalizeEmail(
    process.env.QA_CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveCashierShiftOpenCloseHappyPathCashierEmail() {
  return normalizeEmail(
    process.env.QA_CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_CASHIER_EMAIL ??
      process.env.UI_CASHIER_EMAIL ??
      DEFAULT_CASHIER_EMAIL,
  );
}

export function resolveCashierShiftOpenCloseHappyPathDeviceId() {
  return (
    process.env.QA_CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_DEVICE_ID ??
    CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_DEVICE_ID
  ).trim();
}

export function resolveCashierShiftOpenCloseHappyPathOpeningFloat() {
  const raw =
    process.env.QA_CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_OPENING_FLOAT ?? "";
  const parsed = Number(raw);
  if (!raw.trim()) return CASHIER_SHIFT_OPEN_CLOSE_HAPPY_PATH_DEFAULT_OPENING_FLOAT;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Cashier happy-path opening float must be a valid number (>= 0).");
  }
  return Math.round(parsed * 100) / 100;
}

export function formatCashierShiftOpenCloseHappyPathUserLabel(user: ScenarioUser) {
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
      `Cashier shift happy path requires an active ${role} account: ${email}`,
    );
  }

  return user;
}

async function listTaggedShiftIds() {
  const taggedShifts = await db.cashierShift.findMany({
    where: { deviceId: resolveCashierShiftOpenCloseHappyPathDeviceId() },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  return taggedShifts.map((shift) => shift.id);
}

export async function resolveCashierShiftOpenCloseHappyPathUsers() {
  const manager = await resolveScenarioUser(
    resolveCashierShiftOpenCloseHappyPathManagerEmail(),
    UserRole.STORE_MANAGER,
  );
  const cashier = await resolveScenarioUser(
    resolveCashierShiftOpenCloseHappyPathCashierEmail(),
    UserRole.CASHIER,
  );

  return { manager, cashier };
}

export async function deleteCashierShiftOpenCloseHappyPathArtifacts(): Promise<DeleteSummary> {
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

export async function resetCashierShiftOpenCloseHappyPathState() {
  const deleted = await deleteCashierShiftOpenCloseHappyPathArtifacts();
  const users = await resolveCashierShiftOpenCloseHappyPathUsers();
  const foreignOpenShift = await db.cashierShift.findFirst({
    where: {
      cashierId: users.cashier.id,
      closedAt: null,
      NOT: { deviceId: resolveCashierShiftOpenCloseHappyPathDeviceId() },
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
      "Cashier happy-path setup stopped because the cashier already has a non-QA open shift. " +
        `Resolve shift #${foreignOpenShift.id} (${foreignOpenShift.status}) first.`,
    );
  }

  return { deleted, ...users };
}

export async function resolveCashierShiftOpenCloseHappyPathScenarioContext(): Promise<ScenarioContext> {
  const { manager, cashier } = await resolveCashierShiftOpenCloseHappyPathUsers();
  const openingFloat = resolveCashierShiftOpenCloseHappyPathOpeningFloat();

  return {
    cashier,
    cashierLabel: formatCashierShiftOpenCloseHappyPathUserLabel(cashier),
    cashierRoute: "/cashier/shift?next=/cashier",
    deviceId: resolveCashierShiftOpenCloseHappyPathDeviceId(),
    manager,
    managerLabel: formatCashierShiftOpenCloseHappyPathUserLabel(manager),
    managerRoute: "/store/cashier-shifts",
    openingFloat,
    openingFloatInput: toFixedCurrencyInput(openingFloat),
    openingFloatLabel: peso(openingFloat),
  };
}

async function main() {
  const { deleted } = await resetCashierShiftOpenCloseHappyPathState();
  const scenario = await resolveCashierShiftOpenCloseHappyPathScenarioContext();

  console.log(
    [
      "Cashier shift open-close happy path setup is ready.",
      `Manager: ${scenario.managerLabel} [userId=${scenario.manager.id}]`,
      `Cashier: ${scenario.cashierLabel} [userId=${scenario.cashier.id}]`,
      `Device marker: ${scenario.deviceId}`,
      `Opening float: ${scenario.openingFloatLabel}`,
      `Manager route: ${scenario.managerRoute}`,
      `Cashier route: ${scenario.cashierRoute}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      "Next manual QA steps:",
      "1. Manager opens the tagged shift in /store/cashier-shifts.",
      "2. Cashier accepts the opening float in /cashier/shift.",
      "3. Cashier submits counted cash matching the expected drawer.",
      "4. Manager recounts the same amount and final-closes the shift.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown cashier shift happy-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
