/* app/routes/store.cashier-shifts.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import * as React from "react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { peso, toNum } from "~/utils/money";
import { CashDrawerTxnType } from "@prisma/client";

const EPS = 0.005;
const CASHIER_CHARGE_TAG = "CASHIER_SHIFT_VARIANCE";
const r2 = (n: number) => Math.round(toNum(n) * 100) / 100;

function generatePaperRefNo(shiftId: number, at = new Date()) {
  const yyyy = String(at.getFullYear());
  const mm = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  const hh = String(at.getHours()).padStart(2, "0");
  const mi = String(at.getMinutes()).padStart(2, "0");
  const ss = String(at.getSeconds()).padStart(2, "0");
  const shiftPart = String(shiftId).padStart(4, "0");
  return `CS-${yyyy}${mm}${dd}-${shiftPart}-${hh}${mi}${ss}`;
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function computeExpectedDrawerForShift(
  tx: typeof db,
  shiftId: number,
  openingFloat: number,
) {
  const cashAgg = await tx.payment.aggregate({
    where: { shiftId, method: "CASH" },
    _sum: { tendered: true, change: true },
  });
  const arCashAgg = await tx.customerArPayment.aggregate({
    where: { shiftId },
    _sum: { amount: true },
  });

  const txByType = await tx.cashDrawerTxn.groupBy({
    by: ["type"],
    where: { shiftId },
    _sum: { amount: true },
  });

  const cashInFromSales = r2(
    toNum(cashAgg?._sum?.tendered) - toNum(cashAgg?._sum?.change),
  );
  const cashInFromAr = r2(toNum(arCashAgg?._sum?.amount));
  const cashInTotal = r2(cashInFromSales + cashInFromAr);

  let deposits = 0;
  let withdrawals = 0;
  for (const row of txByType as any[]) {
    const amt = r2(toNum((row as any)?._sum?.amount));
    if (row.type === CashDrawerTxnType.CASH_IN) deposits += amt;
    if (
      row.type === CashDrawerTxnType.CASH_OUT ||
      row.type === CashDrawerTxnType.DROP
    ) {
      withdrawals += amt;
    }
  }

  const expectedDrawer = r2(openingFloat + deposits + cashInTotal - withdrawals);
  return {
    expectedDrawer,
    cashInFromSales,
    cashInFromAr,
    cashInTotal,
    deposits: r2(deposits),
    withdrawals: r2(withdrawals),
  };
}

type CashierOption = {
  id: number;
  label: string;
};

type OpenShiftRow = {
  id: number;
  openedAt: string;
  cashier: { id: number; label: string };
  openingFloat: number;
  // IMPORTANT: keep runtime string (avoid importing Prisma enum value into browser bundle)
  status: string;
  openingCounted: number | null;
  openingVerifiedAt: string | null;
  openingDisputeNote: string | null;
  closingTotal: number | null;
  deviceId: string | null;
  expectedDrawer: number;
  cashInFromSales: number;
  cashInFromAr: number;
  cashInTotal: number;
  deposits: number;
  withdrawals: number; // CASH_OUT + DROP
};

type LoaderData = {
  me: { userId: number; role: string };
  cashiers: CashierOption[];
  openShifts: OpenShiftRow[];
};

type OpenActionResult = "created" | "exists";

type ActionData = {
  ok: false;
  error: string;
  action?: "open" | "close" | "resend";
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  // Cashier list
  const cashierUsers = await db.user.findMany({
    where: { role: "CASHIER" as any },
    include: { employee: true },
    orderBy: { id: "asc" },
    take: 100,
  });
  const cashiers: CashierOption[] = cashierUsers.map((u: any) => {
    const emp = u.employee;
    const name =
      emp && (emp.firstName || emp.lastName)
        ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
        : u.email ?? `User #${u.id}`;
    const alias = emp?.alias ? ` (${emp.alias})` : "";
    return { id: u.id, label: `${name}${alias}` };
  });

  // Open shifts
  const rows = await db.cashierShift.findMany({
    where: { closedAt: null },
    // Prefer urgent states first (disputes/pending), then newest.
    orderBy: [{ status: "asc" as any }, { openedAt: "desc" }],
    take: 50,
    include: {
      cashier: { include: { employee: true } },
    },
  });

  // ---- Expected drawer per shift ----
  const shiftIds = (rows || []).map((s: any) => Number(s.id)).filter(Boolean);

  // CASH in from sales = tendered - change (not amount)
  const payByShift = shiftIds.length
    ? await db.payment.groupBy({
        by: ["shiftId"],
        where: { shiftId: { in: shiftIds as any }, method: "CASH" },
        _sum: { tendered: true, change: true },
      })
    : [];
  const arByShift = shiftIds.length
    ? await db.customerArPayment.groupBy({
        by: ["shiftId"],
        where: { shiftId: { in: shiftIds as any } },
        _sum: { amount: true },
      })
    : [];

  const payMap = new Map<number, { tendered: number; change: number }>();
  for (const r of payByShift as any[]) {
    const sid = Number((r as any).shiftId || 0);
    if (!sid) continue;
    payMap.set(sid, {
      tendered: toNum((r as any)?._sum?.tendered),
      change: toNum((r as any)?._sum?.change),
    });
  }
  const arMap = new Map<number, number>();
  for (const r of arByShift as any[]) {
    const sid = Number((r as any).shiftId || 0);
    if (!sid) continue;
    arMap.set(sid, toNum((r as any)?._sum?.amount));
  }

  // Drawer txns: CASH_IN adds, CASH_OUT + DROP subtract
  const txByShift = shiftIds.length
    ? await db.cashDrawerTxn.groupBy({
        by: ["shiftId", "type"],
        where: { shiftId: { in: shiftIds as any } },
        _sum: { amount: true },
      })
    : [];

  const txMap = new Map<number, { in: number; out: number; drop: number }>();
  for (const r of txByShift as any[]) {
    const sid = Number((r as any).shiftId || 0);
    if (!sid) continue;
    const cur = txMap.get(sid) || { in: 0, out: 0, drop: 0 };
    const amt = toNum((r as any)?._sum?.amount);
    const type = (r as any).type as CashDrawerTxnType;
    if (type === CashDrawerTxnType.CASH_IN) cur.in += amt;
    else if (type === CashDrawerTxnType.CASH_OUT) cur.out += amt;
    else if (type === CashDrawerTxnType.DROP) cur.drop += amt;
    txMap.set(sid, cur);
  }

  const openShifts: OpenShiftRow[] = rows.map((s: any) => {
    const emp = s.cashier?.employee;
    const name =
      emp && (emp.firstName || emp.lastName)
        ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
        : s.cashier?.email ?? `User #${s.cashierId}`;
    const alias = emp?.alias ? ` (${emp.alias})` : "";

    const openingFloat = toNum(s.openingFloat);
    const p = payMap.get(Number(s.id)) || { tendered: 0, change: 0 };
    const cashInFromSales = r2(p.tendered - p.change);
    const cashInFromAr = r2(arMap.get(Number(s.id)) ?? 0);
    const cashInTotal = r2(cashInFromSales + cashInFromAr);
    const t = txMap.get(Number(s.id)) || { in: 0, out: 0, drop: 0 };
    const deposits = r2(t.in);
    const withdrawals = r2(t.out + t.drop);
    const expectedDrawer = r2(openingFloat + cashInTotal + deposits - withdrawals);

    return {
      id: s.id,
      openedAt: new Date(s.openedAt).toISOString(),
      cashier: { id: s.cashierId, label: `${name}${alias}` },
      openingFloat,
      status: String(s.status ?? ""),
      openingCounted: s.openingCounted == null ? null : toNum(s.openingCounted),
      openingVerifiedAt: s.openingVerifiedAt
        ? new Date(s.openingVerifiedAt).toISOString()
        : null,
      openingDisputeNote: s.openingDisputeNote ?? null,
      closingTotal: s.closingTotal == null ? null : toNum(s.closingTotal),
      deviceId: s.deviceId ?? null,
      expectedDrawer,
      cashInFromSales,
      cashInFromAr,
      cashInTotal,
      deposits,
      withdrawals,
    };
  });

  return json<LoaderData>({
    me: { userId: me.userId, role: me.role },
    cashiers,
    openShifts,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);
  const fd = await request.formData();
  const act = String(fd.get("_action") || "");

  if (act !== "open" && act !== "close" && act !== "resend") {
    return json({ ok: false, error: "Unknown action" }, { status: 400 });
  }

  if (act === "resend") {
    const shiftId = Number(fd.get("shiftId") || 0);
    if (!shiftId) {
      return json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }

    // optional: manager can adjust openingFloat before re-sending
    const openingFloatRaw = fd.get("openingFloat");
    const hasOpeningFloat =
      openingFloatRaw !== null && String(openingFloatRaw).trim() !== "";
    const openingFloat = hasOpeningFloat ? Number(openingFloatRaw) : null;
    if (
      hasOpeningFloat &&
      (!Number.isFinite(openingFloat!) || openingFloat! < 0)
    ) {
      return json(
        { ok: false, error: "Opening float must be a valid number (>= 0)." },
        { status: 400 },
      );
    }

    await db.$transaction(
      async (tx) => {
        const s = await tx.cashierShift.findUnique({
          where: { id: shiftId },
          select: { id: true, closedAt: true, status: true },
        });
        if (!s) throw new Response("Shift not found", { status: 404 });
        if (s.closedAt) return; // idempotent

        // Only allow resend when it makes sense (avoid reopening submitted/closed flows)
        const st = String(s.status || "");
        const allowed = st === "OPENING_DISPUTED" || st === "PENDING_ACCEPT";
        if (!allowed) {
          throw new Response(`Cannot resend in status ${st}.`, { status: 400 });
        }

        await tx.cashierShift.update({
          where: { id: shiftId },
          data: {
            status: "PENDING_ACCEPT" as any,
            ...(hasOpeningFloat ? { openingFloat: openingFloat as any } : null),
            // Reset acceptance fields so cashier can verify again
            openingCounted: null,
            openingVerifiedAt: null,
            openingVerifiedById: null,
            openingDisputeNote: null,
          },
        });
      },
      { isolationLevel: "Serializable" as any },
    );

    return redirect("/store/cashier-shifts");
  }

  if (act === "close") {
    const shiftId = Number(fd.get("shiftId") || 0);
    const managerCountedRaw = String(fd.get("managerCounted") || "").trim();
    const managerCounted = Number(managerCountedRaw);
    const requestedResolution = String(fd.get("resolution") || "").trim();
    const managerNote = String(fd.get("managerNote") || "").trim();
    const paperRefNo = String(fd.get("paperRefNo") || "").trim();

    if (!shiftId) {
      return json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }
    if (
      !managerCountedRaw.length ||
      !Number.isFinite(managerCounted) ||
      managerCounted < 0
    ) {
      return json(
        { ok: false, error: "Manager recount total is required (>= 0)." },
        { status: 400 },
      );
    }
    if (
      requestedResolution.length &&
      !["CHARGE_CASHIER", "INFO_ONLY", "WAIVE"].includes(requestedResolution)
    ) {
      return json(
        { ok: false, error: "Invalid manager decision selected." },
        { status: 400 },
      );
    }

    const now = new Date();
    await db.$transaction(
      async (tx) => {
        const s = await tx.cashierShift.findUnique({
          where: { id: shiftId },
          select: {
            id: true,
            closedAt: true,
            status: true,
            openingFloat: true,
            closingTotal: true,
            notes: true,
            cashierId: true,
          },
        });
        if (!s) throw new Response("Shift not found", { status: 404 });
        if (s.closedAt) return; // idempotent

        // 🔒 Gate: manager cannot final-close unless cashier submitted count
        if (String(s.status) !== "SUBMITTED") {
          throw new Response(
            "Cannot close: cashier has not submitted counted cash yet.",
            { status: 400 },
          );
        }
        if (s.closingTotal == null) {
          throw new Response(
            "Cannot close: cashier submitted status but counted cash is missing.",
            { status: 400 },
          );
        }

        const openingFloat = r2(toNum(s.openingFloat));
        const { expectedDrawer } = await computeExpectedDrawerForShift(
          tx as any,
          shiftId,
          openingFloat,
        );
        const managerCountedR2 = r2(managerCounted);
        const cashierCounted = r2(toNum(s.closingTotal));
        const variance = r2(managerCountedR2 - expectedDrawer);
        const hasMismatch = Math.abs(variance) >= EPS;
        const isShort = variance < -EPS;
        const resolution =
          hasMismatch && !isShort && !requestedResolution
            ? "INFO_ONLY"
            : requestedResolution;

        if (isShort && !resolution) {
          throw new Response(
            "Manager decision is required before closing a short drawer.",
            { status: 400 },
          );
        }
        if (isShort && !paperRefNo) {
          throw new Response(
            "Paper reference number is required when drawer is short.",
            { status: 400 },
          );
        }
        if (resolution === "CHARGE_CASHIER" && !isShort) {
          throw new Response(
            "CHARGE_CASHIER is only allowed for shortage variances.",
            { status: 400 },
          );
        }

        const shiftAuditNote = [
          "[MANAGER_RECOUNT]",
          `expected=${expectedDrawer.toFixed(2)}`,
          `cashier=${cashierCounted.toFixed(2)}`,
          `manager=${managerCountedR2.toFixed(2)}`,
          `variance=${variance.toFixed(2)}`,
          resolution ? `decision=${resolution}` : null,
          paperRefNo ? `paperRef=${paperRefNo}` : null,
          managerNote ? `note=${managerNote}` : null,
        ]
          .filter(Boolean)
          .join(" | ");

        let nextShiftNote = (s.notes || "").trim();
        nextShiftNote = nextShiftNote
          ? `${nextShiftNote}\n${shiftAuditNote}`
          : shiftAuditNote;

        if (hasMismatch) {
          const resolvedAt = resolution === "WAIVE" ? now : null;
          const managerApprovedAt = resolution ? now : null;
          const managerApprovedById = resolution ? me.userId : null;
          const nextStatus =
            resolution === "WAIVE"
              ? "WAIVED"
              : resolution
              ? "MANAGER_APPROVED"
              : "OPEN";

          const varianceRow = await tx.cashierShiftVariance.upsert({
            where: { shiftId },
            create: {
              shiftId,
              expected: expectedDrawer,
              counted: managerCountedR2,
              variance,
              status: nextStatus as any,
              resolution: resolution ? (resolution as any) : null,
              note: shiftAuditNote,
              managerApprovedAt,
              managerApprovedById,
              resolvedAt,
            },
            update: {
              expected: expectedDrawer,
              counted: managerCountedR2,
              variance,
              status: nextStatus as any,
              resolution: resolution ? (resolution as any) : null,
              note: shiftAuditNote,
              managerApprovedAt,
              managerApprovedById,
              resolvedAt,
            },
          });

          if (resolution === "CHARGE_CASHIER" && isShort) {
            const amountToCharge = r2(Math.abs(variance));
            const chargeNote = [
              CASHIER_CHARGE_TAG,
              `shift#${shiftId}`,
              `expected=${expectedDrawer.toFixed(2)}`,
              `managerCounted=${managerCountedR2.toFixed(2)}`,
              paperRefNo ? `paperRef=${paperRefNo}` : null,
              managerNote || null,
            ]
              .filter(Boolean)
              .join(" | ");

            await tx.cashierCharge.upsert({
              where: { varianceId: varianceRow.id },
              create: {
                varianceId: varianceRow.id,
                shiftId,
                cashierId: s.cashierId,
                amount: amountToCharge,
                status: "OPEN" as any,
                createdById: me.userId,
                note: chargeNote,
              },
              update: {
                shiftId,
                cashierId: s.cashierId,
                amount: amountToCharge,
                status: "OPEN" as any,
                note: chargeNote,
              },
            });
          }
        }

        await tx.cashierShift.update({
          where: { id: shiftId },
          data: {
            status: "FINAL_CLOSED" as any,
            closedAt: now,
            finalClosedById: me.userId,
            notes: nextShiftNote,
          },
        });
      },
      { isolationLevel: "Serializable" as any },
    );

    return redirect("/store/cashier-shifts");
  }

  const cashierId = Number(fd.get("cashierId") || 0);
  const openingFloat = Number(fd.get("openingFloat") || 0);
  const deviceId = String(fd.get("deviceId") || "").trim() || null;

  if (!cashierId) {
    return json(
      { ok: false, action: "open", error: "Select a cashier." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(openingFloat) || openingFloat < 0) {
    return json(
      {
        ok: false,
        action: "open",
        error: "Opening float must be a valid number (>= 0).",
      },
      { status: 400 },
    );
  }

  // No-branch mode: still need a branchId in DB if schema requires it.
  // We auto-pick the first branch.
  const branch = await db.branch.findFirst({
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (!branch?.id) {
    return json(
      {
        ok: false,
        action: "open",
        error: "No branch configured. Seed a branch first.",
      },
      { status: 500 },
    );
  }

  let openOutcome: { result: OpenActionResult; shiftId: number };
  try {
    openOutcome = await db.$transaction(
      async (tx) => {
        // ✅ Validate cashierId belongs to an actual CASHIER user
        const u = await tx.user.findUnique({
          where: { id: cashierId },
          select: { id: true, role: true },
        });
        if (!u || String(u.role) !== "CASHIER") {
          throw new Error("Selected user is not a CASHIER.");
        }

        // ✅ Prevent multiple open shifts per cashier (race-safe)
        const existing = await tx.cashierShift.findFirst({
          where: { cashierId, closedAt: null },
          select: { id: true },
          orderBy: { openedAt: "desc" },
        });
        if (existing?.id) {
          return { result: "exists" as const, shiftId: Number(existing.id) };
        }

        const created = await tx.cashierShift.create({
          data: {
            cashierId,
            branchId: branch.id,
            openingFloat,
            deviceId,
            // status defaults to PENDING_ACCEPT (cashier must verify opening float)
          },
          select: { id: true },
        });
        return { result: "created" as const, shiftId: Number(created.id) };
      },
      { isolationLevel: "Serializable" as any },
    );
  } catch (e: any) {
    const message = String(e?.message || "Failed to open shift.");
    const status =
      message === "Selected user is not a CASHIER." ? 400 : 500;
    return json(
      { ok: false, action: "open", error: message },
      { status },
    );
  }

  const qs = new URLSearchParams({
    openResult: openOutcome.result,
    shiftId: String(openOutcome.shiftId),
  });
  return redirect(`/store/cashier-shifts?${qs.toString()}`);
}

export default function StoreCashierShiftsPage() {
  const { me, cashiers, openShifts } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const [searchParams] = useSearchParams();
  const nav = useNavigation();
  const openResultRaw = String(searchParams.get("openResult") || "");
  const openResult: OpenActionResult | null =
    openResultRaw === "created" || openResultRaw === "exists"
      ? openResultRaw
      : null;
  const selectedShiftIdRaw = Number(searchParams.get("shiftId") || 0);
  const selectedShiftId =
    Number.isInteger(selectedShiftIdRaw) && selectedShiftIdRaw > 0
      ? selectedShiftIdRaw
      : null;
  const openActionError =
    actionData && actionData.action === "open" ? actionData.error : null;

  React.useEffect(() => {
    if (!selectedShiftId) return;
    const el = document.getElementById(`open-shift-${selectedShiftId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedShiftId]);

  const makeDefaultCloseForm = (
    shift?: OpenShiftRow,
  ): {
    managerCounted: string;
    resolution: "" | "CHARGE_CASHIER" | "INFO_ONLY" | "WAIVE";
    paperRefNo: string;
    managerNote: string;
  } => ({
    managerCounted: String(shift?.closingTotal ?? shift?.expectedDrawer ?? 0),
    resolution: "",
    paperRefNo: "",
    managerNote: "",
  });

  const [closeFormByShift, setCloseFormByShift] = React.useState<
    Record<
      number,
      {
        managerCounted: string;
        resolution: "" | "CHARGE_CASHIER" | "INFO_ONLY" | "WAIVE";
        paperRefNo: string;
        managerNote: string;
      }
    >
  >({});

  React.useEffect(() => {
    setCloseFormByShift((prev) => {
      const next = { ...prev };
      for (const s of openShifts) {
        if (next[s.id]) continue;
        next[s.id] = makeDefaultCloseForm(s);
      }
      return next;
    });
  }, [openShifts]);

  const statusLabel = (s: string) => {
    switch (s) {
      case "PENDING_ACCEPT":
        return "PENDING ACCEPT";
      case "OPEN":
        return "OPEN";
      case "OPENING_DISPUTED":
        return "OPENING DISPUTED";
      case "SUBMITTED":
        return "COUNT SUBMITTED";
      case "RECOUNT_REQUIRED":
        return "RECOUNT REQUIRED";
      case "FINAL_CLOSED":
        return "FINAL CLOSED";
      default:
        return String(s);
    }
  };

  const statusPill = (s: string) => {
    const base =
      "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold";
    if (s === "OPEN") {
      return base + " border-emerald-200 bg-emerald-50 text-emerald-700";
    }
    if (s === "SUBMITTED") {
      return base + " border-amber-200 bg-amber-50 text-amber-800";
    }
    if (s === "OPENING_DISPUTED") {
      return base + " border-rose-200 bg-rose-50 text-rose-700";
    }
    if (s === "PENDING_ACCEPT") {
      return base + " border-slate-200 bg-slate-50 text-slate-700";
    }
    return base + " border-slate-200 bg-slate-50 text-slate-700";
  };

  const setCloseField = (
    shiftId: number,
    field: "managerCounted" | "resolution" | "paperRefNo" | "managerNote",
    value: string,
  ) => {
    const shift = openShifts.find((x) => x.id === shiftId);
    setCloseFormByShift((prev) => ({
      ...prev,
      [shiftId]: {
        ...makeDefaultCloseForm(shift),
        ...(prev[shiftId] ?? {}),
        [field]: value,
      },
    }));
  };

  const printVarianceForm = (s: OpenShiftRow) => {
    const current = closeFormByShift[s.id] ?? makeDefaultCloseForm(s);

    const paperRef = current.paperRefNo || generatePaperRefNo(s.id);
    if (!current.paperRefNo) {
      setCloseField(s.id, "paperRefNo", paperRef);
    }

    const managerCounted = r2(Number(current.managerCounted || 0));
    const expected = r2(Number(s.expectedDrawer || 0));
    const cashierCounted = r2(Number(s.closingTotal || 0));
    const variance = r2(managerCounted - expected);
    const varianceLabel =
      Math.abs(variance) < EPS ? "MATCH" : variance < 0 ? "SHORT" : "OVER";

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Cashier Variance Recount Form</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
    .sheet { width: 100%; max-width: 190mm; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: 18px; }
    .meta { font-size: 11px; color: #334155; margin-bottom: 10px; }
    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .row { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
    .k { color: #475569; }
    .v { font-weight: 600; }
    .note { min-height: 32px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; font-size: 12px; }
    .sig { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .sigline { margin-top: 32px; border-top: 1px solid #334155; padding-top: 4px; font-size: 11px; color: #475569; }
    .small { font-size: 10px; color: #64748b; }
  </style>
</head>
<body>
  <div class="sheet">
    <h1>Cashier Variance Recount Form</h1>
    <div class="meta">Paper Ref: <strong>${escapeHtml(paperRef)}</strong> • Printed: ${escapeHtml(new Date().toLocaleString())}</div>

    <div class="card grid">
      <div class="row"><span class="k">Shift ID</span><span class="v">#${s.id}</span></div>
      <div class="row"><span class="k">Cashier</span><span class="v">${escapeHtml(s.cashier.label)}</span></div>
      <div class="row"><span class="k">Opened</span><span class="v">${escapeHtml(new Date(s.openedAt).toLocaleString())}</span></div>
      <div class="row"><span class="k">Manager</span><span class="v">#${me.userId} (${escapeHtml(me.role)})</span></div>
      <div class="row"><span class="k">Device</span><span class="v">${escapeHtml(s.deviceId ?? "—")}</span></div>
      <div class="row"><span class="k">Status</span><span class="v">${escapeHtml(statusLabel(s.status))}</span></div>
    </div>

    <div class="card">
      <div class="row"><span class="k">Expected Drawer</span><span class="v">${escapeHtml(peso(expected))}</span></div>
      <div class="row"><span class="k">Cashier Counted</span><span class="v">${escapeHtml(peso(cashierCounted))}</span></div>
      <div class="row"><span class="k">Manager Recount</span><span class="v">${escapeHtml(peso(managerCounted))}</span></div>
      <div class="row"><span class="k">Variance (manager - expected)</span><span class="v">${escapeHtml(peso(variance))} (${escapeHtml(varianceLabel)})</span></div>
      <div class="row"><span class="k">Decision</span><span class="v">${escapeHtml(current.resolution || "PENDING")}</span></div>
      <div class="small" style="margin-top:8px;">Cash in ${escapeHtml(peso(s.cashInTotal))} (Sales ${escapeHtml(peso(s.cashInFromSales))} + A/R ${escapeHtml(peso(s.cashInFromAr))}) • Dep ${escapeHtml(peso(s.deposits))} • W/D ${escapeHtml(peso(s.withdrawals))}</div>
    </div>

    <div class="card">
      <div class="k" style="font-size:11px; margin-bottom:4px;">Manager Note</div>
      <div class="note">${escapeHtml(current.managerNote || "")}</div>
    </div>

    <div class="sig">
      <div>
        <div class="sigline">Cashier Signature / Date</div>
      </div>
      <div>
        <div class="sigline">Manager Signature / Date</div>
      </div>
    </div>
  </div>
</body>
</html>`;

    const w = window.open("about:blank", "_blank", "width=960,height=1200");
    if (!w) {
      window.alert("Popup blocked. Please allow popups for printing.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    window.setTimeout(() => {
      try {
        w.print();
      } catch {
        // no-op; user can still print manually from opened window
      }
    }, 120);
  };

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-6xl px-5 py-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Cashier Shifts
            </h1>
            <p className="text-sm text-slate-600">
              Manager opens shifts. Cashier console is resume-only.
              <span className="text-slate-400"> • </span>
              <span className="font-medium">Signed in:</span>{" "}
              <span className="font-mono">#{me.userId}</span> ({me.role})
            </p>
          </div>
          <Link
            to="/store"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {openResult && selectedShiftId ? (
          <div
            className={
              "rounded-xl border px-4 py-3 text-sm " +
              (openResult === "created"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-900")
            }
          >
            {openResult === "created"
              ? `Shift #${selectedShiftId} opened successfully. Cashier can now verify opening float in Shift Console.`
              : `Cashier already has an open shift (#${selectedShiftId}). No new shift was created.`}
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-sm font-medium text-slate-800">
              Open a shift
            </div>
          </div>
          <div className="px-4 py-4">
            <Form method="post" className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="_action" value="open" />

              <label className="block text-sm sm:col-span-1">
                <span className="text-slate-700">Cashier</span>
                <select
                  name="cashierId"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                  defaultValue=""
                  required
                >
                  <option value="" disabled>
                    Select cashier…
                  </option>
                  {cashiers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm sm:col-span-1">
                <span className="text-slate-700">Opening float</span>
                <input
                  name="openingFloat"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue="0"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="block text-sm sm:col-span-1">
                <span className="text-slate-700">Device ID (optional)</span>
                <input
                  name="deviceId"
                  type="text"
                  placeholder="e.g. CASHIER-01"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              {openActionError ? (
                <div className="sm:col-span-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {openActionError}
                </div>
              ) : null}

              <div className="sm:col-span-3">
                <button
                  type="submit"
                  className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                  disabled={nav.state !== "idle"}
                >
                  {nav.state !== "idle" ? "Opening…" : "Open Shift"}
                </button>
              </div>
            </Form>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-800">
              Open shifts
            </div>
            <span className="text-xs text-slate-500">
              {openShifts.length} open
            </span>
          </div>
          <div className="px-4 py-4">
            {openShifts.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                No open shifts.
              </div>
            ) : (
              <div className="grid gap-2">
                {openShifts.map((s) => (
                  (() => {
                    const closeForm = closeFormByShift[s.id] ?? {
                      managerCounted: String(s.closingTotal ?? s.expectedDrawer ?? 0),
                      resolution: "",
                      paperRefNo: "",
                      managerNote: "",
                    };
                    const managerCountedNum = Number(closeForm.managerCounted || 0);
                    const expectedNum = Number(s.expectedDrawer || 0);
                    const varianceNum = r2(managerCountedNum - expectedNum);
                    const isShortDraft = varianceNum < -EPS;
                    const isSelectedShift =
                      selectedShiftId != null && s.id === selectedShiftId;
                    return (
                  <div
                    key={s.id}
                    id={`open-shift-${s.id}`}
                    className={
                      "rounded-xl border bg-white px-3 py-2 text-sm " +
                      (isSelectedShift
                        ? "border-emerald-300 ring-2 ring-emerald-100"
                        : "border-slate-200")
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">
                          Shift #{s.id} • {s.cashier.label}
                        </div>
                        <div className="text-xs text-slate-500">
                          Opened {new Date(s.openedAt).toLocaleString()}
                          {s.deviceId ? <> • Device {s.deviceId}</> : null}
                        </div>
                        <div className="mt-1">
                          <span className={statusPill(s.status)}>
                            {statusLabel(s.status)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="text-xs text-slate-500">
                          Opening float
                        </div>
                        <div className="font-semibold text-slate-900">
                          {peso(s.openingFloat)}
                        </div>
                      </div>
                    </div>
                    {/* Opening acceptance */}
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-slate-500">
                          Cashier opening count
                        </div>
                        <div className="font-semibold tabular-nums text-slate-900">
                          {s.openingCounted == null
                            ? "—"
                            : peso(s.openingCounted)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {s.openingVerifiedAt
                            ? `Verified ${new Date(
                                s.openingVerifiedAt,
                              ).toLocaleString()}`
                            : "Not yet verified"}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2 sm:col-span-2">
                        <div className="text-[11px] text-slate-500">
                          Dispute note
                        </div>
                        <div className="text-[12px] text-slate-800">
                          {s.openingDisputeNote ? s.openingDisputeNote : "—"}
                        </div>
                      </div>
                    </div>
                    {/* Expected drawer + cashier counted */}
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-slate-500">
                          Expected drawer
                        </div>
                        <div className="font-semibold tabular-nums text-slate-900">
                          {peso(s.expectedDrawer)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          Cash in {peso(s.cashInTotal)} (Sales{" "}
                          {peso(s.cashInFromSales)} + A/R{" "}
                          {peso(s.cashInFromAr)}) · Dep {peso(s.deposits)} ·
                          W/D {peso(s.withdrawals)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-slate-500">
                          Cashier counted
                        </div>
                        <div className="font-semibold tabular-nums text-slate-900">
                          {s.closingTotal == null ? "—" : peso(s.closingTotal)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-slate-500">Diff</div>
                        <div
                          className={[
                            "font-semibold tabular-nums",
                            s.closingTotal == null
                              ? "text-slate-600"
                              : Math.abs(s.closingTotal - s.expectedDrawer) <
                                0.005
                              ? "text-slate-700"
                              : s.closingTotal - s.expectedDrawer > 0
                              ? "text-emerald-700"
                              : "text-rose-700",
                          ].join(" ")}
                        >
                          {s.closingTotal == null
                            ? "Waiting cashier count"
                            : `${
                                s.closingTotal - s.expectedDrawer >= 0
                                  ? "+"
                                  : ""
                              }${peso(
                                Math.round(
                                  (s.closingTotal - s.expectedDrawer) * 100,
                                ) / 100,
                              )}`}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-slate-500">
                        Cashier resume: <code>/cashier/shift</code>
                      </div>
                      {/* Manager resend when opening is disputed */}
                      {String(s.status) === "OPENING_DISPUTED" ? (
                        <Form
                          method="post"
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            if (
                              !confirm(
                                "Resend opening verification to cashier?",
                              )
                            ) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="_action" value="resend" />
                          <input type="hidden" name="shiftId" value={s.id} />
                          {/* Optional: allow manager to edit opening float inline */}
                          <input
                            name="openingFloat"
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={String(s.openingFloat ?? 0)}
                            className="w-[140px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                            title="Optional: adjust opening float before resend"
                          />
                          <button
                            type="submit"
                            className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                            disabled={nav.state !== "idle"}
                            title="Set status back to PENDING_ACCEPT so cashier can verify again"
                          >
                            {nav.state !== "idle" ? "Sending…" : "Resend"}
                          </button>
                        </Form>
                      ) : null}

                      <Form
                        method="post"
                        className="grid w-full gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 sm:max-w-3xl sm:grid-cols-2"
                        onSubmit={(e) => {
                          if (String(s.status) !== "SUBMITTED") return;
                          if (isShortDraft && !closeForm.resolution) {
                            e.preventDefault();
                            window.alert(
                              "Shortage detected: please select a decision before final close.",
                            );
                            return;
                          }
                          if (
                            isShortDraft &&
                            !String(closeForm.paperRefNo || "").trim()
                          ) {
                            e.preventDefault();
                            window.alert(
                              "Shortage detected: paper reference number is required before final close.",
                            );
                            return;
                          }
                          if (!confirm("Manager close this shift now?"))
                            e.preventDefault();
                        }}
                      >
                        <input type="hidden" name="_action" value="close" />
                        <input type="hidden" name="shiftId" value={s.id} />
                        <label className="block">
                          <span className="text-[11px] text-slate-600">
                            Manager recount total
                          </span>
                          <input
                            name="managerCounted"
                            type="number"
                            step="0.01"
                            min="0"
                            value={closeForm.managerCounted}
                            onChange={(e) =>
                              setCloseField(s.id, "managerCounted", e.target.value)
                            }
                            required
                            disabled={String(s.status) !== "SUBMITTED"}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums disabled:bg-slate-100"
                            title="Required: manager physical recount total"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[11px] text-slate-600">
                            Decision (required if short)
                          </span>
                          <select
                            name="resolution"
                            value={closeForm.resolution}
                            onChange={(e) =>
                              setCloseField(s.id, "resolution", e.target.value)
                            }
                            disabled={String(s.status) !== "SUBMITTED"}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                          >
                            <option value="">No decision</option>
                            <option value="CHARGE_CASHIER">
                              Charge cashier
                            </option>
                            <option value="INFO_ONLY">Info only</option>
                            <option value="WAIVE">Waive</option>
                          </select>
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="text-[11px] text-slate-600">
                            Paper reference no. (required if short)
                          </span>
                          <input
                            name="paperRefNo"
                            type="text"
                            placeholder="e.g. CS-2026-00125"
                            value={closeForm.paperRefNo}
                            onChange={(e) =>
                              setCloseField(s.id, "paperRefNo", e.target.value)
                            }
                            disabled={String(s.status) !== "SUBMITTED"}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                          />
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="text-[11px] text-slate-600">
                            Manager note
                          </span>
                          <input
                            name="managerNote"
                            type="text"
                            placeholder="Optional decision/recount note"
                            value={closeForm.managerNote}
                            onChange={(e) =>
                              setCloseField(s.id, "managerNote", e.target.value)
                            }
                            disabled={String(s.status) !== "SUBMITTED"}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                          />
                        </label>
                        {isShortDraft ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-2">
                            Shortage detected. Select decision and paper
                            reference before final close.
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:col-span-2"
                          disabled={String(s.status) !== "SUBMITTED"}
                          onClick={() => printVarianceForm(s)}
                          title="Print A4 variance recount form and auto-fill reference number"
                        >
                          Print variance form (A4)
                        </button>
                        <button
                          type="submit"
                          className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 sm:col-span-2"
                          disabled={
                            nav.state !== "idle" ||
                            String(s.status) !== "SUBMITTED"
                          }
                          title={
                            String(s.status) !== "SUBMITTED"
                              ? "Disabled: cashier has not submitted count (status must be SUBMITTED)"
                              : "Final close shift (requires manager recount; shortage also requires decision + paper ref)"
                          }
                        >
                          {nav.state !== "idle"
                            ? "Closing…"
                            : "Final close shift"}
                        </button>
                      </Form>
                    </div>
                  </div>
                    );
                  })()
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
