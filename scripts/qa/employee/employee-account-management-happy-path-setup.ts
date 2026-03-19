import "dotenv/config";

import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EmployeeRole,
  UserAuthState,
  UserRole,
} from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_ADMIN_EMAIL = "admin@local";

export const EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_FIRST_NAME =
  "QA Managed";
export const EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_LAST_NAME =
  "Cashier";
export const EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_EMAIL =
  "qa.employee.account-management.cashier@local";
export const EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_PHONE =
  "09991234014";
export const EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_LINE1 =
  "901 QA Account Management Street";

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
  initialTokenCreatedAt: Date;
  userId: number;
};

type ScenarioContext = {
  admin: AdminUser;
  barangay: ReferenceOption;
  defaultBranch: ReferenceOption;
  directoryRoute: string;
  email: string;
  firstName: string;
  fullName: string;
  lastName: string;
  line1: string;
  municipality: ReferenceOption;
  phone: string;
  province: ReferenceOption;
};

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function tokenHash(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function resolveEmployeeAccountManagementHappyPathAdminEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_ADMIN_EMAIL ??
      process.env.UI_ADMIN_EMAIL ??
      DEFAULT_ADMIN_EMAIL,
  );
}

export function resolveEmployeeAccountManagementHappyPathEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_EMAIL ??
      EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_EMAIL,
  );
}

export function resolveEmployeeAccountManagementHappyPathPhone() {
  return (
    process.env.QA_EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_PHONE ??
    EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_PHONE
  ).trim();
}

export function resolveEmployeeAccountManagementHappyPathFirstName() {
  return (
    process.env.QA_EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_FIRST_NAME ??
    EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_FIRST_NAME
  ).trim();
}

export function resolveEmployeeAccountManagementHappyPathLastName() {
  return (
    process.env.QA_EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_LAST_NAME ??
    EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_LAST_NAME
  ).trim();
}

export function resolveEmployeeAccountManagementHappyPathLine1() {
  return (
    process.env.QA_EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_LINE1 ??
    EMPLOYEE_ACCOUNT_MANAGEMENT_HAPPY_PATH_DEFAULT_LINE1
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
      `Employee account management happy path requires an active ADMIN account: ${email}`,
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
      "Employee account management happy path requires at least one branch for default user assignment.",
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
    "Employee account management happy path requires one active province/municipality/barangay chain.",
  );
}

export async function deleteEmployeeAccountManagementHappyPathArtifacts(): Promise<DeleteSummary> {
  const email = resolveEmployeeAccountManagementHappyPathEmail();
  const phone = resolveEmployeeAccountManagementHappyPathPhone();

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

async function seedEmployeeAccountManagementHappyPathState(
  admin: AdminUser,
): Promise<SeedSummary> {
  const [defaultBranch, addressChain] = await Promise.all([
    resolveDefaultBranch(),
    resolveAddressChain(),
  ]);

  const email = resolveEmployeeAccountManagementHappyPathEmail();
  const phone = resolveEmployeeAccountManagementHappyPathPhone();
  const firstName = resolveEmployeeAccountManagementHappyPathFirstName();
  const lastName = resolveEmployeeAccountManagementHappyPathLastName();
  const line1 = resolveEmployeeAccountManagementHappyPathLine1();
  const initialTokenCreatedAt = new Date();
  const initialTokenRaw = `${email}:initial-setup-token`;

  return db.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        role: EmployeeRole.STAFF,
        active: true,
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
        authState: UserAuthState.PENDING_PASSWORD,
        passwordHash: null,
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
        reason: "INITIAL_CREATE_BY_ADMIN",
        changedById: admin.id,
      },
    });

    await tx.userRoleAuditEvent.create({
      data: {
        userId: user.id,
        beforeRole: UserRole.CASHIER,
        afterRole: UserRole.CASHIER,
        reason: "INITIAL_CREATE_BY_ADMIN",
        changedById: admin.id,
      },
    });

    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(initialTokenRaw),
        expiresAt: new Date(initialTokenCreatedAt.getTime() + 1000 * 60 * 60 * 24),
        usedAt: null,
        requestedIp: "127.0.0.1",
        requestedUserAgent: "qa-employee-account-management-seed",
      },
    });

    return {
      employeeId: employee.id,
      initialTokenCreatedAt,
      userId: user.id,
    };
  });
}

export async function resetEmployeeAccountManagementHappyPathState() {
  const deleted = await deleteEmployeeAccountManagementHappyPathArtifacts();
  const admin = await resolveAdminUser(
    resolveEmployeeAccountManagementHappyPathAdminEmail(),
  );
  const seeded = await seedEmployeeAccountManagementHappyPathState(admin);

  return { admin, deleted, seeded };
}

export async function resolveEmployeeAccountManagementHappyPathScenarioContext(): Promise<ScenarioContext> {
  const [admin, defaultBranch, addressChain] = await Promise.all([
    resolveAdminUser(resolveEmployeeAccountManagementHappyPathAdminEmail()),
    resolveDefaultBranch(),
    resolveAddressChain(),
  ]);

  const firstName = resolveEmployeeAccountManagementHappyPathFirstName();
  const lastName = resolveEmployeeAccountManagementHappyPathLastName();

  return {
    admin,
    barangay: addressChain.barangay,
    defaultBranch,
    directoryRoute: "/creation/employees",
    email: resolveEmployeeAccountManagementHappyPathEmail(),
    firstName,
    fullName: `${firstName} ${lastName}`.trim(),
    lastName,
    line1: resolveEmployeeAccountManagementHappyPathLine1(),
    municipality: addressChain.municipality,
    phone: resolveEmployeeAccountManagementHappyPathPhone(),
    province: addressChain.province,
  };
}

async function main() {
  const { admin, deleted, seeded } =
    await resetEmployeeAccountManagementHappyPathState();
  const scenario =
    await resolveEmployeeAccountManagementHappyPathScenarioContext();

  console.log(
    [
      "Employee account management happy path setup is ready.",
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
      "3. Click Resend Invite, then Deactivate, then Activate.",
      "4. Confirm the success alerts and row state changes after each action.",
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

