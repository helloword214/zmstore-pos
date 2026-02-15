/* app/routes/store.cashier-variances.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { Prisma } from "@prisma/client";

const CASHIER_CHARGE_TAG = "CASHIER_SHIFT_VARIANCE";

type Denoms = {
  bills?: Record<string, number>;
  coins?: Record<string, number>;
};

type LoaderData = {
  tab: "open" | "history";
  counts: { open: number; history: number };
  rows: Array<{
    id: number;
    status: string;
    resolution: string | null;
    createdAt: string;
    expected: number;
    counted: number;
    variance: number;
    note: string | null;
    managerApprovedAt: string | null;
    shift: {
      id: number;
      openedAt: string;
      closedAt: string | null;
      deviceId: string | null;
      closingDenoms: Denoms | null;
      cashier: { id: number; name: string; email: string | null };
    };
  }>;
};

const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

function peso(n: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number.isFinite(n) ? n : 0);
}

function safeTab(raw: string | null): LoaderData["tab"] {
  return raw === "history" ? "history" : "open";
}

function nameOfUser(u: any) {
  const emp = u?.employee;
  return (
    emp?.alias ||
    [emp?.firstName, emp?.lastName].filter(Boolean).join(" ") ||
    u?.email ||
    `User#${u?.id ?? "?"}`
  );
}

function normalizeDenoms(raw: any): Denoms | null {
  if (!raw || typeof raw !== "object") return null;
  const bills = raw.bills && typeof raw.bills === "object" ? raw.bills : {};
  const coins = raw.coins && typeof raw.coins === "object" ? raw.coins : {};
  // ensure numeric
  const clean = (o: Record<string, any>) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) {
      const n = Number(v);
      out[String(k)] = Number.isFinite(n) ? n : 0;
    }
    return out;
  };
  return { bills: clean(bills), coins: clean(coins) };
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  const url = new URL(request.url);
  const tab = safeTab(url.searchParams.get("tab"));

  // Badge counts
  const [openCount, historyCount] = await Promise.all([
    db.cashierShiftVariance.count({ where: { status: "OPEN" as any } }),
    db.cashierShiftVariance.count({
      where: {
        OR: [
          { status: { in: ["WAIVED", "CLOSED"] as any } },
          { status: "MANAGER_APPROVED" as any },
        ],
      },
    }),
  ]);

  const where: Prisma.CashierShiftVarianceWhereInput =
    tab === "open"
      ? { status: "OPEN" as any }
      : {
          OR: [
            { status: { in: ["WAIVED", "CLOSED"] as any } },
            { status: "MANAGER_APPROVED" as any },
          ],
        };

  const rows = await db.cashierShiftVariance.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: tab === "history" ? 150 : 250,
    select: {
      id: true,
      status: true,
      resolution: true,
      createdAt: true,
      expected: true,
      counted: true,
      variance: true,
      note: true,
      managerApprovedAt: true,
      shift: {
        select: {
          id: true,
          openedAt: true,
          closedAt: true,
          deviceId: true,
          closingDenoms: true,
          cashier: {
            select: {
              id: true,
              email: true,
              employee: {
                select: { firstName: true, lastName: true, alias: true },
              },
            },
          },
        },
      },
    },
  });

  const out: LoaderData = {
    tab,
    counts: { open: openCount, history: historyCount },
    rows: rows.map((v) => ({
      id: v.id,
      status: String(v.status ?? ""),
      resolution: v.resolution ? String(v.resolution) : null,
      createdAt: v.createdAt.toISOString(),
      expected: r2(Number(v.expected ?? 0)),
      counted: r2(Number(v.counted ?? 0)),
      variance: r2(Number(v.variance ?? 0)),
      note: v.note ?? null,
      managerApprovedAt: v.managerApprovedAt
        ? v.managerApprovedAt.toISOString()
        : null,
      shift: {
        id: v.shift.id,
        openedAt: v.shift.openedAt.toISOString(),
        closedAt: v.shift.closedAt ? v.shift.closedAt.toISOString() : null,
        deviceId: v.shift.deviceId ?? null,
        closingDenoms: normalizeDenoms(v.shift.closingDenoms),
        cashier: {
          id: v.shift.cashier.id,
          email: v.shift.cashier.email ?? null,
          name: nameOfUser(v.shift.cashier),
        },
      },
    })),
  };

  return json(out, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  const id = Number(fd.get("id"));
  const resolution = String(fd.get("resolution") || "");
  const note = String(fd.get("note") || "").trim();
  const tab = String(fd.get("tab") || "");
  const safeTab =
    tab === "history" || tab === "open" ? (tab as "history" | "open") : "open";

  if (intent !== "manager-decide")
    throw new Response("Unsupported intent", { status: 400 });
  if (!Number.isFinite(id) || id <= 0)
    throw new Response("Invalid variance id", { status: 400 });

  if (!["CHARGE_CASHIER", "INFO_ONLY", "WAIVE"].includes(resolution)) {
    throw new Response("Invalid resolution", { status: 400 });
  }

  const row = await db.cashierShiftVariance.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      shiftId: true,
      expected: true,
      counted: true,
      variance: true,
      note: true,
      shift: { select: { cashierId: true } },
    },
  });

  if (!row) throw new Response("Variance not found", { status: 404 });

  if (!["OPEN", "MANAGER_APPROVED"].includes(String(row.status ?? ""))) {
    throw new Response("Variance is not editable", { status: 400 });
  }

  const now = new Date();
  const nextStatus = resolution === "WAIVE" ? "WAIVED" : "MANAGER_APPROVED";
  const managerApprovedById = Number((me as any).userId) || null;
  await db.$transaction(async (tx) => {
    // 1) save manager decision on the variance row
    await tx.cashierShiftVariance.update({
      where: { id },
      data: {
        resolution: resolution as any,
        status: nextStatus as any,
        managerApprovedAt: now,
        managerApprovedById,
        note: note.length ? note : undefined,
        resolvedAt: resolution === "WAIVE" ? now : undefined,
      },
    });

    // 2) if CHARGE_CASHIER → create/update CashierCharge ledger (idempotent)
    if (resolution === "CHARGE_CASHIER") {
      const v = Number(row.variance ?? 0);
      // Business rule: charge only when SHORT (variance negative)
      // If OVER, we still allow manager to select CHARGE_CASHIER but it will not create a negative/invalid charge.
      const amountToCharge =
        v < -0.005 ? Math.round(Math.abs(v) * 100) / 100 : 0;

      if (amountToCharge > 0) {
        const cashierId = Number((row.shift as any)?.cashierId || 0);
        if (!cashierId)
          throw new Response("Shift cashier not found", { status: 400 });

        await tx.cashierCharge.upsert({
          where: { varianceId: row.id },
          create: {
            varianceId: row.id,
            shiftId: row.shiftId,
            cashierId,
            amount: new Prisma.Decimal(amountToCharge.toFixed(2)),
            status: "OPEN",
            createdById: managerApprovedById,
            note: [
              CASHIER_CHARGE_TAG,
              `shift#${row.shiftId}`,
              `expected=${Number(row.expected ?? 0)}`,
              `counted=${Number(row.counted ?? 0)}`,
              note || row.note || "",
            ]
              .filter(Boolean)
              .join(" | "),
          },
          update: {
            // keep it OPEN unless you later implement settlements/payroll
            amount: new Prisma.Decimal(amountToCharge.toFixed(2)),
            status: "OPEN",
            shiftId: row.shiftId,
            note: [
              CASHIER_CHARGE_TAG,
              `shift#${row.shiftId}`,
              `expected=${Number(row.expected ?? 0)}`,
              `counted=${Number(row.counted ?? 0)}`,
              note || row.note || "",
            ]
              .filter(Boolean)
              .join(" | "),
          },
        });
      }
    }
  });

  return redirect(`/store/cashier-variances?tab=${safeTab}`);
}

function DenomsTable({ denoms }: { denoms: Denoms | null }) {
  if (!denoms) return <span className="text-slate-400">—</span>;

  const billsOrder = ["1000", "500", "200", "100", "50", "20"];
  const coinsOrder = ["25", "10", "5", "1"];

  const bills = denoms.bills ?? {};
  const coins = denoms.coins ?? {};

  // NOTE: "25" is 25 centavos, not ₱25
  const denomValue = (d: string) => {
    if (d === "25") return 0.25;
    const n = Number(d);
    return Number.isFinite(n) ? n : 0;
  };
  const sumPart = (order: string[], map: Record<string, number>) =>
    order.reduce((acc, d) => acc + Number(map[d] || 0) * denomValue(d), 0);

  const billsTotal = sumPart(billsOrder, bills);
  const coinsTotal = sumPart(coinsOrder, coins);
  const total = billsTotal + coinsTotal;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
          <div className="text-slate-500">Bills</div>
          <div className="font-medium text-slate-800">{peso(billsTotal)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
          <div className="text-slate-500">Coins</div>
          <div className="font-medium text-slate-800">{peso(coinsTotal)}</div>
        </div>
      </div>

      <div className="text-[11px] text-slate-600">
        Total from denoms:{" "}
        <span className="font-medium text-slate-900">{peso(total)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <div className="mb-1 font-semibold text-slate-700">Bills</div>
          <div className="space-y-1">
            {billsOrder.map((d) => (
              <div key={d} className="flex items-center justify-between">
                <span className="text-slate-600">₱{d}</span>
                <span className="tabular-nums text-slate-900">
                  {Number(bills[d] || 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 font-semibold text-slate-700">Coins</div>
          <div className="space-y-1">
            {coinsOrder.map((d) => (
              <div key={d} className="flex items-center justify-between">
                <span className="text-slate-600">₱{d}</span>
                <span className="tabular-nums text-slate-900">
                  {Number(coins[d] || 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StoreCashierVariancesPage() {
  const { rows, tab, counts } = useLoaderData<LoaderData>();
  const [sp] = useSearchParams();

  const tabLink = (t: "open" | "history") => {
    const next = new URLSearchParams(sp);
    next.set("tab", t);
    return `?${next.toString()}`;
  };

  const isHistory = tab === "history";
  const pageTitle = isHistory ? "History (resolved)" : "Open (needs decision)";

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Cashier Shift Variances
            </h1>
            <p className="text-xs text-slate-500">
              Manager audit for shift close counts (cash drawer only).
            </p>
          </div>
          <Link
            to="/store"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Back
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-slate-800">
                {pageTitle}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Link
                  to={tabLink("open")}
                  className={`inline-flex items-center rounded-full border px-2 py-1 ${
                    tab === "open"
                      ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Open
                  {counts.open > 0 ? (
                    <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {counts.open}
                    </span>
                  ) : null}
                </Link>
                <Link
                  to={tabLink("history")}
                  className={`inline-flex items-center rounded-full border px-2 py-1 ${
                    tab === "history"
                      ? "border-slate-300 bg-slate-100 text-slate-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  History
                  {counts.history > 0 ? (
                    <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {counts.history}
                    </span>
                  ) : null}
                </Link>
              </div>
            </div>
            <div className="text-xs text-slate-500">{rows.length} item(s)</div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Shift</th>
                <th className="px-3 py-2 text-left font-medium">Cashier</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Expected</th>
                <th className="px-3 py-2 text-right font-medium">Counted</th>
                <th className="px-3 py-2 text-right font-medium">Diff</th>
                <th className="px-3 py-2 text-left font-medium">
                  {isHistory ? "Details" : "Decision"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    No cashier shift variances.
                  </td>
                </tr>
              ) : (
                rows.map((v) => {
                  const isZero = Math.abs(v.variance) < 0.005;
                  const diffClass = isZero
                    ? "text-slate-600"
                    : v.variance > 0
                    ? "text-emerald-700"
                    : "text-rose-700";
                  const badgeClass = isZero
                    ? "bg-slate-100 text-slate-700 ring-slate-200"
                    : v.variance > 0
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-rose-50 text-rose-700 ring-rose-200";
                  const badgeLabel = isZero
                    ? "MATCH"
                    : v.variance > 0
                    ? "OVER"
                    : "SHORT";

                  return (
                    <tr
                      key={v.id}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="px-3 py-2">
                        <div className="text-slate-900">
                          {new Date(v.shift.openedAt).toLocaleString()}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          shift <span className="font-mono">#{v.shift.id}</span>{" "}
                          • var <span className="font-mono">#{v.id}</span>
                          {v.shift.deviceId ? (
                            <>
                              {" "}
                              •{" "}
                              <span className="font-mono">
                                {v.shift.deviceId}
                              </span>
                            </>
                          ) : null}
                        </div>
                        {v.shift.closedAt ? (
                          <div className="mt-1 text-[11px] text-slate-500">
                            closed:{" "}
                            {new Date(v.shift.closedAt).toLocaleString()}
                          </div>
                        ) : (
                          <div className="mt-1 text-[11px] text-amber-700">
                            shift not closed? (check data)
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        <div className="text-slate-900">
                          {v.shift.cashier.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {v.shift.cashier.email ?? "—"}
                        </div>
                      </td>

                      <td className="px-3 py-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                          {v.status}
                        </span>
                        {v.resolution ? (
                          <div className="mt-1 text-[11px] text-slate-500">
                            resolution:{" "}
                            <span className="font-medium">{v.resolution}</span>
                          </div>
                        ) : null}
                      </td>

                      <td className="px-3 py-2 text-right tabular-nums">
                        {peso(v.expected)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {peso(v.counted)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <div className="flex items-center justify-end gap-2">
                          <span
                            className={[
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1",
                              badgeClass,
                            ].join(" ")}
                          >
                            {badgeLabel}
                          </span>
                          <span
                            className={["font-medium", diffClass].join(" ")}
                          >
                            {v.variance >= 0 ? "+" : ""}
                            {peso(v.variance)}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-2">
                        <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <summary className="cursor-pointer text-xs font-medium text-slate-700">
                            View denoms / notes
                          </summary>
                          <div className="mt-3 space-y-3">
                            <DenomsTable denoms={v.shift.closingDenoms} />

                            <div className="text-[11px] text-slate-600">
                              Cashier note:{" "}
                              <span className="font-medium">
                                {v.note ?? "—"}
                              </span>
                            </div>

                            {isHistory ? (
                              <div className="space-y-1 text-[11px] text-slate-600">
                                <div>
                                  Manager approved:{" "}
                                  <span className="font-medium">
                                    {v.managerApprovedAt
                                      ? new Date(
                                          v.managerApprovedAt,
                                        ).toLocaleString()
                                      : "—"}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <Form method="post" className="grid gap-2">
                                <input type="hidden" name="tab" value={tab} />
                                {/* ✅ REQUIRED: variance id for action() */}
                                <input
                                  type="hidden"
                                  name="id"
                                  value={String(v.id)}
                                />
                                <select
                                  name="resolution"
                                  defaultValue={v.resolution ?? ""}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                                >
                                  <option value="" disabled>
                                    Select decision…
                                  </option>
                                  <option value="CHARGE_CASHIER">
                                    Charge cashier
                                  </option>
                                  <option value="INFO_ONLY">
                                    Info only (audit)
                                  </option>
                                  <option value="WAIVE">Waive</option>
                                </select>
                                <input
                                  name="note"
                                  placeholder="Optional note"
                                  defaultValue={v.note ?? ""}
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                                />
                                <button
                                  type="submit"
                                  name="_intent"
                                  value="manager-decide"
                                  className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
                                >
                                  Save decision
                                </button>
                              </Form>
                            )}
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
