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

export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_FIRST_NAME =
  "QA Edit";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_MIDDLE_NAME =
  "Rider";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_LAST_NAME =
  "Profile";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_ALIAS =
  "QARiderOld";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_EMAIL =
  "qa.employee.profile-edit.rider@local";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_PHONE =
  "09991234021";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_LINE1 =
  "110 Initial Rider Profile Street";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_LICENSE_NUMBER =
  "N03-29-120001";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_LICENSE_EXPIRY =
  "2029-01-31";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_SSS_NUMBER =
  "12-3456789-0";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_PAG_IBIG_NUMBER =
  "1234-5678-9012";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_FIRST_NAME =
  "QA Edited";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_MIDDLE_NAME =
  "Access";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LAST_NAME =
  "Rider";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_ALIAS =
  "QARiderUpdated";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_EMAIL =
  "qa.employee.profile-edit.updated.rider@local";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_PHONE =
  "09991234022";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LINE1 =
  "220 Updated Rider Profile Avenue";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_PUROK =
  "Purok 7";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_POSTAL_CODE =
  "6001";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LANDMARK =
  "QA Loading Bay";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LICENSE_NUMBER =
  "N03-31-789456";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LICENSE_EXPIRY =
  "2031-11-30";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_SSS_NUMBER =
  "98-7654321-0";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_PAG_IBIG_NUMBER =
  "9012-3456-7890";
export const EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_REASON =
  "INITIAL_CREATE_BY_ADMIN";

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

type VehicleOption = {
  id: number;
  label: string;
  name: string;
  type: string;
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

export type EmployeeProfileEditHappyPathScenarioContext = {
  admin: AdminUser;
  barangay: ReferenceOption;
  defaultBranch: ReferenceOption;
  directoryRoute: string;
  editRoute: string;
  employeeId: number;
  initial: {
    alias: string;
    email: string;
    firstName: string;
    fullName: string;
    lastName: string;
    licenseExpiryInput: string;
    licenseNumber: string;
    line1: string;
    middleName: string;
    pagIbigNumber: string;
    phone: string;
    sssNumber: string;
  };
  municipality: ReferenceOption;
  province: ReferenceOption;
  updated: {
    alias: string;
    email: string;
    firstName: string;
    fullName: string;
    landmark: string;
    lastName: string;
    licenseExpiryInput: string;
    licenseNumber: string;
    line1: string;
    middleName: string;
    pagIbigNumber: string;
    phone: string;
    postalCode: string;
    purok: string;
    sssNumber: string;
  };
  vehicle: VehicleOption;
};

function isMainModule() {
  return Boolean(process.argv[1]) &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function resolveEmployeeProfileEditHappyPathAdminEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_ADMIN_EMAIL ??
      process.env.UI_ADMIN_EMAIL ??
      DEFAULT_ADMIN_EMAIL,
  );
}

export function resolveEmployeeProfileEditHappyPathInitialEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_EMAIL ??
      EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_EMAIL,
  );
}

export function resolveEmployeeProfileEditHappyPathUpdatedEmail() {
  return normalizeEmail(
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_EMAIL ??
      EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_EMAIL,
  );
}

export function resolveEmployeeProfileEditHappyPathInitialPhone() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_PHONE ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_PHONE
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedPhone() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_PHONE ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_PHONE
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialFirstName() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_FIRST_NAME ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_FIRST_NAME
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialMiddleName() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_MIDDLE_NAME ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_MIDDLE_NAME
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialLastName() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_LAST_NAME ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_LAST_NAME
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialAlias() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_ALIAS ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_ALIAS
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialLine1() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_LINE1 ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_LINE1
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialLicenseNumber() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_LICENSE_NUMBER ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_LICENSE_NUMBER
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialLicenseExpiryInput() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_LICENSE_EXPIRY ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_LICENSE_EXPIRY
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialSssNumber() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_SSS_NUMBER ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_SSS_NUMBER
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialPagIbigNumber() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_PAG_IBIG_NUMBER ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_INITIAL_PAG_IBIG_NUMBER
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedFirstName() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_FIRST_NAME ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_FIRST_NAME
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedMiddleName() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_MIDDLE_NAME ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_MIDDLE_NAME
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedLastName() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_LAST_NAME ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LAST_NAME
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedAlias() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_ALIAS ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_ALIAS
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedLine1() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_LINE1 ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LINE1
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedPurok() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_PUROK ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_PUROK
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedPostalCode() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_POSTAL_CODE ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_POSTAL_CODE
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedLandmark() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_LANDMARK ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LANDMARK
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedLicenseNumber() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_LICENSE_NUMBER ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LICENSE_NUMBER
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedLicenseExpiryInput() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_LICENSE_EXPIRY ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_LICENSE_EXPIRY
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedSssNumber() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_SSS_NUMBER ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_SSS_NUMBER
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathUpdatedPagIbigNumber() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_UPDATED_PAG_IBIG_NUMBER ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_DEFAULT_UPDATED_PAG_IBIG_NUMBER
  ).trim();
}

export function resolveEmployeeProfileEditHappyPathInitialReason() {
  return (
    process.env.QA_EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_REASON ??
    EMPLOYEE_PROFILE_EDIT_HAPPY_PATH_INITIAL_REASON
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
      `Employee profile edit happy path requires an active ADMIN account: ${email}`,
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
      "Employee profile edit happy path requires at least one branch for default user assignment.",
    );
  }

  return branch;
}

async function resolveActiveVehicle(): Promise<VehicleOption> {
  const vehicle = await db.vehicle.findFirst({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
    },
  });

  if (!vehicle) {
    throw new Error(
      "Employee profile edit happy path requires at least one active vehicle.",
    );
  }

  return {
    id: vehicle.id,
    label: `${vehicle.name} (${vehicle.type})`,
    name: vehicle.name,
    type: String(vehicle.type),
  };
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
    "Employee profile edit happy path requires one active province/municipality/barangay chain.",
  );
}

async function resolveSeededEmployeeOrThrow() {
  const user = await db.user.findFirst({
    where: {
      email: {
        in: [
          resolveEmployeeProfileEditHappyPathInitialEmail(),
          resolveEmployeeProfileEditHappyPathUpdatedEmail(),
        ],
      },
    },
    select: {
      id: true,
      employeeId: true,
    },
    orderBy: { id: "desc" },
  });

  if (!user?.employeeId) {
    throw new Error(
      "Employee profile edit happy path could not resolve the seeded user/employee pair.",
    );
  }

  return {
    employeeId: user.employeeId,
    userId: user.id,
  };
}

export async function deleteEmployeeProfileEditHappyPathArtifacts(): Promise<DeleteSummary> {
  const emails = Array.from(
    new Set([
      resolveEmployeeProfileEditHappyPathInitialEmail(),
      resolveEmployeeProfileEditHappyPathUpdatedEmail(),
    ]),
  );
  const phones = Array.from(
    new Set([
      resolveEmployeeProfileEditHappyPathInitialPhone(),
      resolveEmployeeProfileEditHappyPathUpdatedPhone(),
    ]),
  );

  const deletedUsers = await db.user.deleteMany({
    where: { email: { in: emails } },
  });

  const deletedEmployees = await db.employee.deleteMany({
    where: {
      OR: [{ email: { in: emails } }, { phone: { in: phones } }],
    },
  });

  return {
    deletedEmployees: deletedEmployees.count,
    deletedUsers: deletedUsers.count,
  };
}

async function seedEmployeeProfileEditHappyPathState(
  admin: AdminUser,
): Promise<SeedSummary> {
  const [defaultBranch, addressChain] = await Promise.all([
    resolveDefaultBranch(),
    resolveAddressChain(),
  ]);

  const email = resolveEmployeeProfileEditHappyPathInitialEmail();
  const phone = resolveEmployeeProfileEditHappyPathInitialPhone();
  const firstName = resolveEmployeeProfileEditHappyPathInitialFirstName();
  const middleName = resolveEmployeeProfileEditHappyPathInitialMiddleName();
  const lastName = resolveEmployeeProfileEditHappyPathInitialLastName();
  const alias = resolveEmployeeProfileEditHappyPathInitialAlias();
  const line1 = resolveEmployeeProfileEditHappyPathInitialLine1();
  const licenseNumber =
    resolveEmployeeProfileEditHappyPathInitialLicenseNumber();
  const licenseExpiry = new Date(
    resolveEmployeeProfileEditHappyPathInitialLicenseExpiryInput(),
  );
  const sssNumber = resolveEmployeeProfileEditHappyPathInitialSssNumber();
  const pagIbigNumber =
    resolveEmployeeProfileEditHappyPathInitialPagIbigNumber();
  const initialReason = resolveEmployeeProfileEditHappyPathInitialReason();

  return db.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        firstName,
        middleName,
        lastName,
        alias,
        birthDate: new Date("1996-08-15"),
        phone,
        email,
        sssNumber,
        pagIbigNumber,
        role: EmployeeRole.RIDER,
        active: true,
        defaultVehicleId: null,
        licenseNumber,
        licenseExpiry,
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
        role: UserRole.EMPLOYEE,
        managerKind: null,
        employeeId: employee.id,
        active: true,
        authState: UserAuthState.ACTIVE,
        passwordHash: "qa-profile-edit-password-hash",
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
        role: UserRole.EMPLOYEE,
        reason: initialReason,
        changedById: admin.id,
      },
    });

    await tx.userRoleAuditEvent.create({
      data: {
        userId: user.id,
        beforeRole: UserRole.EMPLOYEE,
        afterRole: UserRole.EMPLOYEE,
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

export async function resetEmployeeProfileEditHappyPathState() {
  const deleted = await deleteEmployeeProfileEditHappyPathArtifacts();
  const admin = await resolveAdminUser(
    resolveEmployeeProfileEditHappyPathAdminEmail(),
  );
  const seeded = await seedEmployeeProfileEditHappyPathState(admin);

  return { admin, deleted, seeded };
}

export async function resolveEmployeeProfileEditHappyPathScenarioContext(): Promise<EmployeeProfileEditHappyPathScenarioContext> {
  const [admin, defaultBranch, addressChain, vehicle, seeded] =
    await Promise.all([
      resolveAdminUser(resolveEmployeeProfileEditHappyPathAdminEmail()),
      resolveDefaultBranch(),
      resolveAddressChain(),
      resolveActiveVehicle(),
      resolveSeededEmployeeOrThrow(),
    ]);

  const initialFirstName = resolveEmployeeProfileEditHappyPathInitialFirstName();
  const initialLastName = resolveEmployeeProfileEditHappyPathInitialLastName();
  const updatedFirstName = resolveEmployeeProfileEditHappyPathUpdatedFirstName();
  const updatedLastName = resolveEmployeeProfileEditHappyPathUpdatedLastName();

  return {
    admin,
    barangay: addressChain.barangay,
    defaultBranch,
    directoryRoute: "/creation/employees",
    editRoute: `/creation/employees/${seeded.employeeId}/edit`,
    employeeId: seeded.employeeId,
    initial: {
      alias: resolveEmployeeProfileEditHappyPathInitialAlias(),
      email: resolveEmployeeProfileEditHappyPathInitialEmail(),
      firstName: initialFirstName,
      fullName: `${initialFirstName} ${initialLastName}`.trim(),
      lastName: initialLastName,
      licenseExpiryInput:
        resolveEmployeeProfileEditHappyPathInitialLicenseExpiryInput(),
      licenseNumber: resolveEmployeeProfileEditHappyPathInitialLicenseNumber(),
      line1: resolveEmployeeProfileEditHappyPathInitialLine1(),
      middleName: resolveEmployeeProfileEditHappyPathInitialMiddleName(),
      pagIbigNumber:
        resolveEmployeeProfileEditHappyPathInitialPagIbigNumber(),
      phone: resolveEmployeeProfileEditHappyPathInitialPhone(),
      sssNumber: resolveEmployeeProfileEditHappyPathInitialSssNumber(),
    },
    municipality: addressChain.municipality,
    province: addressChain.province,
    updated: {
      alias: resolveEmployeeProfileEditHappyPathUpdatedAlias(),
      email: resolveEmployeeProfileEditHappyPathUpdatedEmail(),
      firstName: updatedFirstName,
      fullName: `${updatedFirstName} ${updatedLastName}`.trim(),
      landmark: resolveEmployeeProfileEditHappyPathUpdatedLandmark(),
      lastName: updatedLastName,
      licenseExpiryInput:
        resolveEmployeeProfileEditHappyPathUpdatedLicenseExpiryInput(),
      licenseNumber: resolveEmployeeProfileEditHappyPathUpdatedLicenseNumber(),
      line1: resolveEmployeeProfileEditHappyPathUpdatedLine1(),
      middleName: resolveEmployeeProfileEditHappyPathUpdatedMiddleName(),
      pagIbigNumber:
        resolveEmployeeProfileEditHappyPathUpdatedPagIbigNumber(),
      phone: resolveEmployeeProfileEditHappyPathUpdatedPhone(),
      postalCode: resolveEmployeeProfileEditHappyPathUpdatedPostalCode(),
      purok: resolveEmployeeProfileEditHappyPathUpdatedPurok(),
      sssNumber: resolveEmployeeProfileEditHappyPathUpdatedSssNumber(),
    },
    vehicle,
  };
}

async function main() {
  const { admin, deleted, seeded } =
    await resetEmployeeProfileEditHappyPathState();
  const scenario = await resolveEmployeeProfileEditHappyPathScenarioContext();

  console.log(
    [
      "Employee profile edit happy path setup is ready.",
      `Admin: ${admin.email ?? `user#${admin.id}`} [userId=${admin.id}]`,
      `Edit route: ${scenario.editRoute}`,
      `Directory route: ${scenario.directoryRoute}`,
      `Default branch: ${scenario.defaultBranch.name} [id=${scenario.defaultBranch.id}]`,
      "Seeded lane: RIDER",
      `Initial full name: ${scenario.initial.fullName}`,
      `Initial email: ${scenario.initial.email}`,
      `Initial phone: ${scenario.initial.phone}`,
      `Initial line1: ${scenario.initial.line1}`,
      `Updated full name: ${scenario.updated.fullName}`,
      `Updated email: ${scenario.updated.email}`,
      `Updated phone: ${scenario.updated.phone}`,
      `Updated line1: ${scenario.updated.line1}`,
      `Updated vehicle: ${scenario.vehicle.label} [id=${scenario.vehicle.id}]`,
      `Seeded userId: ${seeded.userId}`,
      `Seeded employeeId: ${seeded.employeeId}`,
      `Province: ${scenario.province.name} [id=${scenario.province.id}]`,
      `Municipality: ${scenario.municipality.name} [id=${scenario.municipality.id}]`,
      `Barangay: ${scenario.barangay.name} [id=${scenario.barangay.id}]`,
      `Deleted previous tagged users: ${deleted.deletedUsers}`,
      `Deleted previous tagged employees: ${deleted.deletedEmployees}`,
      "Next manual QA steps:",
      "1. Open the printed edit route as ADMIN.",
      "2. Replace the printed rider profile fields with the updated values.",
      "3. Save Employee Profile and confirm the success alert.",
      "4. Open the directory route and confirm the tagged row reflects the updated identity and address values.",
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
