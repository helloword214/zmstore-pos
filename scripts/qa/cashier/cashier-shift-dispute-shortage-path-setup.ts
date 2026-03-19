import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";
const DEFAULT_CASHIER_EMAIL = "cashier1@local";

export const CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEVICE_ID =
  "QA-CASHIER-SHIFT-DISPUTE-SHORTAGE-PATH";
export const CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEFAULT_OPENING_FLOAT = 500;
export const CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEFAULT_SHORT_COUNT = 450;
export const CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEFAULT_PAPER_REF =
  "QA-CS-SHORTAGE-CHARGE";
export const CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DECISION = "CHARGE_CASHIER";

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
  expectedChargeAmount: number;
  expectedChargeAmountLabel: string;
  expectedVariance: number;
  manager: ScenarioUser;
  managerLabel: string;
  managerRoute: string;
  openingFloat: number;
  openingFloatInput: string;
  openingFloatLabel: string;
  paperRefNo: string;
  shortageCount: number;
  shortageCountInput: string;
  shortageCountLabel: string;
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

export function resolveCashierShiftDisputeShortagePathManagerEmail() {
  return normalizeEmail(
    process.env.QA_CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_MANAGER_EMAIL ??
      process.env.UI_MANAGER_EMAIL ??
      DEFAULT_MANAGER_EMAIL,
  );
}

export function resolveCashierShiftDisputeShortagePathCashierEmail() {
  return normalizeEmail(
    process.env.QA_CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_CASHIER_EMAIL ??
      process.env.UI_CASHIER_EMAIL ??
      DEFAULT_CASHIER_EMAIL,
  );
}

export function resolveCashierShiftDisputeShortagePathDeviceId() {
  return (
    process.env.QA_CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEVICE_ID ??
    CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEVICE_ID
  ).trim();
}

export function resolveCashierShiftDisputeShortagePathOpeningFloat() {
  const raw =
    process.env.QA_CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_OPENING_FLOAT ?? "";
  const parsed = Number(raw);

  if (!raw.trim()) {
    return CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEFAULT_OPENING_FLOAT;
  }
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      "Cashier shortage-path opening float must be a valid number (>= 0).",
    );
  }
  return Math.round(parsed * 100) / 100;
}

export function resolveCashierShiftDisputeShortagePathShortCount() {
  const raw =
    process.env.QA_CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_SHORT_COUNT ?? "";
  const parsed = Number(raw);

  if (!raw.trim()) {
    return CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEFAULT_SHORT_COUNT;
  }
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      "Cashier shortage-path short count must be a valid number (>= 0).",
    );
  }
  return Math.round(parsed * 100) / 100;
}

export function resolveCashierShiftDisputeShortagePathPaperRefNo() {
  return (
    process.env.QA_CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_PAPER_REF_NO ??
    CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DEFAULT_PAPER_REF
  ).trim();
}

export function formatCashierShiftDisputeShortagePathUserLabel(
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
      `Cashier shortage path requires an active ${role} account: ${email}`,
    );
  }

  return user;
}

async function listTaggedShiftIds() {
  const taggedShifts = await db.cashierShift.findMany({
    where: { deviceId: resolveCashierShiftDisputeShortagePathDeviceId() },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  return taggedShifts.map((shift) => shift.id);
}

export async function resolveCashierShiftDisputeShortagePathUsers() {
  const manager = await resolveScenarioUser(
    resolveCashierShiftDisputeShortagePathManagerEmail(),
    UserRole.STORE_MANAGER,
  );
  const cashier = await resolveScenarioUser(
    resolveCashierShiftDisputeShortagePathCashierEmail(),
    UserRole.CASHIER,
  );

  return { manager, cashier };
}

export async function deleteCashierShiftDisputeShortagePathArtifacts(): Promise<DeleteSummary> {
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

export async function resetCashierShiftDisputeShortagePathState() {
  const deleted = await deleteCashierShiftDisputeShortagePathArtifacts();
  const users = await resolveCashierShiftDisputeShortagePathUsers();
  const foreignOpenShift = await db.cashierShift.findFirst({
    where: {
      cashierId: users.cashier.id,
      closedAt: null,
      NOT: { deviceId: resolveCashierShiftDisputeShortagePathDeviceId() },
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
      "Cashier shortage setup stopped because the cashier already has a non-QA open shift. " +
        `Resolve shift #${foreignOpenShift.id} (${foreignOpenShift.status}) first.`,
    );
  }

  return { deleted, ...users };
}

export async function resolveCashierShiftDisputeShortagePathScenarioContext(): Promise<ScenarioContext> {
  const { manager, cashier } =
    await resolveCashierShiftDisputeShortagePathUsers();
  const openingFloat = resolveCashierShiftDisputeShortagePathOpeningFloat();
  const shortageCount = resolveCashierShiftDisputeShortagePathShortCount();

  if (shortageCount >= openingFloat) {
    throw new Error(
      "Cashier shortage path requires the short count to be lower than the opening float.",
    );
  }

  const expectedVariance = Math.round((shortageCount - openingFloat) * 100) / 100;
  const expectedChargeAmount = Math.abs(expectedVariance);

  return {
    cashier,
    cashierLabel: formatCashierShiftDisputeShortagePathUserLabel(cashier),
    cashierRoute: "/cashier/shift?next=/cashier",
    deviceId: resolveCashierShiftDisputeShortagePathDeviceId(),
    expectedChargeAmount,
    expectedChargeAmountLabel: peso(expectedChargeAmount),
    expectedVariance,
    manager,
    managerLabel: formatCashierShiftDisputeShortagePathUserLabel(manager),
    managerRoute: "/store/cashier-shifts",
    openingFloat,
    openingFloatInput: toFixedCurrencyInput(openingFloat),
    openingFloatLabel: peso(openingFloat),
    paperRefNo: resolveCashierShiftDisputeShortagePathPaperRefNo(),
    shortageCount,
    shortageCountInput: toFixedCurrencyInput(shortageCount),
    shortageCountLabel: peso(shortageCount),
  };
}

async function main() {
  const { deleted } = await resetCashierShiftDisputeShortagePathState();
  const scenario =
    await resolveCashierShiftDisputeShortagePathScenarioContext();

  console.log(
    [
      "Cashier shift dispute-shortage path setup is ready.",
      `Manager: ${scenario.managerLabel} [userId=${scenario.manager.id}]`,
      `Cashier: ${scenario.cashierLabel} [userId=${scenario.cashier.id}]`,
      `Device marker: ${scenario.deviceId}`,
      `Opening float: ${scenario.openingFloatLabel}`,
      `Short count: ${scenario.shortageCountLabel}`,
      `Expected charge amount: ${scenario.expectedChargeAmountLabel}`,
      `Decision: ${CASHIER_SHIFT_DISPUTE_SHORTAGE_PATH_DECISION}`,
      `Paper ref: ${scenario.paperRefNo}`,
      `Manager route: ${scenario.managerRoute}`,
      `Cashier route: ${scenario.cashierRoute}`,
      `Deleted previous tagged shifts: ${deleted.deletedShifts}`,
      "Next manual QA steps:",
      "1. Manager opens the tagged shift in /store/cashier-shifts.",
      "2. Cashier accepts the opening float in /cashier/shift.",
      "3. Cashier submits the printed short count.",
      "4. Manager selects CHARGE_CASHIER, enters the printed paper ref, and final-closes the shift.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "Unknown cashier shortage-path setup error.",
      );
      throw error;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
