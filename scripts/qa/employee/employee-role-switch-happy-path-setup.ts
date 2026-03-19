import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EmployeeRole,
  UserAuthState,
  UserRole,
} from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_ADMIN_EMAIL = "admin@local";

export const EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_FIRST_NAME =
  "QA Switchable";
export const EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_LAST_NAME =
  "Cashier";
export const EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_EMAIL =
  "qa.employee.role-switch.cashier@local";
export const EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_PHONE =
  "09991234015";
export const EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_LINE1 =
  "902 QA Role Switch Street";
export const EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_INITIAL_REASON =
  "INITIAL_CREATE_BY_ADMIN";
export const EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_CASHIER_TO_RIDER_REASON =
  "QA_ROLE_SWITCH_CASHIER_TO_RIDER";
export const EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_RIDER_TO_CASHIER_REASON =
  "QA_ROLE_SWITCH_RIDER_TO_CASHIER";

type AdminUser = {
  id: number;
  email: string | null;
  role: UserRole;
  active: boolean;
};

type ReferenceOption = {
  id: number;
  name: string;
};

type AddressChain = {
  province: ReferenceOption;
  municipality: ReferenceOption;
  barangay: ReferenceOption;
};

type DeleteSummary = {
  deletedEmployees: number;
  deletedUsers: number;
};

type SeedSummary = {
  employeeId: number;
  userId: number;
};

type ScenarioContext = {
  admin: AdminUser;
  barangay: ReferenceOption;
  cashierToRiderReason: string;
  defaultBranch: ReferenceOption;
  directoryRoute: string;
  email: string;
  firstName: string;
  fullName: string;
  initialReason: string;
  lastName: string;
  line1: string;
  municipality: ReferenceOption;
  phone: string;
  province: ReferenceOption;
  riderToCashierReason: string;
};

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function resolveEmployeeRoleSwitchHappyPathAdminEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_ADMIN_EMAIL ??
      process.env.UI_ADMIN_EMAIL ??
      DEFAULT_ADMIN_EMAIL,
  );
}

export function resolveEmployeeRoleSwitchHappyPathEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_EMAIL ??
      EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_EMAIL,
  );
}

export function resolveEmployeeRoleSwitchHappyPathPhone() {
  return (
    process.env.QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_PHONE ??
    EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_PHONE
  ).trim();
}

export function resolveEmployeeRoleSwitchHappyPathFirstName() {
  return (
    process.env.QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_FIRST_NAME ??
    EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_FIRST_NAME
  ).trim();
}

export function resolveEmployeeRoleSwitchHappyPathLastName() {
  return (
    process.env.QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_LAST_NAME ??
    EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_LAST_NAME
  ).trim();
}

export function resolveEmployeeRoleSwitchHappyPathLine1() {
  return (
    process.env.QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_LINE1 ??
    EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_DEFAULT_LINE1
  ).trim();
}

export function resolveEmployeeRoleSwitchHappyPathInitialReason() {
  return (
    process.env.QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_INITIAL_REASON ??
    EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_INITIAL_REASON
  ).trim();
}

export function resolveEmployeeRoleSwitchHappyPathCashierToRiderReason() {
  return (
    process.env.QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_CASHIER_TO_RIDER_REASON ??
    EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_CASHIER_TO_RIDER_REASON
  ).trim();
}

export function resolveEmployeeRoleSwitchHappyPathRiderToCashierReason() {
  return (
    process.env.QA_EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_RIDER_TO_CASHIER_REASON ??
    EMPLOYEE_ROLE_SWITCH_HAPPY_PATH_RIDER_TO_CASHIER_REASON
  ).trim();
}

async function resolveAdminUser(email: string) {
  const admin = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
    },
  });

  if (!admin || !admin.active || admin.role !== UserRole.ADMIN) {
    throw new Error(
      `Employee role switch happy path requires an active ADMIN account: ${email}`,
    );
  }

  return admin;
}

async function resolveDefaultBranch() {
  const branch = await db.branch.findFirst({
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });

  if (!branch) {
    throw new Error(
      "Employee role switch happy path requires at least one branch for default user assignment.",
    );
  }

  return branch;
}

async function resolveAddressChain(): Promise<AddressChain> {
  const provinces = await db.province.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  for (const province of provinces) {
    const municipality = await db.municipality.findFirst({
      where: { provinceId: province.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    if (!municipality) continue;

    const barangay = await db.barangay.findFirst({
      where: { municipalityId: municipality.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    if (!barangay) continue;

    return {
      province,
      municipality,
      barangay,
    };
  }

  throw new Error(
    "Employee role switch happy path requires one active province/municipality/barangay chain.",
  );
}

export async function deleteEmployeeRoleSwitchHappyPathArtifacts(): Promise<DeleteSummary> {
  const email = resolveEmployeeRoleSwitchHappyPathEmail();
  const phone = resolveEmployeeRoleSwitchHappyPathPhone();

  const deletedUsers = await db.user.deleteMany({
    where: { email },
  });

  const deletedEmployees = await db.employee.deleteMany({
    where: {
      OR: [{ email }, { phone }],
    },
  });

  return {
    deletedEmployees: deletedEmployees.count,
    deletedUsers: deletedUsers.count,
  };
}

async function seedEmployeeRoleSwitchHappyPathState(
  admin: AdminUser,
): Promise<SeedSummary> {
  const [defaultBranch, addressChain] = await Promise.all([
    resolveDefaultBranch(),
    resolveAddressChain(),
  ]);

  const email = resolveEmployeeRoleSwitchHappyPathEmail();
  const phone = resolveEmployeeRoleSwitchHappyPathPhone();
  const firstName = resolveEmployeeRoleSwitchHappyPathFirstName();
  const lastName = resolveEmployeeRoleSwitchHappyPathLastName();
  const line1 = resolveEmployeeRoleSwitchHappyPathLine1();
  const initialReason = resolveEmployeeRoleSwitchHappyPathInitialReason();

  return db.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        role: EmployeeRole.STAFF,
        active: true,
        defaultVehicleId: null,
        licenseNumber: null,
        licenseExpiry: null,
      },
      select: { id: true },
    });

    await tx.employeeAddress.create({
      data: {
        employeeId: employee.id,
        line1,
        provinceId: addressChain.province.id,
        municipalityId: addressChain.municipality.id,
        barangayId: addressChain.barangay.id,
        province: addressChain.province.name,
        city: addressChain.municipality.name,
        barangay: addressChain.barangay.name,
        zoneId: null,
        landmarkId: null,
        purok: null,
        postalCode: null,
        landmark: null,
        geoLat: null,
        geoLng: null,
      },
    });

    const user = await tx.user.create({
      data: {
        email,
        role: UserRole.CASHIER,
        managerKind: null,
        employeeId: employee.id,
        active: true,
        authState: UserAuthState.ACTIVE,
        passwordHash: "qa-role-switch-password-hash",
        pinHash: null,
        branches: {
          create: {
            branchId: defaultBranch.id,
          },
        },
      },
      select: { id: true },
    });

    await tx.userRoleAssignment.create({
      data: {
        userId: user.id,
        role: UserRole.CASHIER,
        reason: initialReason,
        changedById: admin.id,
      },
    });

    await tx.userRoleAuditEvent.create({
      data: {
        userId: user.id,
        beforeRole: UserRole.CASHIER,
        afterRole: UserRole.CASHIER,
        reason: initialReason,
        changedById: admin.id,
      },
    });

    return {
      employeeId: employee.id,
      userId: user.id,
    };
  });
}

export async function resetEmployeeRoleSwitchHappyPathState() {
  const deleted = await deleteEmployeeRoleSwitchHappyPathArtifacts();
  const admin = await resolveAdminUser(
    resolveEmployeeRoleSwitchHappyPathAdminEmail(),
  );
  const seeded = await seedEmployeeRoleSwitchHappyPathState(admin);

  return { admin, deleted, seeded };
}

export async function resolveEmployeeRoleSwitchHappyPathScenarioContext(): Promise<ScenarioContext> {
  const [admin, defaultBranch, addressChain] = await Promise.all([
    resolveAdminUser(resolveEmployeeRoleSwitchHappyPathAdminEmail()),
    resolveDefaultBranch(),
    resolveAddressChain(),
  ]);

  const firstName = resolveEmployeeRoleSwitchHappyPathFirstName();
  const lastName = resolveEmployeeRoleSwitchHappyPathLastName();

  return {
    admin,
    barangay: addressChain.barangay,
    cashierToRiderReason: resolveEmployeeRoleSwitchHappyPathCashierToRiderReason(),
    defaultBranch,
    directoryRoute: "/creation/employees",
    email: resolveEmployeeRoleSwitchHappyPathEmail(),
    firstName,
    fullName: `${firstName} ${lastName}`.trim(),
    initialReason: resolveEmployeeRoleSwitchHappyPathInitialReason(),
    lastName,
    line1: resolveEmployeeRoleSwitchHappyPathLine1(),
    municipality: addressChain.municipality,
    phone: resolveEmployeeRoleSwitchHappyPathPhone(),
    province: addressChain.province,
    riderToCashierReason: resolveEmployeeRoleSwitchHappyPathRiderToCashierReason(),
  };
}

async function main() {
  const { admin, deleted, seeded } =
    await resetEmployeeRoleSwitchHappyPathState();
  const scenario =
    await resolveEmployeeRoleSwitchHappyPathScenarioContext();

  console.log(
    [
      "Employee role switch happy path setup is ready.",
      `Admin: ${admin.email ?? `user#${admin.id}`} [userId=${admin.id}]`,
      `Directory route: ${scenario.directoryRoute}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      "Seeded lane: CASHIER",
      `Tagged full name: ${scenario.fullName}`,
      `Tagged email: ${scenario.email}`,
      `Tagged phone: ${scenario.phone}`,
      `House/Street: ${scenario.line1}`,
      `Seeded userId: ${seeded.userId}`,
      `Seeded employeeId: ${seeded.employeeId}`,
      `Province: ${scenario.province.name} [id=${scenario.province.id}]`,
      `Municipality: ${scenario.municipality.name} [id=${scenario.municipality.id}]`,
      `Barangay: ${scenario.barangay.name} [id=${scenario.barangay.id}]`,
      `Deleted previous tagged users: ${deleted.deletedUsers}`,
      `Deleted previous tagged employees: ${deleted.deletedEmployees}`,
      "Next manual QA steps:",
      "1. Open /creation/employees as ADMIN.",
      "2. Locate the tagged cashier row.",
      `3. Switch to RIDER with reason ${scenario.cashierToRiderReason}.`,
      `4. Switch back to CASHIER with reason ${scenario.riderToCashierReason}.`,
      "5. Confirm the success alerts and the row lane updates after each switch.",
    ].join("\n"),
  );
}

if (isMainModule()) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
