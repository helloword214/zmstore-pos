import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_ADMIN_EMAIL = "admin@local";

export const EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_FIRST_NAME =
  "QA Cashier";
export const EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_LAST_NAME =
  "Onboarding";
export const EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_EMAIL =
  "qa.employee.onboarding.cashier@local";
export const EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_PHONE =
  "09991234011";
export const EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_LINE1 =
  "123 QA Onboarding Street";

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

type ScenarioContext = {
  admin: AdminUser;
  barangay: ReferenceOption;
  createRoute: string;
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

export function resolveEmployeeOnboardingCreateHappyPathAdminEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_ADMIN_EMAIL ??
      process.env.UI_ADMIN_EMAIL ??
      DEFAULT_ADMIN_EMAIL,
  );
}

export function resolveEmployeeOnboardingCreateHappyPathEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_EMAIL ??
      EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_EMAIL,
  );
}

export function resolveEmployeeOnboardingCreateHappyPathPhone() {
  return (
    process.env.QA_EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_PHONE ??
    EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_PHONE
  ).trim();
}

export function resolveEmployeeOnboardingCreateHappyPathFirstName() {
  return (
    process.env.QA_EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_FIRST_NAME ??
    EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_FIRST_NAME
  ).trim();
}

export function resolveEmployeeOnboardingCreateHappyPathLastName() {
  return (
    process.env.QA_EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_LAST_NAME ??
    EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_LAST_NAME
  ).trim();
}

export function resolveEmployeeOnboardingCreateHappyPathLine1() {
  return (
    process.env.QA_EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_LINE1 ??
    EMPLOYEE_ONBOARDING_CREATE_HAPPY_PATH_DEFAULT_LINE1
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
      `Employee onboarding happy path requires an active ADMIN account: ${email}`,
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
      "Employee onboarding happy path requires at least one branch for default user assignment.",
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
    "Employee onboarding happy path requires one active province/municipality/barangay chain.",
  );
}

export async function deleteEmployeeOnboardingCreateHappyPathArtifacts(): Promise<DeleteSummary> {
  const email = resolveEmployeeOnboardingCreateHappyPathEmail();
  const phone = resolveEmployeeOnboardingCreateHappyPathPhone();

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

export async function resetEmployeeOnboardingCreateHappyPathState() {
  const deleted = await deleteEmployeeOnboardingCreateHappyPathArtifacts();
  const admin = await resolveAdminUser(
    resolveEmployeeOnboardingCreateHappyPathAdminEmail(),
  );

  return { admin, deleted };
}

export async function resolveEmployeeOnboardingCreateHappyPathScenarioContext(): Promise<ScenarioContext> {
  const [admin, defaultBranch, addressChain] = await Promise.all([
    resolveAdminUser(resolveEmployeeOnboardingCreateHappyPathAdminEmail()),
    resolveDefaultBranch(),
    resolveAddressChain(),
  ]);

  const firstName = resolveEmployeeOnboardingCreateHappyPathFirstName();
  const lastName = resolveEmployeeOnboardingCreateHappyPathLastName();

  return {
    admin,
    barangay: addressChain.barangay,
    createRoute: "/creation/employees/new",
    defaultBranch,
    directoryRoute: "/creation/employees",
    email: resolveEmployeeOnboardingCreateHappyPathEmail(),
    firstName,
    fullName: `${firstName} ${lastName}`.trim(),
    lastName,
    line1: resolveEmployeeOnboardingCreateHappyPathLine1(),
    municipality: addressChain.municipality,
    phone: resolveEmployeeOnboardingCreateHappyPathPhone(),
    province: addressChain.province,
  };
}

async function main() {
  const { deleted, admin } = await resetEmployeeOnboardingCreateHappyPathState();
  const scenario =
    await resolveEmployeeOnboardingCreateHappyPathScenarioContext();

  console.log(
    [
      "Employee onboarding create happy path setup is ready.",
      `Admin: ${admin.email ?? `user#${admin.id}`} [userId=${admin.id}]`,
      `Create route: ${scenario.createRoute}`,
      `Directory route: ${scenario.directoryRoute}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      `Lane: CASHIER`,
      `Tagged full name: ${scenario.fullName}`,
      `Tagged email: ${scenario.email}`,
      `Tagged phone: ${scenario.phone}`,
      `House/Street: ${scenario.line1}`,
      `Province: ${scenario.province.name} [id=${scenario.province.id}]`,
      `Municipality: ${scenario.municipality.name} [id=${scenario.municipality.id}]`,
      `Barangay: ${scenario.barangay.name} [id=${scenario.barangay.id}]`,
      `Deleted previous tagged users: ${deleted.deletedUsers}`,
      `Deleted previous tagged employees: ${deleted.deletedEmployees}`,
      "Next manual QA steps:",
      "1. Open /creation/employees/new as ADMIN.",
      "2. Select CASHIER lane and fill the printed identity and address values.",
      "3. Submit Create Employee Account and confirm the success alert.",
      "4. Open /creation/employees and verify the tagged row plus invite-ready account state.",
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
