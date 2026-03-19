import "dotenv/config";

import { LoginRateLimitScope } from "@prisma/client";
import { db } from "~/utils/db.server";

const DEFAULT_MANAGER_EMAIL = "manager1@local";
const LOCAL_IP_SCOPE_KEYS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"] as const;

function resolveManagerEmail() {
  return (
    process.env.QA_AUTH_LOGIN_OTP_SESSION_MANAGER_EMAIL ??
    process.env.UI_MANAGER_EMAIL ??
    DEFAULT_MANAGER_EMAIL
  )
    .trim()
    .toLowerCase();
}

async function resolveManager(email: string) {
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      active: true,
      role: true,
    },
  });

  if (!user || !user.active || user.role !== "STORE_MANAGER") {
    throw new Error(
      `Auth login OTP session cleanup requires an active STORE_MANAGER account: ${email}`,
    );
  }

  return user;
}

async function clearScenarioState(email: string, userId: number) {
  await db.$transaction([
    db.loginOtpChallenge.deleteMany({
      where: { userId },
    }),
    db.loginRateLimitState.deleteMany({
      where: {
        OR: [
          {
            scope: LoginRateLimitScope.EMAIL,
            scopeKey: email,
          },
          ...LOCAL_IP_SCOPE_KEYS.map((scopeKey) => ({
            scope: LoginRateLimitScope.IP,
            scopeKey,
          })),
        ],
      },
    }),
  ]);
}

async function main() {
  const email = resolveManagerEmail();
  const manager = await resolveManager(email);

  await clearScenarioState(email, manager.id);

  console.log(
    [
      "Auth login OTP session cleanup is complete.",
      `Manager email: ${email}`,
      "Cleared login OTP challenges and email throttle state for this scenario.",
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Unknown auth login OTP session cleanup error.",
    );
    throw error;
  })
  .finally(async () => {
    await db.$disconnect();
  });
