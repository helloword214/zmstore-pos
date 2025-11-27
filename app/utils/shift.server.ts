// app/utils/shift.server.ts
import { db } from "~/utils/db.server";
import { getUser } from "~/utils/auth.server";

export async function requireActiveShift(request: Request) {
  const me = await getUser(request);
  if (!me) return { redirectTo: "/login" as const };

  if (!me.shiftId) {
    return { redirectTo: "/cashier/shift" as const };
  }

  const shift = await db.cashierShift.findUnique({
    where: { id: me.shiftId },
    select: { id: true, closedAt: true, branchId: true },
  });

  if (!shift || shift.closedAt) {
    return { redirectTo: "/cashier/shift" as const };
  }

  return { me, shift };
}

/** Helper to attach current shiftId to records you create during cashier ops */
export async function getActiveShiftIdOrNull(request: Request) {
  const me = await getUser(request);
  return me?.shiftId ?? null;
}
