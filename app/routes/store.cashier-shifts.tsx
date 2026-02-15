/* app/routes/store.cashier-shifts.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { peso, toNum } from "~/utils/money";
import { CashDrawerTxnType } from "@prisma/client";

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
  deposits: number;
  withdrawals: number; // CASH_OUT + DROP
};

type LoaderData = {
  me: { userId: number; role: string };
  cashiers: CashierOption[];
  openShifts: OpenShiftRow[];
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

  const payMap = new Map<number, { tendered: number; change: number }>();
  for (const r of payByShift as any[]) {
    const sid = Number((r as any).shiftId || 0);
    if (!sid) continue;
    payMap.set(sid, {
      tendered: toNum((r as any)?._sum?.tendered),
      change: toNum((r as any)?._sum?.change),
    });
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

  const r2 = (n: number) => Math.round(toNum(n) * 100) / 100;

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
    const t = txMap.get(Number(s.id)) || { in: 0, out: 0, drop: 0 };
    const deposits = r2(t.in);
    const withdrawals = r2(t.out + t.drop);
    const expectedDrawer = r2(
      openingFloat + cashInFromSales + deposits - withdrawals,
    );

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
    if (!shiftId) {
      return json({ ok: false, error: "Missing shiftId." }, { status: 400 });
    }

    const now = new Date();
    await db.$transaction(
      async (tx) => {
        const s = await tx.cashierShift.findUnique({
          where: { id: shiftId },
          select: { id: true, closedAt: true, status: true },
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

        await tx.cashierShift.update({
          where: { id: shiftId },
          data: {
            status: "FINAL_CLOSED" as any,
            closedAt: now,
            finalClosedById: me.userId,
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
    return json({ ok: false, error: "Select a cashier." }, { status: 400 });
  }
  if (!Number.isFinite(openingFloat) || openingFloat < 0) {
    return json(
      { ok: false, error: "Opening float must be a valid number (>= 0)." },
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
    throw new Response("No branch configured. Seed a branch first.", {
      status: 500,
    });
  }

  await db.$transaction(
    async (tx) => {
      // ✅ Validate cashierId belongs to an actual CASHIER user
      const u = await tx.user.findUnique({
        where: { id: cashierId },
        select: { id: true, role: true },
      });
      if (!u || String(u.role) !== "CASHIER") {
        throw new Response("Selected user is not a CASHIER.", { status: 400 });
      }

      // ✅ Prevent multiple open shifts per cashier (race-safe)
      const existing = await tx.cashierShift.findFirst({
        where: { cashierId, closedAt: null },
        select: { id: true },
        orderBy: { openedAt: "desc" },
      });
      if (existing?.id) return; // idempotent

      await tx.cashierShift.create({
        data: {
          cashierId,
          branchId: branch.id,
          openingFloat,
          deviceId,
          // status defaults to PENDING_ACCEPT (cashier must verify opening float)
        },
        select: { id: true },
      });
    },
    { isolationLevel: "Serializable" as any },
  );

  return redirect("/store/cashier-shifts");
}

export default function StoreCashierShiftsPage() {
  const { me, cashiers, openShifts } = useLoaderData<LoaderData>();
  const nav = useNavigation();

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
                  <div
                    key={s.id}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
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
                          Cash sales {peso(s.cashInFromSales)} · Dep{" "}
                          {peso(s.deposits)} · W/D {peso(s.withdrawals)}
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
                            className="w-[140px] rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                            title="Optional: adjust opening float before resend"
                          />
                          <button
                            type="submit"
                            className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                            disabled={nav.state !== "idle"}
                            title="Set status back to PENDING_ACCEPT so cashier can verify again"
                          >
                            {nav.state !== "idle" ? "Sending…" : "Resend"}
                          </button>
                        </Form>
                      ) : null}

                      <Form
                        method="post"
                        onSubmit={(e) => {
                          if (!confirm("Manager close this shift now?"))
                            e.preventDefault();
                        }}
                      >
                        <input type="hidden" name="_action" value="close" />
                        <input type="hidden" name="shiftId" value={s.id} />
                        <button
                          type="submit"
                          className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                          disabled={
                            nav.state !== "idle" ||
                            String(s.status) !== "SUBMITTED"
                          }
                          title={
                            String(s.status) !== "SUBMITTED"
                              ? "Disabled: cashier has not submitted count (status must be SUBMITTED)"
                              : "Final close shift (status SUBMITTED → FINAL_CLOSED)"
                          }
                        >
                          {nav.state !== "idle" ? "Closing…" : "Close shift"}
                        </button>
                      </Form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
