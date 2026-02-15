// app/utils/shiftGuards.server.ts
import { redirect } from "@remix-run/node";
import { db } from "~/utils/db.server";
import {
  getActiveShift,
  getUser,
  homePathFor,
  requireOpenShift,
} from "~/utils/auth.server";
import { CashierShiftStatus } from "@prisma/client";

function safeNextFromRequest(request: Request, fallback = "/cashier") {
  const url = new URL(request.url);
  const path = `${url.pathname}${url.search || ""}`;
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//")) return fallback;
  return path;
}

type AssertOpts = {
  request: Request;
  next?: string;
};

/**
 * Assert cashier has an ACTIVE + WRITABLE shift (DB truth).
 *
 * Rules:
 * - NO SHIFT        → redirect /cashier?needShift=1&next=...
 * - LOCKED SHIFT    → redirect /cashier?shiftLocked=1&next=...
 * - CLOSED SHIFT    → treated like NO SHIFT
 * - OK              → return { shiftId }
 */
export async function assertActiveShiftWritable({ request, next }: AssertOpts) {
  const nextSafe = next ?? safeNextFromRequest(request);

  const me = await getUser(request);
  if (!me) throw redirect(`/login?next=${encodeURIComponent(nextSafe)}`);

  // 🔒 CASHIER-ONLY: admins/managers must not touch cashier money routes
  if (me.role !== "CASHIER") {
    throw redirect(homePathFor(me.role));
  }

  // Requires an open shift cookie (and may restore cookie if DB has open shift, depending on your auth util)
  await requireOpenShift(request, { next: nextSafe });

  // DB truth: read active shift from auth util
  const active = await getActiveShift(request);
  if (!active) {
    throw redirect(`/cashier?needShift=1&next=${encodeURIComponent(nextSafe)}`);
  }

  // Extra-safety: re-read cashierShift row for locked/writable decision
  const shift = await db.cashierShift.findUnique({
    where: { id: active.id },
    select: {
      id: true,
      closedAt: true,
      status: true,
    },
  });

  if (!shift || shift.closedAt) {
    throw redirect(`/cashier?needShift=1&next=${encodeURIComponent(nextSafe)}`);
  }

  // 🔒 LOCK: anything other than OPEN is not writable (SUBMITTED/RECOUNT_REQUIRED/FINAL_CLOSED)
  if (shift.status !== CashierShiftStatus.OPEN) {
    throw redirect(
      `/cashier?shiftLocked=1&next=${encodeURIComponent(nextSafe)}`,
    );
  }

  return { shiftId: shift.id };
}
