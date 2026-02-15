/* app/routes/cashier.charges.tsx */ /* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import type { Prisma } from "@prisma/client";

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
      branch: { id: number; name: string } | null;
    };
  }>;
  // admin-only toggle (optional)
  canSeeAll: boolean;
  showAll: boolean;
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

function normalizeDenoms(raw: any): Denoms | null {
  if (!raw || typeof raw !== "object") return null;
  const bills = raw.bills && typeof raw.bills === "object" ? raw.bills : {};
  const coins = raw.coins && typeof raw.coins === "object" ? raw.coins : {};
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
  const me = await requireRole(request, ["CASHIER", "ADMIN"]);

  const url = new URL(request.url);
  const tab = safeTab(url.searchParams.get("tab"));
  const showAll = url.searchParams.get("all") === "1";
  const canSeeAll = me.role === "ADMIN";

  // Scope: cashier sees own shifts only. Admin may see all with ?all=1.
  const shiftScope: Prisma.CashierShiftWhereInput =
    canSeeAll && showAll ? {} : { cashierId: me.userId };

  // Open = manager already decided CHARGE_CASHIER, waiting cashier acknowledgement/close.
  const openWhere: Prisma.CashierShiftVarianceWhereInput = {
    resolution: "CHARGE_CASHIER" as any,
    status: "MANAGER_APPROVED" as any,
    shift: shiftScope,
  };

  // History = closed/waived/info-only etc (but we only show charge items here)
  const historyWhere: Prisma.CashierShiftVarianceWhereInput = {
    resolution: "CHARGE_CASHIER" as any,
    status: { in: ["CLOSED", "WAIVED"] as any },
    shift: shiftScope,
  };

  const [openCount, historyCount] = await Promise.all([
    db.cashierShiftVariance.count({ where: openWhere }),
    db.cashierShiftVariance.count({ where: historyWhere }),
  ]);

  const where: Prisma.CashierShiftVarianceWhereInput =
    tab === "open" ? openWhere : historyWhere;

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
          cashierId: true,
          openedAt: true,
          closedAt: true,
          deviceId: true,
          closingDenoms: true,
          branch: { select: { id: true, name: true } }, // may return null if relation optional
        },
      },
    },
  });

  // extra guard: if not admin, ensure all rows belong to this cashier
  const filtered =
    canSeeAll && showAll
      ? rows
      : rows.filter((v) => Number(v.shift.cashierId) === Number(me.userId));

  const out: LoaderData = {
    tab,
    counts: { open: openCount, history: historyCount },
    canSeeAll,
    showAll: canSeeAll ? showAll : false,
    rows: filtered.map((v) => ({
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
        branch: v.shift.branch
          ? { id: v.shift.branch.id, name: v.shift.branch.name }
          : null,
      },
    })),
  };

  return json(out, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["CASHIER", "ADMIN"]);

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  const id = Number(fd.get("id"));
  const tab = String(fd.get("tab") || "");
  const safeT = tab === "history" || tab === "open" ? tab : "open";
  const showAll = String(fd.get("all") || "") === "1" && me.role === "ADMIN";

  if (!Number.isFinite(id) || id <= 0)
    throw new Response("Invalid variance id", { status: 400 });

  const row = await db.cashierShiftVariance.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      resolution: true,
      note: true,
      shift: { select: { cashierId: true } },
    },
  });
  if (!row) throw new Response("Not found", { status: 404 });

  // Only the owning cashier can act (unless admin)
  if (
    me.role !== "ADMIN" &&
    Number(row.shift.cashierId) !== Number(me.userId)
  ) {
    throw new Response("Forbidden", { status: 403 });
  }

  // This page is only for CHARGE_CASHIER items.
  if (String(row.resolution ?? "") !== "CHARGE_CASHIER") {
    throw new Response("Invalid item", { status: 400 });
  }

  if (intent === "cashier-note") {
    const note = String(fd.get("note") || "").trim();
    if (!note.length) {
      return redirect(
        `/cashier/charges?tab=${safeT}${showAll ? "&all=1" : ""}`,
      );
    }
    // Allow note update while MANAGER_APPROVED (or even after close for audit)
    await db.cashierShiftVariance.update({
      where: { id },
      data: { note },
    });
    return redirect(`/cashier/charges?tab=${safeT}${showAll ? "&all=1" : ""}`);
  }

  if (intent === "cashier-ack") {
    // Acknowledge + close (simple SoT: cashier confirms they saw the charge)
    // Only allowed if manager already approved.
    if (String(row.status ?? "") !== "MANAGER_APPROVED") {
      throw new Response("Not actionable", { status: 400 });
    }
    const now = new Date();
    const ackNote = String(fd.get("ackNote") || "").trim();
    const merged =
      ackNote.length > 0
        ? `${row.note ?? ""}${row.note ? "\n" : ""}[CASHIER_ACK] ${ackNote}`
        : `${row.note ?? ""}${row.note ? "\n" : ""}[CASHIER_ACK] acknowledged`;

    await db.cashierShiftVariance.update({
      where: { id },
      data: {
        status: "CLOSED" as any,
        resolvedAt: now,
        note: merged,
      },
    });
    return redirect(`/cashier/charges?tab=${safeT}${showAll ? "&all=1" : ""}`);
  }

  throw new Response("Unsupported intent", { status: 400 });
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
    </div>
  );
}

export default function CashierChargesPage() {
  const { rows, tab, counts, canSeeAll, showAll } = useLoaderData<LoaderData>();
  const [sp] = useSearchParams();

  const tabLink = (t: "open" | "history") => {
    const next = new URLSearchParams(sp);
    next.set("tab", t);
    return `?${next.toString()}`;
  };

  const isHistory = tab === "history";
  const pageTitle = isHistory ? "History (closed)" : "Open (manager charged)";

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Cashier Charges
            </h1>
            <p className="text-xs text-slate-500">
              Items charged to you from shift close variances (manager
              decision).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canSeeAll ? (
              <Link
                to={`?tab=${tab}${showAll ? "" : "&all=1"}`}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                title="Admin only"
              >
                {showAll ? "My scope" : "Show all"}
              </Link>
            ) : null}
            <Link
              to="/cashier"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Back
            </Link>
          </div>
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
                      ? "border-rose-200 bg-rose-50 text-rose-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Open
                  {counts.open > 0 ? (
                    <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
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
                <th className="px-3 py-2 text-left font-medium">Branch</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Expected</th>
                <th className="px-3 py-2 text-right font-medium">Counted</th>
                <th className="px-3 py-2 text-right font-medium">Diff</th>
                <th className="px-3 py-2 text-left font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    No cashier charges.
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
                        ) : null}
                      </td>

                      <td className="px-3 py-2">
                        <div className="text-slate-900">
                          {v.shift.branch?.name ?? "—"}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          branch{" "}
                          <span className="font-mono">
                            #{v.shift.branch?.id ?? "—"}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                          {v.status}
                        </span>
                        <div className="mt-1 text-[11px] text-slate-500">
                          resolution:{" "}
                          <span className="font-medium">{v.resolution}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          manager:{" "}
                          <span className="font-medium">
                            {v.managerApprovedAt
                              ? new Date(v.managerApprovedAt).toLocaleString()
                              : "—"}
                          </span>
                        </div>
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
                              Note:{" "}
                              <span className="font-medium">
                                {v.note ?? "—"}
                              </span>
                            </div>

                            <Form method="post" className="grid gap-2">
                              <input type="hidden" name="id" value={v.id} />
                              <input type="hidden" name="tab" value={tab} />
                              <input
                                type="hidden"
                                name="all"
                                value={showAll ? "1" : ""}
                              />
                              <input
                                name="note"
                                placeholder="Add/update note"
                                defaultValue={v.note ?? ""}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                              />
                              <button
                                type="submit"
                                name="_intent"
                                value="cashier-note"
                                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Save note
                              </button>
                            </Form>

                            {!isHistory ? (
                              <Form
                                method="post"
                                className="grid gap-2"
                                onSubmit={(e) => {
                                  if (
                                    !confirm(
                                      "Acknowledge and close this charge?",
                                    )
                                  )
                                    e.preventDefault();
                                }}
                              >
                                <input type="hidden" name="id" value={v.id} />
                                <input type="hidden" name="tab" value={tab} />
                                <input
                                  type="hidden"
                                  name="all"
                                  value={showAll ? "1" : ""}
                                />
                                <input
                                  name="ackNote"
                                  placeholder="Optional acknowledgement note"
                                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                                />
                                <button
                                  type="submit"
                                  name="_intent"
                                  value="cashier-ack"
                                  className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-3 py-2 text-xs font-medium text-white hover:bg-rose-700"
                                >
                                  Acknowledge & Close
                                </button>
                              </Form>
                            ) : null}
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
