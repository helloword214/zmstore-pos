/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireRole, getUser, setShiftId } from "~/utils/auth.server";
import { CashDrawerTxnType } from "@prisma/client";

type LoaderData = {
  me: {
    userId: number;
    role: "ADMIN" | "CASHIER" | "SELLER";
    branchIds: number[];
    shiftId: number | null;
  };
  branches: Array<{ id: number; name: string }>;
  activeShift: null | {
    id: number;
    openedAt: string;
    branchName: string;
    deviceId?: string | null;
    openingFloat: number | null;
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
    cashDrawerIn: number; // tendered - change for CASH
  };

  // computed cash drawer snapshot
  drawer?: {
    openingFloat: number;
    cashInFromSales: number;
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
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["CASHIER", "ADMIN"]);

  // Single-branch mode: pick user's first branch; else first branch in DB
  let pickedBranch: { id: number; name: string } | null = null;
  if (me.branchIds.length) {
    pickedBranch =
      (await db.branch.findUnique({
        where: { id: me.branchIds[0] },
        select: { id: true, name: true },
      })) ?? null;
  }
  if (!pickedBranch) {
    pickedBranch = await db.branch.findFirst({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
  if (!pickedBranch) {
    throw new Response("No branch configured. Seed a branch first.", {
      status: 500,
    });
  }
  const branches = [pickedBranch];

  // If session shiftId exists, check if still open; if closed, clear session now
  let activeShift: LoaderData["activeShift"] = null;
  let headers: Record<string, string> | undefined;
  if (me.shiftId) {
    const s = await db.cashierShift.findUnique({
      where: { id: me.shiftId },
      include: { branch: { select: { name: true } } },
    });
    if (s && !s.closedAt) {
      activeShift = {
        id: s.id,
        openedAt: s.openedAt.toISOString(),
        branchName: s.branch?.name ?? "—",
        deviceId: s.deviceId,
        openingFloat: s.openingFloat ? Number(s.openingFloat) : 0,
      };
    } else {
      // stale cookie → clear
      const cleared = await setShiftId(request, null);
      headers = cleared.headers;
    }
  }

  let totals: LoaderData["totals"] = undefined;
  let drawer: LoaderData["drawer"] = undefined;
  let paymentsRecent: LoaderData["paymentsRecent"] = undefined;

  if (activeShift) {
    const byMethod = await db.payment.groupBy({
      by: ["method"],
      where: { shiftId: activeShift.id },
      _sum: { amount: true, tendered: true, change: true },
    });
    const grandAmount = byMethod.reduce(
      (s, r) => s + Number(r._sum.amount ?? 0),
      0
    );
    const cashRow = byMethod.find((r) => r.method === "CASH");
    const cashDrawerIn =
      Number(cashRow?._sum.tendered ?? 0) - Number(cashRow?._sum.change ?? 0);
    totals = {
      byMethod: byMethod.map((r) => ({
        method: r.method,
        amount: Number(r._sum.amount ?? 0),
        tendered: (r._sum.tendered as any) ? Number(r._sum.tendered) : null,
        change: (r._sum.change as any) ? Number(r._sum.change) : null,
      })),
      grandAmount,
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
      cashInFromSales: cashDrawerIn,
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
    me: { ...me, shiftId: me.shiftId ?? null },
    branches,
    activeShift,
    ...(totals ? { totals } : {}),
    ...(drawer ? { drawer } : {}),
    ...(paymentsRecent ? { paymentsRecent } : {}),
  };
  return json(payload, {
    headers: { ...(headers ?? {}), "Cache-Control": "no-store" },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await getUser(request);
  if (!me) return redirect("/login");

  const fd = await request.formData();
  const act = String(fd.get("_action") || "");

  if (act === "open") {
    if (me.shiftId) return redirect("/cashier"); // already open
    const branchId = Number(fd.get("branchId") || 0);
    const openingFloat = Number(fd.get("openingFloat") || 0);
    const deviceId = String(fd.get("deviceId") || "").trim() || null;
    if (!branchId) {
      return json({ ok: false, error: "Select a branch" }, { status: 400 });
    }
    const shift = await db.cashierShift.create({
      data: {
        cashierId: me.userId,
        branchId,
        openingFloat: Number.isFinite(openingFloat) ? openingFloat : undefined,
        deviceId,
      },
      select: { id: true },
    });
    const { headers } = await setShiftId(request, shift.id);
    return redirect("/cashier", { headers });
  }

  // ── Cash Drawer: deposit / withdraw
  if (act === "drawer:deposit" || act === "drawer:withdraw") {
    if (!me.shiftId) return redirect("/cashier/shift");
    const amount = Number(fd.get("amount") || 0);
    const note = String(fd.get("note") || "").trim() || null;
    if (!Number.isFinite(amount) || amount <= 0) {
      return json(
        { ok: false, error: "Enter a valid amount > 0" },
        { status: 400 }
      );
    }
    await db.cashDrawerTxn.create({
      data: {
        shiftId: me.shiftId,
        type:
          act === "drawer:deposit"
            ? CashDrawerTxnType.CASH_IN
            : CashDrawerTxnType.CASH_OUT,
        amount,
        note,
        createdById: me.userId,
      },
    });
    return redirect("/cashier/shift");
  }

  if (act === "close") {
    if (!me.shiftId) return redirect("/cashier/shift"); // nothing to close
    const notes = String(fd.get("notes") || "").trim() || null;

    // Compute totals for record
    const byMethod = await db.payment.groupBy({
      by: ["method"],
      where: { shiftId: me.shiftId },
      _sum: { amount: true, tendered: true, change: true },
    });
    const grandAmount = byMethod.reduce(
      (s, r) => s + Number(r._sum.amount ?? 0),
      0
    );

    // Close it
    await db.cashierShift.update({
      where: { id: me.shiftId },
      data: {
        closedAt: new Date(),
        closingTotal: grandAmount,
        notes,
      },
    });
    const { headers } = await setShiftId(request, null);
    return redirect("/cashier", { headers });
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function ShiftConsole() {
  const { me, branches, activeShift, totals, drawer, paymentsRecent } =
    useLoaderData<LoaderData>();
  const nav = useNavigation();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-3xl px-5 py-6">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h1 className="text-lg font-semibold text-slate-900">
              Cashier Shift
            </h1>
            <p className="text-xs text-slate-600">
              User #{me.userId} • {me.role} • Branch access:{" "}
              {me.branchIds.join(", ") || "—"}
            </p>
          </div>

          {!activeShift ? (
            <div className="px-4 py-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                No active shift. Open one to proceed to cashier.
              </div>
              <Form method="post" className="space-y-3">
                <input type="hidden" name="_action" value="open" />
                {/* Single-branch mode: show chosen branch and pass hidden value */}
                <div className="text-sm text-slate-700">
                  Branch:{" "}
                  <span className="font-medium">{branches[0]?.name}</span>
                </div>
                <input
                  type="hidden"
                  name="branchId"
                  value={branches[0]?.id ?? ""}
                />
                <label className="block text-sm">
                  <span className="text-slate-700">
                    Opening float (optional)
                  </span>
                  <input
                    name="openingFloat"
                    type="number"
                    step="0.01"
                    min="0"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    placeholder="0.00"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-700">Device ID (optional)</span>
                  <input
                    name="deviceId"
                    type="text"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    placeholder="e.g. CASHIER-01"
                    defaultValue="CASHIER-01"
                  />
                </label>
                <div className="pt-2">
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
          ) : (
            <div className="px-4 py-4 space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-sm text-emerald-800">
                  Active shift{" "}
                  <span className="font-mono">#{activeShift.id}</span> • Branch:{" "}
                  <strong>{activeShift.branchName}</strong> • Opened:{" "}
                  {new Date(activeShift.openedAt).toLocaleString()} • Device:{" "}
                  {activeShift.deviceId || "—"}
                </div>
              </div>

              {totals ? (
                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-800">
                    Running totals (this shift)
                  </div>
                  <div className="px-3 py-3 space-y-2">
                    <div className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">
                          Booked revenue (all methods)
                        </span>
                        <span className="font-semibold">
                          {peso(totals.grandAmount)}
                        </span>
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">
                          Cash drawer in (tendered − change)
                        </span>
                        <span className="font-semibold">
                          {peso(totals.cashDrawerIn)}
                        </span>
                      </div>
                    </div>
                    <div className="pt-2">
                      <div className="text-xs text-slate-500 mb-1">
                        By method
                      </div>
                      <ul className="space-y-1">
                        {totals.byMethod.map((m) => (
                          <li
                            key={m.method}
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="text-slate-700">{m.method}</span>
                            <span className="font-medium">
                              {peso(m.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}
              {drawer ? (
                <div className="rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-800">
                    Cash drawer
                  </div>
                  <div className="px-3 py-3 grid gap-3 md:grid-cols-3">
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
                        In from sales (cash)
                      </div>
                      <div className="text-base font-semibold">
                        {peso(drawer.cashInFromSales)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Balance now</div>
                      <div className="text-base font-semibold">
                        {peso(drawer.balance)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3 md:col-span-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-700">Manual deposits</span>
                        <span className="font-semibold">
                          {peso(drawer.deposits)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-700">
                          Manual withdrawals
                        </span>
                        <span className="font-semibold">
                          {peso(drawer.withdrawals)}
                        </span>
                      </div>
                      <div className="mt-3">
                        <div className="text-xs text-slate-500 mb-1">
                          Recent transactions
                        </div>
                        <ul className="space-y-1 max-h-36 overflow-auto pr-1">
                          {drawer.recent.map((t) => (
                            <li
                              key={t.id}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="text-slate-700">
                                {new Date(t.createdAt).toLocaleString()} •{" "}
                                {t.type}
                                {t.note ? ` — ${t.note}` : ""}
                              </span>
                              <span className="font-medium">
                                {peso(t.amount)}
                              </span>
                            </li>
                          ))}
                          {drawer.recent.length === 0 && (
                            <li className="text-sm text-slate-500">
                              No drawer transactions.
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="md:col-span-3 grid gap-3 md:grid-cols-2">
                      <Form
                        method="post"
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <input
                          type="hidden"
                          name="_action"
                          value="drawer:deposit"
                        />
                        <div className="text-sm font-medium mb-2">Deposit</div>
                        <div className="flex flex-col gap-2 md:flex-row md:items-center">
                          <input
                            name="amount"
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm md:w-32"
                            placeholder="0.00"
                          />
                          <input
                            name="note"
                            type="text"
                            className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                            placeholder="Note (optional)"
                          />
                          <button
                            className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 md:w-auto"
                            disabled={nav.state !== "idle"}
                          >
                            Add
                          </button>
                        </div>
                      </Form>

                      <Form
                        method="post"
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <input
                          type="hidden"
                          name="_action"
                          value="drawer:withdraw"
                        />
                        <div className="text-sm font-medium mb-2">Withdraw</div>
                        <div className="flex items-center gap-2">
                          <input
                            name="amount"
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm md:w-32"
                            placeholder="0.00"
                          />
                          <input
                            name="note"
                            type="text"
                            className="w-full flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                            placeholder="Note (optional)"
                          />
                          <button
                            className="w-full rounded-xl bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 md:w-auto"
                            disabled={nav.state !== "idle"}
                          >
                            Take
                          </button>
                        </div>
                      </Form>
                    </div>
                  </div>
                </div>
              ) : null}
              {/* Recent payments for this shift */}
              {paymentsRecent && paymentsRecent.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-800">
                    Recent payments (this shift)
                  </div>
                  <div className="max-h-64 overflow-auto px-3 py-3">
                    <ul className="space-y-1 text-sm">
                      {paymentsRecent.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-3 border-b border-slate-100 last:border-b-0 py-1.5"
                        >
                          <div className="min-w-0">
                            <div className="text-xs text-slate-500">
                              {new Date(p.createdAt).toLocaleString()}
                            </div>
                            <div className="text-slate-800">
                              Payment #{p.id} • Order #{p.orderId} •{" "}
                              <span className="uppercase font-medium">
                                {p.method}
                              </span>
                            </div>
                          </div>
                          <div className="text-right text-xs tabular-nums">
                            <div className="font-semibold">
                              {peso(p.amount)}
                            </div>
                            {p.tendered != null && (
                              <div className="text-slate-600">
                                T: {peso(p.tendered)}
                              </div>
                            )}
                            {p.change != null && p.change !== 0 && (
                              <div className="text-slate-600">
                                Ch: {peso(p.change)}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <a
                  href="/cashier"
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  ← Back to Cashier
                </a>
                <Form
                  method="post"
                  className="ml-auto"
                  onSubmit={(e) => {
                    if (!confirm("Close current shift now?"))
                      e.preventDefault();
                  }}
                >
                  <input type="hidden" name="_action" value="close" />
                  <input type="hidden" name="id" value={activeShift.id} />
                  <div className="flex items-center gap-2">
                    <input
                      name="notes"
                      placeholder="Notes (optional)"
                      className="w-64 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
                      disabled={nav.state !== "idle"}
                    >
                      {nav.state !== "idle" ? "Closing…" : "Close Shift"}
                    </button>
                  </div>
                </Form>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
