// app/utils/shift.server.ts
import { db } from "~/utils/db.server";
import {
  getUser,
  getActiveShift,
  setShiftId,
  requireOpenShift,
} from "~/utils/auth.server";

/**
 * Option B (compat shim)
 * - Keep temporarily so old routes won't break.
 * - New routes should use requireOpenShift(request) directly.
 *
 * Return shape kept: { me, shift } OR { redirectTo }
 */
function safeNextFromRequest(request: Request, fallback = "/cashier") {
  const url = new URL(request.url);
  const path = `${url.pathname}${url.search || ""}`;
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//")) return fallback;
  return path;
}

export async function requireActiveShift(request: Request) {
  const me = await getUser(request);
  if (!me) return { redirectTo: "/login" as const };
  // Admin bypass: allow admin to pass without shift.
  if (me.role !== "CASHIER") {
    return { me, shift: null as any };
  }

  // ✅ Strict guard (also handles "resume open shift" & clears bad cookie)
  // If no shift, this will redirect to /cashier/shift?open=1&next=...
  const me2 = await requireOpenShift(request, {
    next: safeNextFromRequest(request),
  });

  // ✅ SoT: now read active shift row (DB truth)
  const active = await getActiveShift(request);
  if (!active) {
    const next = safeNextFromRequest(request);
    return {
      redirectTo: `/cashier/shift?open=1&next=${encodeURIComponent(
        next,
      )}` as const,
    };
  }

  // Extra-safety: ensure select shape matches old callers
  const shift = await db.cashierShift.findUnique({
    where: { id: active.id },
    select: { id: true, closedAt: true, branchId: true },
  });
  if (!shift || shift.closedAt) {
    // Clear cookie just in case
    const cleared = await setShiftId(request, null);
    const next = safeNextFromRequest(request);
    return {
      redirectTo: `/cashier/shift?open=1&next=${encodeURIComponent(
        next,
      )}` as const,
      headers: cleared.headers,
    };
  }

  return { me: me2, shift };
}

/** Helper to attach current shiftId to records you create during cashier ops */
export async function getActiveShiftIdOrNull(request: Request) {
  const s = await getActiveShift(request);
  return s?.id ?? null;
}
