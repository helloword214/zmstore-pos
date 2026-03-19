import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { UserRole } from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_ADMIN_EMAIL = "admin@local";

export const EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_FIRST_NAME =
  "QA Manager";
export const EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_LAST_NAME =
  "Onboarding";
export const EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_EMAIL =
  "qa.employee.onboarding.manager@local";
export const EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_PHONE =
  "09991234013";
export const EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_LINE1 =
  "789 QA Manager Street";

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

export function resolveEmployeeOnboardingStoreManagerHappyPathAdminEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_ADMIN_EMAIL ??
      process.env.UI_ADMIN_EMAIL ??
      DEFAULT_ADMIN_EMAIL,
  );
}

export function resolveEmployeeOnboardingStoreManagerHappyPathEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_EMAIL ??
      EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_EMAIL,
  );
}

export function resolveEmployeeOnboardingStoreManagerHappyPathPhone() {
  return (
    process.env.QA_EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_PHONE ??
    EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_PHONE
  ).trim();
}

export function resolveEmployeeOnboardingStoreManagerHappyPathFirstName() {
  return (
    process.env.QA_EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_FIRST_NAME ??
    EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_FIRST_NAME
  ).trim();
}

export function resolveEmployeeOnboardingStoreManagerHappyPathLastName() {
  return (
    process.env.QA_EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_LAST_NAME ??
    EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_LAST_NAME
  ).trim();
}

export function resolveEmployeeOnboardingStoreManagerHappyPathLine1() {
  return (
    process.env.QA_EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_LINE1 ??
    EMPLOYEE_ONBOARDING_STORE_MANAGER_HAPPY_PATH_DEFAULT_LINE1
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
      `Employee onboarding store manager happy path requires an active ADMIN account: ${email}`,
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
      "Employee onboarding store manager happy path requires at least one branch for default user assignment.",
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
    "Employee onboarding store manager happy path requires one active province/municipality/barangay chain.",
  );
}

export async function deleteEmployeeOnboardingStoreManagerHappyPathArtifacts(): Promise<DeleteSummary> {
  const email = resolveEmployeeOnboardingStoreManagerHappyPathEmail();
  const phone = resolveEmployeeOnboardingStoreManagerHappyPathPhone();

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

export async function resetEmployeeOnboardingStoreManagerHappyPathState() {
  const deleted = await deleteEmployeeOnboardingStoreManagerHappyPathArtifacts();
  const admin = await resolveAdminUser(
    resolveEmployeeOnboardingStoreManagerHappyPathAdminEmail(),
  );

  return { admin, deleted };
}

export async function resolveEmployeeOnboardingStoreManagerHappyPathScenarioContext(): Promise<ScenarioContext> {
  const [admin, defaultBranch, addressChain] = await Promise.all([
    resolveAdminUser(resolveEmployeeOnboardingStoreManagerHappyPathAdminEmail()),
    resolveDefaultBranch(),
    resolveAddressChain(),
  ]);

  const firstName = resolveEmployeeOnboardingStoreManagerHappyPathFirstName();
  const lastName = resolveEmployeeOnboardingStoreManagerHappyPathLastName();

  return {
    admin,
    barangay: addressChain.barangay,
    createRoute: "/creation/employees/new",
    defaultBranch,
    directoryRoute: "/creation/employees",
    email: resolveEmployeeOnboardingStoreManagerHappyPathEmail(),
    firstName,
    fullName: `${firstName} ${lastName}`.trim(),
    lastName,
    line1: resolveEmployeeOnboardingStoreManagerHappyPathLine1(),
    municipality: addressChain.municipality,
    phone: resolveEmployeeOnboardingStoreManagerHappyPathPhone(),
    province: addressChain.province,
  };
}

async function main() {
  const { deleted, admin } =
    await resetEmployeeOnboardingStoreManagerHappyPathState();
  const scenario =
    await resolveEmployeeOnboardingStoreManagerHappyPathScenarioContext();

  console.log(
    [
      "Employee onboarding store manager happy path setup is ready.",
      `Admin: ${admin.email ?? `user#${admin.id}`} [userId=${admin.id}]`,
      `Create route: ${scenario.createRoute}`,
      `Directory route: ${scenario.directoryRoute}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      "Lane: STORE_MANAGER",
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
      "2. Select STORE_MANAGER (staff) and fill the printed identity and address values.",
      "3. Submit Create Employee Account and confirm the success alert.",
      "4. Open /creation/employees and verify the tagged manager row plus protected-lane state.",
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

