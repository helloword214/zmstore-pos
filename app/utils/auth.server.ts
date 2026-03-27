import { createCookieSessionStorage, redirect } from "@remix-run/node";
import { db } from "~/utils/db.server";
import type { CashierShift } from "@prisma/client";

// ───────────────────────────────────────────────────────────
// Dedicated auth cookie (separate from cart_session)
// ───────────────────────────────────────────────────────────
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set in your .env");
}

export const authStorage = createCookieSessionStorage({
  cookie: {
    name: "pos_session",
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    maxAge: 60 * 60 * 12, // 12h login TTL
    secrets: [sessionSecret],
  },
});

const trustedLoginStorage = createCookieSessionStorage({
  cookie: {
    name: "pos_trusted_login",
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365 * 5, // persistent trusted-device marker
    secrets: [sessionSecret],
  },
});

export type Role = "ADMIN" | "STORE_MANAGER" | "CASHIER" | "EMPLOYEE";

export type SessionUser = {
  userId: number;
  role: Role;
  branchIds: number[];
  shiftId?: number | null;
};

export type PendingLoginState = {
  userId: number;
  challengeId: number;
  email: string;
};

function trustedLoginKey(userId: number) {
  return `trustedLoginUser:${userId}`;
}

function safeNext(raw: string | null | undefined, fallback = "/cashier") {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

export function homePathFor(role: Role): string {
  if (role === "ADMIN") return "/";
  if (role === "STORE_MANAGER") return "/store";
  if (role === "CASHIER") return "/cashier";
  // EMPLOYEE → frontline dashboard (seller + rider tools)
  if (role === "EMPLOYEE") return "/rider";
  return "/";
}

export async function getAuthSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  return authStorage.getSession(cookie);
}

async function getTrustedLoginSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  return trustedLoginStorage.getSession(cookie);
}

function parsePositiveInt(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
    return null;
  }
  return value;
}

function clearPendingKeys(session: Awaited<ReturnType<typeof getAuthSession>>) {
  session.unset("loginPendingUserId");
  session.unset("loginChallengeId");
  session.unset("loginPendingEmail");
}

export async function getPendingLogin(request: Request): Promise<PendingLoginState | null> {
  const session = await getAuthSession(request);
  const userId = parsePositiveInt(session.get("loginPendingUserId"));
  const challengeId = parsePositiveInt(session.get("loginChallengeId"));
  const emailRaw = session.get("loginPendingEmail");
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  if (!userId || !challengeId || !email) return null;
  return { userId, challengeId, email };
}

export async function setPendingLogin(request: Request, pending: PendingLoginState) {
  const session = await getAuthSession(request);
  // Pending login is anonymous until OTP is verified.
  session.unset("userId");
  session.unset("role");
  session.unset("branchIds");
  session.unset("shiftId");
  session.set("loginPendingUserId", pending.userId);
  session.set("loginChallengeId", pending.challengeId);
  session.set("loginPendingEmail", pending.email);
  return {
    headers: { "Set-Cookie": await authStorage.commitSession(session) },
  };
}

export async function clearPendingLogin(request: Request) {
  const session = await getAuthSession(request);
  clearPendingKeys(session);
  return {
    headers: { "Set-Cookie": await authStorage.commitSession(session) },
  };
}

export async function getUser(request: Request): Promise<SessionUser | null> {
  const session = await getAuthSession(request);
  const userId = session.get("userId") as number | undefined;
  const role = session.get("role") as Role | undefined;
  const branchIds = (session.get("branchIds") as number[] | undefined) ?? [];
  const shiftId = (session.get("shiftId") as number | null | undefined) ?? null;
  if (!userId || !role) return null;
  return { userId, role, branchIds, shiftId };
}

export async function isTrustedLoginDevice(
  request: Request,
  input: { userId: number; authVersion: number },
) {
  const session = await getTrustedLoginSession(request);
  const trustedAuthVersion = parsePositiveInt(session.get(trustedLoginKey(input.userId)));
  return trustedAuthVersion === input.authVersion;
}

export async function trustLoginDevice(
  request: Request,
  input: { userId: number; authVersion: number },
) {
  const session = await getTrustedLoginSession(request);
  session.set(trustedLoginKey(input.userId), input.authVersion);
  const setCookie = await trustedLoginStorage.commitSession(session);
  return {
    headers: { "Set-Cookie": setCookie },
    setCookie,
  };
}

export async function createUserSession(request: Request, userId: number) {
  const user = await db.user.findUnique({
    where: { id: userId },
    // Use branches (UserBranch). We only need the ids.
    include: { branches: true },
  });
  if (!user || !user.active) throw redirect("/login");

  // Best-effort login timestamp (non-blocking)
  void db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const session = await getAuthSession(request);
  clearPendingKeys(session);
  session.set("userId", user.id);
  session.set("role", user.role as Role); // now also supports STORE_MANAGER
  session.set(
    "branchIds",
    (user.branches ?? []).map((b) => b.branchId),
  );
  // shiftId is set/cleared by cashier open/close shift flows
  const setCookie = await authStorage.commitSession(session);
  return {
    headers: { "Set-Cookie": setCookie },
    setCookie,
    user: {
      userId: user.id,
      role: user.role as Role,
      branchIds: (user.branches ?? []).map((b) => b.branchId),
      shiftId: null,
      authVersion: user.authVersion,
    },
  };
}

export async function logout(request: Request) {
  const session = await getAuthSession(request);
  return redirect("/login", {
    headers: { "Set-Cookie": await authStorage.destroySession(session) },
  });
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  return user;
}

export async function requireRole(
  request: Request,
  allowed: Role[],
): Promise<SessionUser> {
  const user = await requireUser(request);
  if (!allowed.includes(user.role)) {
    throw redirect(homePathFor(user.role));
  }
  return user;
}

export async function requireOpenShift(
  request: Request,
  opts?: { next?: string | null },
): Promise<SessionUser> {
  const user = await requireRole(request, ["CASHIER"]);

  const session = await getAuthSession(request);
  const url = new URL(request.url);
  const next = safeNext(opts?.next ?? url.searchParams.get("next"), "/cashier");
  const raw = session.get("shiftId");
  const shiftId = Number(raw);

  const redirectNeedShift = async () => {
    throw redirect(`/cashier?needShift=1&next=${encodeURIComponent(next)}`, {
      headers: { "Set-Cookie": await authStorage.commitSession(session) },
    });
  };

  // ✅ helper: if DB has an open shift for this cashier, restore cookie and retry page
  const resumeIfOpenShiftExists = async () => {
    const open = await db.cashierShift.findFirst({
      where: { cashierId: user.userId, closedAt: null },
      select: { id: true },
      orderBy: { openedAt: "desc" },
    });
    if (!open) return false;
    session.set("shiftId", open.id);
    // Redirect back to same URL so caller doesn't need to handle headers
    throw redirect(url.pathname + url.search, {
      headers: { "Set-Cookie": await authStorage.commitSession(session) },
    });
  };

  // ❗ Guard: old builds stored Date.now() (13 digits) → won't fit INT4
  const invalid =
    !Number.isFinite(shiftId) ||
    Math.floor(shiftId) !== shiftId ||
    shiftId <= 0 ||
    shiftId > 2147483647;
  if (invalid) {
    session.unset("shiftId");
    // If shift is actually still open in DB, restore it first.
    await resumeIfOpenShiftExists();
    // Otherwise clear bad cookie then send user to dashboard lane (no money access)
    await redirectNeedShift();
  }
  if (!shiftId) {
    // ✅ logout/login lost cookie: try to resume the open shift row
    await resumeIfOpenShiftExists();
    await redirectNeedShift();
  }
  // Ensure the shift row actually exists and is still open for this cashier
  const shift = await db.cashierShift.findFirst({
    where: { id: shiftId, cashierId: user.userId, closedAt: null },
    select: { id: true },
  });
  if (!shift) {
    // Stale cookie → clear then redirect to open
    session.unset("shiftId");
    // ✅ If there is another OPEN shift row (latest), resume it
    await resumeIfOpenShiftExists();
    await redirectNeedShift();
  }
  // expose non-null shiftId to callers
  return { ...user, shiftId } as SessionUser;
}

export async function setShiftId(
  request: Request,
  shiftId: number | null,
): Promise<{ headers: Record<string, string> }> {
  const session = await getAuthSession(request);
  if (shiftId) session.set("shiftId", Number(shiftId)); // ensure integer
  else session.unset("shiftId");
  return {
    headers: { "Set-Cookie": await authStorage.commitSession(session) },
  };
}

/**
 * Convenience: read the currently active shift row (or null).
 */
export async function getActiveShift(
  request: Request,
): Promise<CashierShift | null> {
  const me = await getUser(request);
  if (!me || me.role !== "CASHIER") return null;
  const session = await getAuthSession(request);
  const shiftId = (session.get("shiftId") as number | null) ?? null;
  // If cookie is missing (logout/login), still show the open shift from DB.
  if (!shiftId) {
    return db.cashierShift.findFirst({
      where: { cashierId: me.userId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });
  }
  const cur = await db.cashierShift.findFirst({
    where: { id: shiftId, cashierId: me.userId, closedAt: null },
  });
  if (cur) return cur;
  // Cookie exists but stale → fallback to latest open shift (display-only)
  return db.cashierShift.findFirst({
    where: { cashierId: me.userId, closedAt: null },
    orderBy: { openedAt: "desc" },
  });
}
