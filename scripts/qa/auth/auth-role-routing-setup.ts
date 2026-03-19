import "dotenv/config";

import { EmployeeRole } from "@prisma/client";
import { db } from "~/utils/db.server";
import type { Role } from "~/utils/auth.server";

type RoleRoutingAccount = {
  label: string;
  role: Role;
  emailEnvKey: string;
  fallbackEmail: string;
  expectedHomePath: string;
};

const ROLE_ROUTING_ACCOUNTS: RoleRoutingAccount[] = [
  {
    label: "admin",
    role: "ADMIN",
    emailEnvKey: "UI_ADMIN_EMAIL",
    fallbackEmail: "admin@local",
    expectedHomePath: "/",
  },
  {
    label: "manager",
    role: "STORE_MANAGER",
    emailEnvKey: "UI_MANAGER_EMAIL",
    fallbackEmail: "manager1@local",
    expectedHomePath: "/store",
  },
  {
    label: "cashier",
    role: "CASHIER",
    emailEnvKey: "UI_CASHIER_EMAIL",
    fallbackEmail: "cashier1@local",
    expectedHomePath: "/cashier",
  },
  {
    label: "rider",
    role: "EMPLOYEE",
    emailEnvKey: "UI_RIDER_EMAIL",
    fallbackEmail: "rider1@local",
    expectedHomePath: "/rider",
  },
];

function resolveEmail(config: RoleRoutingAccount) {
  return (process.env[config.emailEnvKey] ?? config.fallbackEmail).trim().toLowerCase();
}

async function assertRoleRoutingAccount(config: RoleRoutingAccount) {
  const email = resolveEmail(config);
  const user = await db.user.findUnique({
    where: { email },
    include: { employee: true },
  });

  if (!user || !user.active || user.role !== config.role) {
    throw new Error(
      `Auth role routing setup requires an active ${config.role} account: ${email}`,
    );
  }

  if (config.role === "EMPLOYEE") {
    if (!user.employee || user.employee.role !== EmployeeRole.RIDER) {
      throw new Error(
        `Auth role routing setup requires the employee account to be linked to a RIDER profile: ${email}`,
      );
    }
  }

  return {
    label: config.label,
    email,
    role: user.role,
    expectedHomePath: config.expectedHomePath,
  };
}

async function main() {
  const verifiedAccounts = [];

  for (const config of ROLE_ROUTING_ACCOUNTS) {
    verifiedAccounts.push(await assertRoleRoutingAccount(config));
  }

  const lines = [
    "Auth role routing setup is ready.",
    "Verified seeded role accounts for admin, manager, cashier, and rider routing.",
    "Expected homes:",
  ];

  for (const account of verifiedAccounts) {
    lines.push(
      `${account.label}: ${account.email} (${account.role}) -> ${account.expectedHomePath}`,
    );
  }

  console.log(lines.join("\n"));
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Unknown auth role routing setup error.",
    );
    throw error;
  })
  .finally(async () => {
    await db.$disconnect();
  });
