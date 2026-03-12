import { compare, hash } from "bcryptjs";
import { LoginRateLimitScope } from "@prisma/client";
import { randomInt } from "node:crypto";
import { db } from "~/utils/db.server";

export const LOGIN_OTP_EXPIRES_MINUTES = 5;
export const LOGIN_OTP_MAX_ATTEMPTS = 5;
export const LOGIN_OTP_MAX_SENDS = 3;
export const LOGIN_OTP_RESEND_COOLDOWN_SECONDS = 60;

const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_BLOCK_MINUTES = 15;
const EMAIL_MAX_FAILURES = 8;
const IP_MAX_FAILURES = 25;

type LoginGuardInput = {
  email: string;
  ip: string | null;
  now?: Date;
};

type VerifyLoginOtpInput = {
  challengeId: number;
  userId: number;
  code: string;
  requestIp: string | null;
  userAgent: string | null;
  now?: Date;
};

type OtpChallengeEnvelope = {
  challengeId: number;
  otpCode: string;
  expiresAt: Date;
};

type OtpResendResult =
  | { ok: true; challengeId: number; otpCode: string; expiresAt: Date }
  | { ok: false; reason: "NOT_FOUND" | "COOLDOWN" | "MAX_SENDS"; retryAfterSeconds?: number };

type VerifyLoginOtpResult =
  | { ok: true; userId: number }
  | {
      ok: false;
      reason: "NOT_FOUND_OR_EXPIRED" | "INVALID_CODE" | "TOO_MANY_ATTEMPTS";
      attemptsLeft?: number;
    };

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function secondsUntil(target: Date, now: Date) {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

function isBlockedUntil(blockedUntil: Date | null | undefined, now: Date) {
  return Boolean(blockedUntil && blockedUntil.getTime() > now.getTime());
}

function normalizeRateKey(input: string) {
  return input.trim().toLowerCase();
}

async function applyFailure(args: {
  scope: LoginRateLimitScope;
  scopeKey: string;
  maxFailures: number;
  now: Date;
}) {
  const existing = await db.loginRateLimitState.findUnique({
    where: {
      scope_scopeKey: {
        scope: args.scope,
        scopeKey: args.scopeKey,
      },
    },
    select: {
      id: true,
      failCount: true,
      firstFailedAt: true,
      blockedUntil: true,
    },
  });

  if (!existing) {
    const blockedUntil = args.maxFailures <= 1 ? addMinutes(args.now, LOGIN_BLOCK_MINUTES) : null;
    await db.loginRateLimitState.create({
      data: {
        scope: args.scope,
        scopeKey: args.scopeKey,
        failCount: 1,
        firstFailedAt: args.now,
        lastFailedAt: args.now,
        blockedUntil,
      },
    });
    return;
  }

  const windowStart = addMinutes(args.now, -LOGIN_WINDOW_MINUTES);
  const withinWindow = Boolean(
    existing.firstFailedAt && existing.firstFailedAt.getTime() > windowStart.getTime(),
  );
  const nextFailCount = withinWindow ? existing.failCount + 1 : 1;

  const nextBlockedUntil =
    nextFailCount >= args.maxFailures
      ? addMinutes(args.now, LOGIN_BLOCK_MINUTES)
      : isBlockedUntil(existing.blockedUntil, args.now)
        ? existing.blockedUntil
        : null;

  await db.loginRateLimitState.update({
    where: { id: existing.id },
    data: {
      failCount: nextFailCount,
      firstFailedAt: withinWindow ? existing.firstFailedAt : args.now,
      lastFailedAt: args.now,
      blockedUntil: nextBlockedUntil,
    },
  });
}

export function normalizeEmail(input: string) {
  return input.trim().toLowerCase();
}

export function requestIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const value = xff.split(",")[0]?.trim();
    if (value) return value;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || null;
}

export function maskEmail(email: string) {
  const normalized = normalizeEmail(email);
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return normalized;

  const visibleLocal = local.slice(0, 2);
  const localMask = "*".repeat(Math.max(1, local.length - 2));
  const domainParts = domain.split(".");
  if (domainParts.length < 2) {
    return `${visibleLocal}${localMask}@${domain}`;
  }

  const tld = domainParts.pop() as string;
  const host = domainParts.join(".");
  const visibleHost = host.slice(0, 1);
  const hostMask = "*".repeat(Math.max(1, host.length - 1));
  return `${visibleLocal}${localMask}@${visibleHost}${hostMask}.${tld}`;
}

export async function checkLoginThrottle(input: LoginGuardInput) {
  const now = input.now ?? new Date();
  const emailKey = normalizeRateKey(input.email);
  const ipKey = input.ip ? normalizeRateKey(input.ip) : null;

  const states = await db.loginRateLimitState.findMany({
    where: {
      OR: [
        { scope: LoginRateLimitScope.EMAIL, scopeKey: emailKey },
        ...(ipKey ? [{ scope: LoginRateLimitScope.IP, scopeKey: ipKey }] : []),
      ],
    },
    select: {
      scope: true,
      blockedUntil: true,
    },
  });

  let retryAfterSeconds = 0;
  for (const state of states) {
    if (isBlockedUntil(state.blockedUntil, now)) {
      retryAfterSeconds = Math.max(retryAfterSeconds, secondsUntil(state.blockedUntil as Date, now));
    }
  }

  return {
    blocked: retryAfterSeconds > 0,
    retryAfterSeconds,
  };
}

export async function registerAuthFailure(input: LoginGuardInput) {
  const now = input.now ?? new Date();
  const emailKey = normalizeRateKey(input.email);
  await applyFailure({
    scope: LoginRateLimitScope.EMAIL,
    scopeKey: emailKey,
    maxFailures: EMAIL_MAX_FAILURES,
    now,
  });

  if (input.ip) {
    await applyFailure({
      scope: LoginRateLimitScope.IP,
      scopeKey: normalizeRateKey(input.ip),
      maxFailures: IP_MAX_FAILURES,
      now,
    });
  }
}

export async function clearAuthFailureState(input: { email: string; ip: string | null }) {
  const keys = [
    { scope: LoginRateLimitScope.EMAIL, scopeKey: normalizeRateKey(input.email) },
    ...(input.ip
      ? [{ scope: LoginRateLimitScope.IP, scopeKey: normalizeRateKey(input.ip) }]
      : []),
  ];

  await db.$transaction(
    keys.map((key) =>
      db.loginRateLimitState.updateMany({
        where: key,
        data: {
          failCount: 0,
          firstFailedAt: null,
          lastFailedAt: null,
          blockedUntil: null,
        },
      }),
    ),
  );
}

export function isOtpCodeFormat(input: string) {
  return /^\d{6}$/.test(input);
}

export function generateOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function issueLoginOtpChallenge(args: {
  userId: number;
  requestIp: string | null;
  userAgent: string | null;
  now?: Date;
}): Promise<OtpChallengeEnvelope> {
  const now = args.now ?? new Date();
  const otpCode = generateOtpCode();
  const codeHash = await hash(otpCode, 10);
  const expiresAt = addMinutes(now, LOGIN_OTP_EXPIRES_MINUTES);

  const created = await db.$transaction(async (tx) => {
    await tx.loginOtpChallenge.updateMany({
      where: {
        userId: args.userId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });

    return tx.loginOtpChallenge.create({
      data: {
        userId: args.userId,
        codeHash,
        expiresAt,
        requestedIp: args.requestIp,
        requestedUserAgent: args.userAgent,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });
  });

  return {
    challengeId: created.id,
    otpCode,
    expiresAt: created.expiresAt,
  };
}

export async function getActiveLoginOtpChallenge(args: {
  challengeId: number;
  userId: number;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  return db.loginOtpChallenge.findFirst({
    where: {
      id: args.challengeId,
      userId: args.userId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      userId: true,
      codeHash: true,
      expiresAt: true,
      attemptCount: true,
      sendCount: true,
      lastSentAt: true,
      consumedAt: true,
    },
  });
}

export function otpResendRetryAfterSeconds(lastSentAt: Date, now: Date) {
  const readyAt = addSeconds(lastSentAt, LOGIN_OTP_RESEND_COOLDOWN_SECONDS);
  return secondsUntil(readyAt, now);
}

export async function resendLoginOtpChallenge(args: {
  challengeId: number;
  userId: number;
  requestIp: string | null;
  userAgent: string | null;
  now?: Date;
}): Promise<OtpResendResult> {
  const now = args.now ?? new Date();
  const challenge = await getActiveLoginOtpChallenge({
    challengeId: args.challengeId,
    userId: args.userId,
    now,
  });

  if (!challenge) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  if (challenge.sendCount >= LOGIN_OTP_MAX_SENDS) {
    return { ok: false, reason: "MAX_SENDS" };
  }

  const retryAfterSeconds = otpResendRetryAfterSeconds(challenge.lastSentAt, now);
  if (retryAfterSeconds > 0) {
    return { ok: false, reason: "COOLDOWN", retryAfterSeconds };
  }

  const otpCode = generateOtpCode();
  const codeHash = await hash(otpCode, 10);
  const expiresAt = addMinutes(now, LOGIN_OTP_EXPIRES_MINUTES);

  const updated = await db.loginOtpChallenge.update({
    where: { id: challenge.id },
    data: {
      codeHash,
      sendCount: { increment: 1 },
      lastSentAt: now,
      expiresAt,
      requestedIp: args.requestIp,
      requestedUserAgent: args.userAgent,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  return {
    ok: true,
    challengeId: updated.id,
    otpCode,
    expiresAt: updated.expiresAt,
  };
}

export async function verifyLoginOtpCode(input: VerifyLoginOtpInput): Promise<VerifyLoginOtpResult> {
  const now = input.now ?? new Date();
  const challenge = await getActiveLoginOtpChallenge({
    challengeId: input.challengeId,
    userId: input.userId,
    now,
  });

  if (!challenge) {
    return { ok: false, reason: "NOT_FOUND_OR_EXPIRED" };
  }

  if (challenge.attemptCount >= LOGIN_OTP_MAX_ATTEMPTS) {
    await db.loginOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        consumedAt: now,
        consumedIp: input.requestIp,
        consumedUserAgent: input.userAgent,
      },
    });
    return { ok: false, reason: "TOO_MANY_ATTEMPTS", attemptsLeft: 0 };
  }

  const valid = await compare(input.code, challenge.codeHash);
  if (!valid) {
    const nextAttempt = challenge.attemptCount + 1;
    const exhausted = nextAttempt >= LOGIN_OTP_MAX_ATTEMPTS;
    await db.loginOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        attemptCount: { increment: 1 },
        consumedAt: exhausted ? now : undefined,
        consumedIp: exhausted ? input.requestIp : undefined,
        consumedUserAgent: exhausted ? input.userAgent : undefined,
      },
    });
    return {
      ok: false,
      reason: exhausted ? "TOO_MANY_ATTEMPTS" : "INVALID_CODE",
      attemptsLeft: Math.max(0, LOGIN_OTP_MAX_ATTEMPTS - nextAttempt),
    };
  }

  await db.$transaction(async (tx) => {
    await tx.loginOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        consumedAt: now,
        consumedIp: input.requestIp,
        consumedUserAgent: input.userAgent,
      },
    });

    await tx.loginOtpChallenge.updateMany({
      where: {
        userId: challenge.userId,
        consumedAt: null,
        expiresAt: { gt: now },
        id: { not: challenge.id },
      },
      data: {
        consumedAt: now,
      },
    });
  });

  return { ok: true, userId: challenge.userId };
}
