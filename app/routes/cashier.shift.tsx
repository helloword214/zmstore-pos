import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import * as React from "react";
import { SoTLoadingState } from "~/components/ui/SoTLoadingState";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { db } from "~/utils/db.server";
import { requireRole, setShiftId, type SessionUser } from "~/utils/auth.server";
import { CashDrawerTxnType, Prisma } from "@prisma/client";

const DENOMS: Array<{ key: string; label: string; value: number }> = [
  { key: "d1000", label: "₱1,000", value: 1000 },
  { key: "d500", label: "₱500", value: 500 },
  { key: "d200", label: "₱200", value: 200 },
  { key: "d100", label: "₱100", value: 100 },
  { key: "d50", label: "₱50", value: 50 },
  { key: "d20", label: "₱20", value: 20 },
  { key: "d10", label: "₱10", value: 10 },
  { key: "d5", label: "₱5", value: 5 },
  { key: "d1", label: "₱1", value: 1 },
  { key: "c25", label: "₱0.25", value: 0.25 },
];
type CashCount = Record<string, number>; // key -> qty

function r2(n: number) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function safeQty(n: unknown) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  return Math.floor(v);
}
function computeCashCountTotal(count: CashCount) {
  let sum = 0;
  for (const d of DENOMS) sum += (safeQty(count[d.key]) || 0) * d.value;
  // 2-dec rounding (centavos)
  return Math.round(sum * 100) / 100;
}

type OverdrawError = Error & { expected?: number };

function buildClosingDenoms(count: CashCount) {
  // Match your schema doc: { bills: { "1000": 3, ... }, coins: { "25": 4, "10": 0, ... } }
  const bills: Record<string, number> = {};
  const coins: Record<string, number> = {};

  const put = (obj: Record<string, number>, denom: string, qty: number) => {
    const q = safeQty(qty);
    if (q > 0) obj[denom] = q;
  };

  put(bills, "1000", count.d1000);
  put(bills, "500", count.d500);
  put(bills, "200", count.d200);
  put(bills, "100", count.d100);
  put(bills, "50", count.d50);
  put(bills, "20", count.d20);

  // coins: store 0.25 as "25" cents key
  put(coins, "10", count.d10);
  put(coins, "5", count.d5);
  put(coins, "1", count.d1);
  put(coins, "25", count.c25);

  return { bills, coins };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const toClosingDenomsJson = (count: CashCount): Prisma.InputJsonValue => {
  const denoms = buildClosingDenoms(count);
  return {
    bills: denoms.bills,
    coins: denoms.coins,
  };
};

type LoaderData = {
  me: SessionUser & { shiftId: number | null };
  activeShift: null | {
    id: number;
    openedAt: string;
    branchName: string;
    deviceId?: string | null;
    openingFloat: number | null;
    status:
      | "PENDING_ACCEPT"
      | "OPEN"
      | "OPENING_DISPUTED"
      | "SUBMITTED"
      | "RECOUNT_REQUIRED"
      | "FINAL_CLOSED";
    countSubmitted: boolean; // legacy UI hint (kept), but status is SoT
    openingCounted?: number | null;
    openingDisputeNote?: string | null;
    openingVerifiedAt?: string | null;
  };
  // quick totals preview when active
  totals?: {
    byMethod: Array<{
      method: string;
      amount: number;
      tendered: number | null;
      change: number | null;
    }>;
    grandAmount: number;
    cashSalesIn: number; // tendered - change for CASH payments
    arCashIn: number; // sum of CustomerArPayment.amount for shift
    cashDrawerIn: number; // sales cash + AR cash
  };

  // computed cash drawer snapshot
  drawer?: {
    openingFloat: number;
    cashInFromSales: number;
    cashInFromAr: number;
    cashInTotal: number;
    deposits: number;
    withdrawals: number;
    balance: number;
    recent: Array<{
      id: number;
      createdAt: string;
      type: CashDrawerTxnType;
      amount: number;
      note: string | null;
    }>;
  };

  // recent payments in this shift (for history panel)
  paymentsRecent?: Array<{
    id: number;
    orderId: number;
    createdAt: string;
    method: string;
    amount: number;
    tendered: number | null;
    change: number | null;
  }>;

  // for post-open redirect
  next?: string | null;
};

function safeNext(raw: string | null, fallback = "/cashier") {
  if (!raw) return fallback;
  // allow only internal paths
  if (!raw.startsWith("/")) return fallback;
  // avoid protocol injection
  if (raw.startsWith("//")) return fallback;
  return raw;
}

function redirectNeedShift(next: string) {
  // ✅ Policy: pag walang shift, wag i-route sa money pages.
  // Cashier should stay in /cashier (account/dashboard lane) until manager opens shift.
  return redirect(
    `/cashier?needShift=1&next=${encodeURIComponent(next || "/cashier")}`,
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  // 🔒 No admin bypass: cashier shift console is CASHIER-only for safety
  const me = await requireRole(request, ["CASHIER"]);
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"), "/cashier");

  // If session shiftId exists, check if still open; if closed, clear session now
  let activeShift: LoaderData["activeShift"] = null;
  let headers: Record<string, string> | undefined;
  let shiftIdForPayload: number | null = me.shiftId ?? null;
  if (me.shiftId) {
    const s = await db.cashierShift.findUnique({
      where: { id: me.shiftId },
      select: {
        id: true,
        openedAt: true,
        closedAt: true,
        deviceId: true,
        openingFloat: true,
        closingTotal: true,
        status: true,
        openingCounted: true,
        openingDisputeNote: true,
        openingVerifiedAt: true,
      },
    });
    if (s && !s.closedAt) {
      activeShift = {
        id: s.id,
        openedAt: s.openedAt.toISOString(),
        branchName: "—",
        deviceId: s.deviceId,
        openingFloat: s.openingFloat ? Number(s.openingFloat) : 0,
        status: s.status,
        countSubmitted: s.closingTotal != null,
        openingCounted:
          s.openingCounted != null ? Number(s.openingCounted) : null,
        openingDisputeNote: s.openingDisputeNote ?? null,
        openingVerifiedAt: s.openingVerifiedAt
          ? s.openingVerifiedAt.toISOString()
          : null,
      };
    } else {
      // stale cookie → clear
      const cleared = await setShiftId(request, null);
      headers = cleared.headers;
      shiftIdForPayload = null;
    }
  }

  // ✅ RECOVERY: session lost (logout/expired) but shift still OPEN in DB
  // If no session shiftId, try to find an open shift for this cashier and re-attach it.
  if (!shiftIdForPayload) {
    const openShift = await db.cashierShift.findFirst({
      where: { cashierId: me.userId, closedAt: null },
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
        openedAt: true,
        deviceId: true,
        openingFloat: true,
        closingTotal: true,
        status: true,
        openingCounted: true,
        openingDisputeNote: true,
        openingVerifiedAt: true,
      },
    });
    if (openShift) {
      const re = await setShiftId(request, openShift.id);
      headers = { ...(headers ?? {}), ...(re.headers ?? {}) };
      shiftIdForPayload = openShift.id;
      activeShift = {
        id: openShift.id,
        openedAt: openShift.openedAt.toISOString(),
        branchName: "—",
        deviceId: openShift.deviceId,
        openingFloat: openShift.openingFloat
          ? Number(openShift.openingFloat)
          : 0,
        status: openShift.status,
        countSubmitted: openShift.closingTotal != null,
        openingCounted:
          openShift.openingCounted != null
            ? Number(openShift.openingCounted)
            : null,
        openingDisputeNote: openShift.openingDisputeNote ?? null,
        openingVerifiedAt: openShift.openingVerifiedAt
          ? openShift.openingVerifiedAt.toISOString()
          : null,
      };
    }
  }

  // NOTE: no auto-open here. Loader must stay read-only.

  let totals: LoaderData["totals"] = undefined;
  let drawer: LoaderData["drawer"] = undefined;
  let paymentsRecent: LoaderData["paymentsRecent"] = undefined;

  if (activeShift) {
    const byMethod = await db.payment.groupBy({
      by: ["method"],
      where: { shiftId: activeShift.id },
      _sum: { amount: true, tendered: true, change: true },
    });
    const arCashAgg = await db.customerArPayment.aggregate({
      where: { shiftId: activeShift.id },
      _sum: { amount: true },
    });
    const grandAmount = byMethod.reduce(
      (s, r) => s + Number(r._sum.amount ?? 0),
      0,
    );
    const cashRow = byMethod.find((r) => r.method === "CASH");
    const cashSalesIn =
      Number(cashRow?._sum.tendered ?? 0) - Number(cashRow?._sum.change ?? 0);
    const arCashIn = Number(arCashAgg?._sum?.amount ?? 0);
    const cashDrawerIn = cashSalesIn + arCashIn;
    totals = {
      byMethod: byMethod.map((r) => ({
        method: r.method,
        amount: Number(r._sum.amount ?? 0),
        tendered: r._sum.tendered != null ? Number(r._sum.tendered) : null,
        change: r._sum.change != null ? Number(r._sum.change) : null,
      })),
      grandAmount,
      cashSalesIn,
      arCashIn,
      cashDrawerIn,
    };

    // Cash drawer snapshot
    const grouped = await db.cashDrawerTxn.groupBy({
      by: ["type"],
      where: { shiftId: activeShift.id },
      _sum: { amount: true },
    });
    const sumType = (t: CashDrawerTxnType) =>
      Number(grouped.find((g) => g.type === t)?._sum.amount ?? 0);
    const deposits = sumType(CashDrawerTxnType.CASH_IN);
    // Treat both CASH_OUT and DROP as outflows from the drawer
    const withdrawals =
      sumType(CashDrawerTxnType.CASH_OUT) + sumType(CashDrawerTxnType.DROP);
    const openingFloat = Number(activeShift.openingFloat ?? 0);
    const balance = openingFloat + cashDrawerIn + deposits - withdrawals;
    const recent = await db.cashDrawerTxn.findMany({
      where: { shiftId: activeShift.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        type: true,
        amount: true,
        note: true,
      },
    });
    drawer = {
      openingFloat,
      cashInFromSales: cashSalesIn,
      cashInFromAr: arCashIn,
      cashInTotal: cashDrawerIn,
      deposits,
      withdrawals,
      balance,
      recent: recent.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        type: r.type,
        amount: Number(r.amount),
        note: r.note ?? null,
      })),
    };

    // Recent payments for this shift (for history panel)
    const recentPayments = await db.payment.findMany({
      where: { shiftId: activeShift.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        orderId: true,
        amount: true,
        method: true,
        tendered: true,
        change: true,
        createdAt: true,
      },
    });
    paymentsRecent = recentPayments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      createdAt: p.createdAt.toISOString(),
      method: p.method,
      amount: Number(p.amount),
      tendered: p.tendered != null ? Number(p.tendered) : null,
      change: p.change != null ? Number(p.change) : null,
    }));
  }

  const payload: LoaderData = {
    me: { ...me, shiftId: shiftIdForPayload },
    activeShift,
    next,
    ...(totals ? { totals } : {}),
    ...(drawer ? { drawer } : {}),
    ...(paymentsRecent ? { paymentsRecent } : {}),
  };
  return json(payload, {
    headers: { ...(headers ?? {}), "Cache-Control": "no-store" },
  });
}

async function computeDrawerSnapshot(tx: Prisma.TransactionClient, shiftId: number) {
  // Cash sales in drawer = tendered - change for CASH payments
  const cash = await tx.payment.groupBy({
    by: ["method"],
    where: { shiftId, method: "CASH" },
    _sum: { tendered: true, change: true },
  });
  const cashRow = cash.find((r) => r.method === "CASH");
  const cashInFromSales =
    Number(cashRow?._sum.tendered ?? 0) - Number(cashRow?._sum.change ?? 0);
  const arCashAgg = await tx.customerArPayment.aggregate({
    where: { shiftId },
    _sum: { amount: true },
  });
  const cashInFromAr = Number(arCashAgg?._sum?.amount ?? 0);
  const cashInTotal = cashInFromSales + cashInFromAr;

  const grouped = await tx.cashDrawerTxn.groupBy({
    by: ["type"],
    where: { shiftId },
    _sum: { amount: true },
  });
  const sumType = (t: CashDrawerTxnType) =>
    Number(grouped.find((g) => g.type === t)?._sum.amount ?? 0);
  const deposits = sumType(CashDrawerTxnType.CASH_IN);
  const withdrawals =
    sumType(CashDrawerTxnType.CASH_OUT) + sumType(CashDrawerTxnType.DROP);

  return { cashInFromSales, cashInFromAr, cashInTotal, deposits, withdrawals };
}

export async function action({ request }: ActionFunctionArgs) {
  // 🔒 No admin bypass: cashier money lane is CASHIER-only
  const me = await requireRole(request, ["CASHIER"]);

  const fd = await request.formData();
  const act = String(fd.get("_action") || "");
  const next = safeNext(
    (fd.get("next") as string | null) ??
      new URL(request.url).searchParams.get("next"),
    "/cashier",
  );

  // ── Opening float acceptance (cashier recount) ─────────────────────────────
  if (act === "opening:accept" || act === "opening:dispute") {
    if (!me.shiftId) return redirectNeedShift(next);

    const openingCountedRaw = String(fd.get("openingCounted") ?? "").trim();
    const openingCountedNum = r2(Number(openingCountedRaw || 0));
    const disputeNote =
      String(fd.get("openingDisputeNote") || "").trim() || null;

    if (!Number.isFinite(openingCountedNum) || openingCountedNum < 0) {
      return json(
        { ok: false, error: "Opening counted must be a valid number (>= 0)." },
        { status: 400 },
      );
    }
    if (act === "opening:dispute" && !disputeNote) {
      return json(
        { ok: false, error: "Dispute note is required." },
        { status: 400 },
      );
    }

    await db.$transaction(
      async (tx) => {
        const s = await tx.cashierShift.findUnique({
          where: { id: me.shiftId! },
          select: {
            id: true,
            cashierId: true,
            closedAt: true,
            status: true,
          },
        });
        if (!s) throw new Error("SHIFT_NOT_FOUND");
        if (s.closedAt) throw new Error("SHIFT_ALREADY_CLOSED");
        if (s.cashierId !== me.userId) throw new Error("FORBIDDEN");

        // Only allow acceptance/dispute when manager opened & waiting cashier recount
        if (String(s.status) !== "PENDING_ACCEPT") {
          // idempotent-ish: if already OPEN, just do nothing
          return;
        }

        await tx.cashierShift.update({
          where: { id: me.shiftId! },
          data: {
            openingCounted: openingCountedNum,
            openingVerifiedAt: new Date(),
            openingVerifiedById: me.userId,
            openingDisputeNote: act === "opening:dispute" ? disputeNote : null,
            status: act === "opening:accept" ? "OPEN" : "OPENING_DISPUTED",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return redirect(`/cashier/shift?next=${encodeURIComponent(next)}`);
  }

  // ── Cash Drawer: deposit / withdraw
  if (act === "drawer:deposit" || act === "drawer:withdraw") {
    if (!me.shiftId) return redirectNeedShift(next);

    // ✅ Safety: ensure shift is still open AND belongs to this cashier
    const shift = await db.cashierShift.findUnique({
      where: { id: me.shiftId },
      select: {
        id: true,
        cashierId: true,
        closedAt: true,
        closingTotal: true,
        status: true,
      },
    });
    if (!shift || shift.closedAt) {
      const { headers } = await setShiftId(request, null);
      // ✅ no shift → back to cashier dashboard lane
      return redirect(`/cashier?needShift=1&next=${encodeURIComponent(next)}`, {
        headers,
      });
    }
    // 🔒 No admin bypass: cashier can only post drawer txns for own shift
    if (shift.cashierId !== me.userId) {
      return json(
        {
          ok: false,
          error: "You cannot post drawer txns for another cashier.",
        },
        { status: 403 },
      );
    }

    // 🔒 Once cashier submits counted cash, lock drawer movements.
    // Status is the SoT: only OPEN is writable.
    if (shift.status !== "OPEN") {
      return json(
        {
          ok: false,
          error:
            "Drawer is locked: counted cash already submitted. Manager must close/audit the shift.",
        },
        { status: 400 },
      );
    }

    const amount = Number(fd.get("amount") || 0);
    const note = String(fd.get("note") || "").trim() || null;
    if (!Number.isFinite(amount) || amount <= 0) {
      return json(
        { ok: false, error: "Enter a valid amount > 0" },
        { status: 400 },
      );
    }
    // ✅ Atomic posting (prevents race/double-submit overdraw)
    try {
      await db.$transaction(
        async (tx) => {
          if (act === "drawer:withdraw") {
            const s2 = await tx.cashierShift.findUnique({
              where: { id: me.shiftId! },
              select: { id: true, openingFloat: true, closedAt: true },
            });
            if (!s2 || s2.closedAt) {
              throw new Error("SHIFT_CLOSED");
            }
            const openingFloat = Number(s2.openingFloat ?? 0);
            const snap = await computeDrawerSnapshot(tx, me.shiftId!);
            const expectedDrawerNow =
              openingFloat +
              snap.cashInTotal +
              snap.deposits -
              snap.withdrawals;
            if (amount > expectedDrawerNow + 0.005) {
              const err = new Error("OVERDRAW") as OverdrawError;
              err.expected = expectedDrawerNow;
              throw err;
            }
          }

          await tx.cashDrawerTxn.create({
            data: {
              shiftId: me.shiftId!,
              type:
                act === "drawer:deposit"
                  ? CashDrawerTxnType.CASH_IN
                  : CashDrawerTxnType.CASH_OUT,
              amount,
              note,
              createdById: me.userId,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const e = error as { message?: unknown; expected?: unknown };
      if (String(e?.message) === "SHIFT_CLOSED") {
        const { headers } = await setShiftId(request, null);
        return redirect(
          `/cashier?needShift=1&next=${encodeURIComponent(next)}`,
          {
            headers,
          },
        );
      }
      if (String(e?.message) === "OVERDRAW") {
        const expected = Number(e?.expected ?? 0);
        return json(
          {
            ok: false,
            error: `Withdraw exceeds expected drawer cash (${expected.toFixed(
              2,
            )}). Fix missing payment or use Deposit for legit top-up. Over/short is handled at shift close.`,
          },
          { status: 400 },
        );
      }
      throw e;
    }

    return redirect(`/cashier/shift?next=${encodeURIComponent(next)}`);
  }

  if (act === "close") {
    if (!me.shiftId) return redirectNeedShift(next); // nothing to close
    const notesIn = String(fd.get("notes") || "").trim() || null;
    const countedCashIn = Number(fd.get("countedCash") || NaN);
    const denomsJsonRaw = String(fd.get("denomsJson") || "").trim();

    // If denomsJson is provided, it becomes the source for counted cash + closingDenoms.
    let cashCount: CashCount | null = null;
    let countedCash = countedCashIn;
    if (denomsJsonRaw) {
      try {
        const parsed: unknown = JSON.parse(denomsJsonRaw);
        if (isRecord(parsed)) {
          const normalized: CashCount = {};
          for (const d of DENOMS)
            normalized[d.key] = safeQty(parsed[d.key]);
          cashCount = normalized;
          countedCash = computeCashCountTotal(normalized);
        }
      } catch {
        return json(
          { ok: false, error: "Invalid cash count breakdown (denomsJson)." },
          { status: 400 },
        );
      }
    }

    // ✅ Close should record CASH DRAWER BALANCE (not booked revenue),
    // since deposits/withdrawals affect real cash.
    const shift = await db.cashierShift.findUnique({
      where: { id: me.shiftId },
      select: { id: true, cashierId: true, closedAt: true },
    });
    if (!shift) {
      const { headers } = await setShiftId(request, null);
      return redirect("/cashier", { headers });
    }
    if (shift.closedAt) {
      const { headers } = await setShiftId(request, null);
      return redirect("/cashier", { headers });
    }
    if (shift.cashierId !== me.userId) {
      return json({ ok: false, error: "Forbidden." }, { status: 403 });
    }

    // ✅ REQUIRED: cashier must input ACTUAL counted cash
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      return json(
        { ok: false, error: "Counted cash must be a valid number (>= 0)." },
        { status: 400 },
      );
    }

    // ✅ SUBMIT COUNT ONLY (no close here)
    await db.$transaction(
      async (tx) => {
        const s = await tx.cashierShift.findUnique({
          where: { id: me.shiftId! },
          select: {
            id: true,
            cashierId: true,
            closedAt: true,
            status: true,
          },
        });
        if (!s) throw new Error("SHIFT_NOT_FOUND");
        if (s.closedAt) throw new Error("SHIFT_ALREADY_CLOSED");
        if (s.cashierId !== me.userId) throw new Error("FORBIDDEN");
        // If already submitted, prevent double-submit.
        if (s.status === "SUBMITTED") throw new Error("ALREADY_SUBMITTED");
        // Submit is allowed only while shift is OPEN.
        if (s.status !== "OPEN")
          throw new Error("SHIFT_NOT_WRITABLE");

        const countedR2 = Math.round(Number(countedCash) * 100) / 100;

        await tx.cashierShift.update({
          where: { id: me.shiftId! },
          data: {
            // IMPORTANT: cashier does NOT close shift; manager closes in /store/cashier-shifts
            closingTotal: countedR2,
            closingDenoms: cashCount
              ? toClosingDenomsJson(cashCount)
              : undefined,
            notes: notesIn,
            status: "SUBMITTED",
            cashierSubmittedAt: new Date(),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Keep shiftId; cashier stays in console (waiting for manager close)
    return redirect(`/cashier/shift?next=${encodeURIComponent(next)}`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function ShiftConsole() {
  const { activeShift, totals, drawer, paymentsRecent, next } =
    useLoaderData<LoaderData>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const pendingAction = String(nav.formData?.get("_action") ?? "");
  const depositBusy = pendingAction === "drawer:deposit" && busy;
  const withdrawBusy = pendingAction === "drawer:withdraw" && busy;
  const openingAcceptBusy = pendingAction === "opening:accept" && busy;
  const openingDisputeBusy = pendingAction === "opening:dispute" && busy;
  const openingBusy = openingAcceptBusy || openingDisputeBusy;
  const closeBusy = pendingAction === "close" && busy;

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const drawerLocked = Boolean(activeShift && activeShift.status !== "OPEN");
  const openingPending = Boolean(
    activeShift && activeShift.status === "PENDING_ACCEPT",
  );
  const openingDisputed = Boolean(
    activeShift && activeShift.status === "OPENING_DISPUTED",
  );

  const expectedRaw = Number(drawer?.balance ?? 0);
  // Display-safe expected (never show negative as "expected cash" — it's a ledger error)
  const expectedNow = Math.max(0, expectedRaw);
  const [countedCash, setCountedCash] = React.useState<string>(() =>
    expectedNow ? expectedNow.toFixed(2) : "0.00",
  );

  // Opening acceptance counted (default to manager float)
  const [openingCounted, setOpeningCounted] = React.useState<string>(() => {
    const base = Number(activeShift?.openingFloat ?? 0);
    return Number.isFinite(base) ? r2(base).toFixed(2) : "0.00";
  });
  React.useEffect(() => {
    const base = Number(activeShift?.openingFloat ?? 0);
    setOpeningCounted(Number.isFinite(base) ? r2(base).toFixed(2) : "0.00");
  }, [activeShift?.id, activeShift?.openingFloat]);

  // Denomination mode
  const [useDenoms, setUseDenoms] = React.useState<boolean>(true);
  const [cashCount, setCashCount] = React.useState<CashCount>(() => {
    const base: CashCount = {};
    for (const d of DENOMS) base[d.key] = 0;
    return base;
  });
  const denomsTotal = React.useMemo(
    () => computeCashCountTotal(cashCount),
    [cashCount],
  );
  const denomsJson = React.useMemo(
    () => JSON.stringify(cashCount),
    [cashCount],
  );

  // keep countedCash synced when using denoms
  React.useEffect(() => {
    if (!useDenoms) return;
    setCountedCash(denomsTotal.toFixed(2));
  }, [useDenoms, denomsTotal]);

  React.useEffect(() => {
    // if user hasn't typed yet (still 0), seed from expected
    setCountedCash((prev) => {
      const v = Number(prev);
      if (Number.isFinite(v) && Math.abs(v) > 0.0001) return prev;
      return expectedNow.toFixed(2);
    });
  }, [expectedNow]);

  const countedNum = Number(countedCash || 0);
  const diff = countedNum - expectedNow;
  const diffIsZero = Math.abs(diff) < 0.005;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Shift Console"
        subtitle={
          activeShift
            ? `Active shift #${activeShift.id} • ${activeShift.branchName}`
            : "Waiting for manager to open your shift."
        }
        backTo="/cashier"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/cashier/shift-history"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          >
            Shift History
          </Link>
          {drawer && expectedRaw < -0.005 ? (
            <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200">
              LEDGER ERROR
            </span>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {!activeShift ? (
            <div className="px-4 py-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                No active shift. Manager must open the cashier shift first.
              </div>
              <span className="text-xs text-slate-500">
                If manager already opened it, reload this page.
              </span>
            </div>
          ) : (
            <div className="px-4 py-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-slate-800">
                    <span className="font-medium">Active shift</span>{" "}
                    <span className="font-mono">#{activeShift.id}</span>{" "}
                    <span className="text-slate-500">•</span>{" "}
                    <span className="font-medium">
                      {activeShift.branchName}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">
                    Opened: {new Date(activeShift.openedAt).toLocaleString()}
                    {activeShift.deviceId ? (
                      <>
                        {" "}
                        • Device:{" "}
                        <span className="font-mono">
                          {activeShift.deviceId}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              {openingDisputed ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Opening float is{" "}
                  <span className="font-semibold">DISPUTED</span>. Waiting for
                  manager to correct/recount.
                  {activeShift.openingDisputeNote ? (
                    <div className="mt-1 text-xs text-amber-800">
                      Note:{" "}
                      <span className="font-medium">
                        {activeShift.openingDisputeNote}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-12">
                {/* LEFT */}
                <div className="lg:col-span-7 space-y-4">
                  {totals ? (
                    <div className="rounded-2xl border border-slate-200 bg-white">
                      <div className="border-b border-slate-100 px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">
                          Running totals
                        </div>
                      </div>
                      <div className="px-4 py-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs text-slate-500">
                            Booked revenue (all methods)
                          </div>
                          <div className="text-lg font-semibold">
                            {peso(totals.grandAmount)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs text-slate-500">
                            Cash drawer in (sales + A/R)
                          </div>
                          <div className="text-lg font-semibold">
                            {peso(totals.cashDrawerIn)}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Sales {peso(totals.cashSalesIn)} • A/R{" "}
                            {peso(totals.arCashIn)}
                          </div>
                        </div>
                        <div className="sm:col-span-2">
                          <div className="text-xs text-slate-500 mb-2">
                            By method
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {totals.byMethod.map((m) => (
                              <div
                                key={m.method}
                                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                              >
                                <span className="text-slate-700">
                                  {m.method}
                                </span>
                                <span className="font-medium">
                                  {peso(m.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {drawer ? (
                    <div className="rounded-2xl border border-slate-200 bg-white">
                      <div className="border-b border-slate-100 px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">
                          Cash drawer
                        </div>
                      </div>
                      <div className="px-4 py-4 space-y-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-xs text-slate-500">
                              Opening float
                            </div>
                            <div className="text-base font-semibold">
                              {peso(drawer.openingFloat)}
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-xs text-slate-500">
                              In from sales + A/R (cash)
                            </div>
                            <div className="text-base font-semibold">
                              {peso(drawer.cashInTotal)}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500">
                              Sales {peso(drawer.cashInFromSales)} • A/R{" "}
                              {peso(drawer.cashInFromAr)}
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-3">
                            <div className="text-xs text-slate-500">
                              Balance now
                            </div>
                            <div className="text-base font-semibold">
                              {peso(drawer.balance)}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <Form
                            method="post"
                            className="rounded-2xl border border-slate-200 p-3"
                          >
                            <fieldset
                              disabled={busy || drawerLocked}
                              className="space-y-2 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              <input
                                type="hidden"
                                name="_action"
                                value="drawer:deposit"
                              />
                              <input
                                type="hidden"
                                name="next"
                                value={next ?? "/cashier"}
                              />
                              <div className="mb-2 text-sm font-medium">
                                Deposit
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <input
                                  name="amount"
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  required
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 sm:w-36"
                                  placeholder="0.00"
                                />
                                <input
                                  name="note"
                                  type="text"
                                  className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                  placeholder="Note (optional)"
                                />
                                <button
                                  className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 disabled:opacity-50"
                                  disabled={busy || drawerLocked}
                                  title={
                                    drawerLocked
                                      ? "Locked after count submitted"
                                      : undefined
                                  }
                                >
                                  {depositBusy ? "Adding…" : "Add"}
                                </button>
                              </div>
                              {depositBusy ? (
                                <SoTLoadingState
                                  variant="inline"
                                  label="Posting deposit"
                                  hint="Updating the live drawer balance."
                                />
                              ) : null}
                            </fieldset>
                          </Form>

                          <Form
                            method="post"
                            className="rounded-2xl border border-slate-200 p-3"
                          >
                            <fieldset
                              disabled={busy || drawerLocked}
                              className="space-y-2 disabled:cursor-not-allowed disabled:opacity-70"
                            >
                              <input
                                type="hidden"
                                name="_action"
                                value="drawer:withdraw"
                              />
                              <input
                                type="hidden"
                                name="next"
                                value={next ?? "/cashier"}
                              />
                              <div className="mb-2 text-sm font-medium">
                                Withdraw
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <input
                                  name="amount"
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  required
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 sm:w-36"
                                  placeholder="0.00"
                                />
                                <input
                                  name="note"
                                  type="text"
                                  className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                  placeholder="Note (optional)"
                                />
                                <button
                                  className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 disabled:opacity-50"
                                  disabled={busy || drawerLocked}
                                  title={
                                    drawerLocked
                                      ? "Locked after count submitted"
                                      : undefined
                                  }
                                >
                                  {withdrawBusy ? "Taking…" : "Take"}
                                </button>
                              </div>
                              {withdrawBusy ? (
                                <SoTLoadingState
                                  variant="inline"
                                  label="Posting withdrawal"
                                  hint="Recomputing the drawer cash limit."
                                />
                              ) : null}
                              <div className="mt-2 text-xs text-slate-500">
                                Withdraw is limited to expected drawer cash.
                                Over/short is handled at shift close.
                              </div>
                            </fieldset>
                          </Form>
                        </div>
                        {drawerLocked ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                            Count submitted. Drawer movements are locked while
                            waiting for manager audit/close.
                          </div>
                        ) : null}
                        <div className="rounded-2xl border border-slate-200 p-3">
                          <div className="mb-2 text-sm font-medium text-slate-800">
                            Recent drawer transactions
                          </div>
                          <ul className="divide-y divide-slate-100">
                            {drawer.recent.map((t) => (
                              <li
                                key={t.id}
                                className="flex items-start justify-between gap-3 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs text-slate-500">
                                    {new Date(t.createdAt).toLocaleString()}
                                  </div>
                                  <div className="text-slate-800">
                                    <span className="font-medium">
                                      {t.type}
                                    </span>
                                    {t.note ? (
                                      <span className="text-slate-500">
                                        {" "}
                                        • {t.note}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="text-right tabular-nums font-medium">
                                  {peso(t.amount)}
                                </div>
                              </li>
                            ))}
                            {drawer.recent.length === 0 && (
                              <li className="py-3 text-sm text-slate-500">
                                No drawer transactions.
                              </li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
                {/* RIGHT */}
                <div className="lg:col-span-5 space-y-4">
                  {openingPending ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="mb-2 text-sm font-medium text-slate-800">
                        Verify opening float
                      </div>
                      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
                        Manager opened this shift. Please recount the opening
                        float before cashiering.
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs text-slate-500">
                            Manager opening float
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {peso(Number(activeShift.openingFloat ?? 0))}
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs text-slate-500">
                            Your counted opening
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {peso(r2(Number(openingCounted || 0)))}
                          </div>
                        </div>
                      </div>

                      {openingBusy ? (
                        <SoTLoadingState
                          variant="panel"
                          className="mt-3"
                          label={
                            openingAcceptBusy
                              ? "Accepting opening float"
                              : "Sending opening dispute"
                          }
                          hint={
                            openingAcceptBusy
                              ? "Starting the shift and unlocking cashier actions."
                              : "Locking the shift while the manager reviews the recount."
                          }
                        />
                      ) : null}

                      <label className="mt-3 block text-sm">
                        <span className="block text-slate-700 mb-1">
                          Enter counted opening float
                        </span>
                        <input
                          value={openingCounted}
                          onChange={(e) => setOpeningCounted(e.target.value)}
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          disabled={busy}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                        />
                      </label>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <Form
                          method="post"
                          onSubmit={(e) => {
                            if (
                              !confirm(
                                "Accept opening float and start cashiering?",
                              )
                            )
                              e.preventDefault();
                          }}
                        >
                          <input
                            type="hidden"
                            name="_action"
                            value="opening:accept"
                          />
                          <input
                            type="hidden"
                            name="next"
                            value={next ?? "/cashier"}
                          />
                          <input
                            type="hidden"
                            name="openingCounted"
                            value={openingCounted}
                          />
                          <button
                            type="submit"
                            className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 disabled:opacity-50"
                            disabled={busy}
                          >
                            {openingAcceptBusy ? "Saving…" : "Accept & Open"}
                          </button>
                        </Form>

                        <Form
                          method="post"
                          onSubmit={(e) => {
                            if (
                              !confirm(
                                "Dispute the opening float and notify manager?",
                              )
                            )
                              e.preventDefault();
                          }}
                        >
                          <input
                            type="hidden"
                            name="_action"
                            value="opening:dispute"
                          />
                          <input
                            type="hidden"
                            name="next"
                            value={next ?? "/cashier"}
                          />
                          <input
                            type="hidden"
                            name="openingCounted"
                            value={openingCounted}
                          />

                          <input
                            name="openingDisputeNote"
                            placeholder="Dispute note (required)"
                            className="mb-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            required
                            disabled={busy}
                          />

                          <button
                            type="submit"
                            className="w-full rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 disabled:opacity-50"
                            disabled={busy}
                          >
                            {openingDisputeBusy ? "Sending…" : "Dispute"}
                          </button>
                        </Form>
                      </div>

                      <div className="mt-2 text-xs text-slate-500">
                        Accept = shift becomes OPEN (money routes writable).
                        Dispute = shift becomes OPENING_DISPUTED (locked;
                        manager must resolve).
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="mb-2 text-sm font-medium text-slate-800">
                        Submit counted cash
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs text-slate-500">
                            Expected drawer
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {peso(expectedNow)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs text-slate-500">
                            Counted cash
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {peso(Number.isFinite(countedNum) ? countedNum : 0)}
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-50 p-3">
                          <div className="text-xs text-slate-500">Diff</div>
                          <div
                            className={[
                              "text-lg font-semibold tabular-nums",
                              diffIsZero
                                ? "text-slate-700"
                                : diff > 0
                                ? "text-emerald-700"
                                : "text-rose-700",
                            ].join(" ")}
                          >
                            {diff >= 0 ? "+" : ""}
                            {peso(diff)}
                          </div>
                        </div>
                      </div>

                      {activeShift.status !== "OPEN" ? (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          Shift is locked ({activeShift.status}). You can’t
                          submit the closing count until it’s OPEN.
                        </div>
                      ) : null}

                      {closeBusy ? (
                        <SoTLoadingState
                          variant="panel"
                          className="mt-3"
                          label="Submitting counted cash"
                          hint="Locking the cashier count and handing it off for manager audit."
                        />
                      ) : null}

                      <Form
                        method="post"
                        className="mt-3 space-y-2"
                        onSubmit={(e) => {
                          if (!confirm("Submit counted cash now?"))
                            e.preventDefault();
                        }}
                      >
                        <fieldset
                          disabled={busy || drawerLocked}
                          className="space-y-2 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <input type="hidden" name="_action" value="close" />
                          <input
                            type="hidden"
                            name="next"
                            value={next ?? "/cashier"}
                          />
                          <input
                            type="hidden"
                            name="countedCash"
                            value={countedCash}
                          />
                          <input
                            type="hidden"
                            name="denomsJson"
                            value={useDenoms ? denomsJson : ""}
                          />

                          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <div className="text-sm">
                              <div className="font-medium text-slate-800">
                                Cash count mode
                              </div>
                              <div className="text-xs text-slate-500">
                                Use denominations for faster, audit-safe count.
                              </div>
                            </div>
                            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={useDenoms}
                                onChange={(e) => setUseDenoms(e.target.checked)}
                                disabled={busy || drawerLocked}
                              />
                              Use denoms
                            </label>
                          </div>

                          {useDenoms ? (
                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                              <div className="mb-2 text-sm font-medium text-slate-800">
                                Denomination count
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {DENOMS.map((d) => (
                                  <label
                                    key={d.key}
                                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                                  >
                                    <span className="text-slate-700">
                                      {d.label}
                                    </span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={cashCount[d.key] ?? 0}
                                      onChange={(e) =>
                                        setCashCount((prev) => ({
                                          ...prev,
                                          [d.key]: safeQty(e.target.value),
                                        }))
                                      }
                                      className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-right tabular-nums outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                      aria-label={`Qty for ${d.label}`}
                                      disabled={busy || drawerLocked}
                                    />
                                  </label>
                                ))}
                              </div>
                              <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                                <div className="text-sm text-slate-700">
                                  Computed total
                                </div>
                                <div className="text-sm font-semibold tabular-nums text-slate-900">
                                  {peso(denomsTotal)}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          <label className="block text-sm">
                            <span className="block text-slate-700 mb-1">
                              Enter counted cash
                            </span>
                            <input
                              value={countedCash}
                              onChange={(e) => setCountedCash(e.target.value)}
                              type="number"
                              step="0.01"
                              min="0"
                              required
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                              readOnly={useDenoms}
                              disabled={busy || drawerLocked}
                            />
                          </label>

                          <input
                            name="notes"
                            placeholder="Notes (optional)"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            disabled={busy || drawerLocked}
                          />

                          <button
                            type="submit"
                            className="w-full rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1 disabled:opacity-50"
                            disabled={
                              busy || drawerLocked || activeShift.status !== "OPEN"
                            }
                          >
                            {closeBusy ? "Submitting…" : "Submit count"}
                          </button>

                          <div className="text-xs text-slate-500">
                            Expected is system cash; counted is physical cash.
                            Cashier submits once; manager recounts and final-closes
                            in <code>/store/cashier-shifts</code>.
                          </div>
                        </fieldset>
                      </Form>
                    </div>
                  )}

                  {paymentsRecent && paymentsRecent.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white">
                      <div className="border-b border-slate-100 px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">
                          Recent payments
                        </div>
                      </div>
                      <div className="max-h-80 overflow-auto px-4 py-3">
                        <ul className="divide-y divide-slate-100">
                          {paymentsRecent.map((p) => (
                            <li key={p.id} className="py-2 text-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs text-slate-500">
                                    {new Date(p.createdAt).toLocaleString()}
                                  </div>
                                  <div className="text-slate-800">
                                    <span className="font-medium">
                                      Payment #{p.id}
                                    </span>{" "}
                                    <span className="text-slate-500">•</span>{" "}
                                    Order #{p.orderId}{" "}
                                    <span className="text-slate-500">•</span>{" "}
                                    <span className="uppercase font-medium">
                                      {p.method}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-right text-xs tabular-nums">
                                  <div className="font-semibold">
                                    {peso(p.amount)}
                                  </div>
                                  {p.tendered != null ? (
                                    <div className="text-slate-600">
                                      T: {peso(p.tendered)}
                                      {p.change != null && p.change !== 0 ? (
                                        <> • Ch: {peso(p.change)}</>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
