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

export type Role = "ADMIN" | "STORE_MANAGER" | "CASHIER" | "EMPLOYEE";

export type SessionUser = {
  userId: number;
  role: Role;
  branchIds: number[];
  shiftId?: number | null;
};

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

export async function getUser(request: Request): Promise<SessionUser | null> {
  const session = await getAuthSession(request);
  const userId = session.get("userId") as number | undefined;
  const role = session.get("role") as Role | undefined;
  const branchIds = (session.get("branchIds") as number[] | undefined) ?? [];
  const shiftId = (session.get("shiftId") as number | null | undefined) ?? null;
  if (!userId || !role) return null;
  return { userId, role, branchIds, shiftId };
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
  session.set("userId", user.id);
  session.set("role", user.role as Role); // now also supports STORE_MANAGER
  session.set(
    "branchIds",
    (user.branches ?? []).map((b) => b.branchId)
  );
  // shiftId is set/cleared by cashier open/close shift flows
  return {
    headers: { "Set-Cookie": await authStorage.commitSession(session) },
    user: {
      userId: user.id,
      role: user.role as Role,
      branchIds: (user.branches ?? []).map((b) => b.branchId),
      shiftId: null,
    } as SessionUser,
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
  allowed: Role[]
): Promise<SessionUser> {
  const user = await requireUser(request);
  if (!allowed.includes(user.role)) {
    throw redirect(homePathFor(user.role));
  }
  return user;
}

export async function requireOpenShift(request: Request): Promise<SessionUser> {
  const user = await requireRole(request, ["ADMIN", "CASHIER"]);
  // Admins can bypass shift requirement.
  if (user.role !== "CASHIER") return user;

  const session = await getAuthSession(request);
  const raw = session.get("shiftId");
  const shiftId = Number(raw);
  // ❗ Guard: old builds stored Date.now() (13 digits) → won't fit INT4
  const invalid =
    !Number.isFinite(shiftId) ||
    Math.floor(shiftId) !== shiftId ||
    shiftId <= 0 ||
    shiftId > 2147483647;
  if (invalid) {
    session.unset("shiftId");
    // clear bad cookie then send user DIRECT to shift console
    throw redirect("/cashier/shift?open=1", {
      headers: { "Set-Cookie": await authStorage.commitSession(session) },
    });
  }
  if (!shiftId) {
    throw redirect("/cashier/shift?open=1");
  }
  // Ensure the shift row actually exists and is still open for this cashier
  const shift = await db.cashierShift.findFirst({
    where: { id: shiftId, cashierId: user.userId, closedAt: null },
    select: { id: true },
  });
  if (!shift) {
    // Stale cookie → clear then redirect to open
    session.unset("shiftId");
    throw redirect("/cashier/shift?open=1", {
      headers: { "Set-Cookie": await authStorage.commitSession(session) },
    });
  }
  // expose non-null shiftId to callers
  return { ...user, shiftId } as SessionUser;
}

export async function setShiftId(
  request: Request,
  shiftId: number | null
): Promise<{ headers: Record<string, string> }> {
  const session = await getAuthSession(request);
  if (shiftId) session.set("shiftId", Number(shiftId)); // ensure integer
  else session.unset("shiftId");
  return {
    headers: { "Set-Cookie": await authStorage.commitSession(session) },
  };
}

// ───────────────────────────────────────────────────────────
// Shift helpers: open/close + fetch active
// ───────────────────────────────────────────────────────────

/**
+ * Create a REAL CashierShift row and persist its id in the auth cookie.
+ * Use this instead of setShiftId(Date.now()).
+ */
export async function openCashierShift(
  request: Request,
  opts: {
    branchId?: number; // real Branch id
    openingFloat?: number;
    deviceId?: string;
    notes?: string;
  } = {}
): Promise<{ headers: Record<string, string>; shift: CashierShift }> {
  const me = await requireRole(request, ["CASHIER", "ADMIN"]);
  if (me.role !== "CASHIER") {
    throw new Response("Only CASHIER can open a cashier shift", {
      status: 403,
    });
  }
  const branchId = opts.branchId ?? me.branchIds[0];
  if (!branchId) {
    throw new Response("No branch assigned to cashier. Cannot open shift.", {
      status: 400,
    });
  }
  const shift = await db.cashierShift.create({
    data: {
      cashierId: me.userId,
      branchId,
      openingFloat: opts.openingFloat ?? null,
      deviceId: opts.deviceId ?? null,
      notes: opts.notes ?? null,
    },
  });
  const { headers } = await setShiftId(request, shift.id);
  return { headers, shift };
}

/**
+ * Close the active shift of the current cashier and clear it from the cookie.
+ */
export async function closeCashierShift(
  request: Request,
  opts: { closingTotal?: number; notes?: string } = {}
): Promise<{ headers: Record<string, string>; shift?: CashierShift | null }> {
  const me = await requireRole(request, ["CASHIER", "ADMIN"]);
  if (me.role !== "CASHIER") {
    // nothing to close for non-cashier; just clear cookie if any
    const { headers } = await setShiftId(request, null);
    return { headers, shift: null };
  }
  const session = await getAuthSession(request);
  const shiftId = (session.get("shiftId") as number | null) ?? null;
  if (!shiftId) {
    const { headers } = await setShiftId(request, null);
    return { headers, shift: null };
  }
  const shift = await db.cashierShift.findFirst({
    where: { id: shiftId, cashierId: me.userId, closedAt: null },
  });
  if (!shift) {
    const { headers } = await setShiftId(request, null);
    return { headers, shift: null };
  }
  const updated = await db.cashierShift.update({
    where: { id: shift.id },
    data: {
      closedAt: new Date(),
      closingTotal: opts.closingTotal ?? shift.closingTotal,
      notes: opts.notes ?? shift.notes,
    },
  });
  const { headers } = await setShiftId(request, null);
  return { headers, shift: updated };
}

/**
 * Convenience: read the currently active shift row (or null).
 */
export async function getActiveShift(
  request: Request
): Promise<CashierShift | null> {
  const me = await getUser(request);
  if (!me || me.role !== "CASHIER") return null;
  const session = await getAuthSession(request);
  const shiftId = (session.get("shiftId") as number | null) ?? null;
  if (!shiftId) return null;
  return db.cashierShift.findFirst({
    where: { id: shiftId, cashierId: me.userId, closedAt: null },
  });
}
