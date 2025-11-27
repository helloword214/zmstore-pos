import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import type { Prisma } from "@prisma/client";
import { CashDrawerTxnType } from "@prisma/client";

type LoaderData = {
  role: "ADMIN" | "CASHIER" | "SELLER";
  shifts: Array<{
    id: number;
    openedAt: string;
    closedAt: string | null;
    openingFloat: string | null;
    closingTotal: string | null;
    deviceId: string | null;
    notes: string | null;
    branch: { id: number; name: string };
    cashier: {
      id: number;
      email: string | null;
      displayName: string;
    };
    paymentsCount: number;
    sumAmount: number;
    sumTendered: number;
    sumChange: number;
    // Drawer rollups
    drawerDeposits: number; // CASH_IN
    drawerOut: number; // CASH_OUT
    drawerDrops: number; // DROP
    cashSalesIn: number; // tendered - change (CASH only)
    drawerBalance: number; // openingFloat + cashSalesIn + deposits - out - drops
  }>;
  filters: {
    status: "all" | "open" | "closed";
    from?: string;
    to?: string;
    branchId?: number | null;
    cashierId?: number | null;
  };
  branches: Array<{ id: number; name: string }>;
  cashiers: Array<{ id: number; label: string }>;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["ADMIN", "CASHIER"]);
  const url = new URL(request.url);
  const status =
    (url.searchParams.get("status") as "all" | "open" | "closed") ?? "open";
  const from = url.searchParams.get("from") || undefined; // YYYY-MM-DD
  const to = url.searchParams.get("to") || undefined;
  const branchId = url.searchParams.get("branchId")
    ? Number(url.searchParams.get("branchId"))
    : undefined;
  const cashierId = url.searchParams.get("cashierId")
    ? Number(url.searchParams.get("cashierId"))
    : undefined;

  // Build filters
  const where: Prisma.CashierShiftWhereInput = {
    ...(me.role === "CASHIER" ? { cashierId: me.userId } : {}),
    ...(status === "open"
      ? { closedAt: null }
      : status === "closed"
      ? { closedAt: { not: null } }
      : {}),
    ...(branchId ? { branchId } : {}),
    ...(from || to
      ? {
          openedAt: {
            ...(from ? { gte: new Date(from + "T00:00:00") } : {}),
            ...(to ? { lte: new Date(to + "T23:59:59") } : {}),
          },
        }
      : {}),
    ...(me.role === "ADMIN" && cashierId ? { cashierId } : {}),
  };

  const shifts = await db.cashierShift.findMany({
    where,
    orderBy: { openedAt: "desc" },
    take: 200, // sane cap
    include: {
      branch: { select: { id: true, name: true } },
      cashier: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      _count: { select: { payments: true } },
    },
  });

  const shiftIds = shifts.map((s) => s.id);
  const sums =
    shiftIds.length > 0
      ? await db.payment.groupBy({
          by: ["shiftId"],
          where: { shiftId: { in: shiftIds } },
          _sum: { amount: true, tendered: true, change: true },
        })
      : [];
  const sumMap = new Map<
    number,
    { amount: number; tendered: number; change: number }
  >();
  for (const row of sums) {
    sumMap.set(row.shiftId!, {
      amount: Number(row._sum.amount ?? 0),
      tendered: Number(row._sum.tendered ?? 0),
      change: Number(row._sum.change ?? 0),
    });
  }

  // Cash-only inflow to drawer (tendered - change) per shift
  const cashInRows =
    shiftIds.length > 0
      ? await db.payment.groupBy({
          by: ["shiftId", "method"],
          where: { shiftId: { in: shiftIds }, method: "CASH" },
          _sum: { tendered: true, change: true },
        })
      : [];
  const cashSalesInMap = new Map<number, number>();
  for (const r of cashInRows) {
    const t = Number(r._sum.tendered ?? 0);
    const c = Number(r._sum.change ?? 0);
    cashSalesInMap.set(r.shiftId!, t - c);
  }

  // Drawer transactions per shift (CASH_IN, CASH_OUT, DROP)
  const drawerRows =
    shiftIds.length > 0
      ? await db.cashDrawerTxn.groupBy({
          by: ["shiftId", "type"],
          where: { shiftId: { in: shiftIds } },
          _sum: { amount: true },
        })
      : [];
  const drawerMap = new Map<
    number,
    { in: number; out: number; drop: number }
  >();
  for (const r of drawerRows) {
    const cur = drawerMap.get(r.shiftId!) ?? { in: 0, out: 0, drop: 0 };
    const val = Number(r._sum.amount ?? 0);
    if (r.type === CashDrawerTxnType.CASH_IN) cur.in += val;
    else if (r.type === CashDrawerTxnType.CASH_OUT) cur.out += val;
    else if (r.type === CashDrawerTxnType.DROP) cur.drop += val;
    drawerMap.set(r.shiftId!, cur);
  }

  // branches list (for filter)
  let branches: Array<{ id: number; name: string }>;
  if (me.role === "ADMIN") {
    branches = await db.branch.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  } else {
    const my = await db.user.findUnique({
      where: { id: me.userId },
      select: {
        branches: {
          select: { branch: { select: { id: true, name: true } } },
        },
      },
    });
    branches =
      my?.branches
        .map((ub) => ub.branch)
        .sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  }

  // cashier list (ADMIN only)
  const cashiers =
    me.role === "ADMIN"
      ? await db.user
          .findMany({
            where: { role: "CASHIER", active: true },
            select: {
              id: true,
              email: true,
              employee: {
                select: { firstName: true, lastName: true, alias: true },
              },
            },
            orderBy: [{ employee: { lastName: "asc" } }, { email: "asc" }],
          })
          .then((rows) =>
            rows.map((u) => ({
              id: u.id,
              label:
                u.employee?.alias ||
                [u.employee?.firstName, u.employee?.lastName]
                  .filter(Boolean)
                  .join(" ") ||
                u.email ||
                `User#${u.id}`,
            }))
          )
      : [];

  const data: LoaderData = {
    role: me.role,
    shifts: shifts.map((s) => {
      const emp = s.cashier.employee;
      const displayName =
        emp?.alias ||
        [emp?.firstName, emp?.lastName].filter(Boolean).join(" ") ||
        s.cashier.email ||
        `User#${s.cashier.id}`;
      const sums = sumMap.get(s.id) || { amount: 0, tendered: 0, change: 0 };
      const drawer = drawerMap.get(s.id) || { in: 0, out: 0, drop: 0 };
      const openingFloatNum = Number(s.openingFloat ?? 0);
      const cashSalesIn = cashSalesInMap.get(s.id) ?? 0;
      const drawerBalance =
        openingFloatNum + cashSalesIn + drawer.in - drawer.out - drawer.drop;
      return {
        id: s.id,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
        openingFloat: s.openingFloat ? s.openingFloat.toString() : null,
        closingTotal: s.closingTotal ? s.closingTotal.toString() : null,
        deviceId: s.deviceId,
        notes: s.notes,
        branch: s.branch,
        cashier: { id: s.cashier.id, email: s.cashier.email, displayName },
        paymentsCount: s._count.payments,
        sumAmount: sums.amount,
        sumTendered: sums.tendered,
        sumChange: sums.change,
        drawerDeposits: drawer.in,
        drawerOut: drawer.out,
        drawerDrops: drawer.drop,
        cashSalesIn,
        drawerBalance,
      };
    }),
    filters: {
      status,
      from,
      to,
      branchId: branchId ?? null,
      cashierId: cashierId ?? null,
    },
    branches,
    cashiers,
  };
  return json(data);
}

function peso(n: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number.isFinite(n) ? n : 0);
}

export default function CashierShifts() {
  const { role, shifts, filters, branches, cashiers } =
    useLoaderData<LoaderData>();
  const [params] = useSearchParams();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {role === "ADMIN" ? "All Cashier Shifts" : "My Shifts"}
          </h1>
          <Link
            to="/cashier"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
          >
            ← Back to Cashier
          </Link>
        </div>

        {/* Filters */}
        <Form
          method="get"
          className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-5"
        >
          <label className="text-sm">
            <span className="block text-slate-700 mb-1">Status</span>
            <select
              name="status"
              defaultValue={filters.status}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-slate-700 mb-1">From</span>
            <input
              type="date"
              name="from"
              defaultValue={filters.from ?? ""}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-700 mb-1">To</span>
            <input
              type="date"
              name="to"
              defaultValue={filters.to ?? ""}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="block text-slate-700 mb-1">Branch</span>
            <select
              name="branchId"
              defaultValue={filters.branchId ?? ""}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
            >
              <option value="">All</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {role === "ADMIN" ? (
            <label className="text-sm">
              <span className="block text-slate-700 mb-1">Cashier</span>
              <select
                name="cashierId"
                defaultValue={filters.cashierId ?? ""}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">All</option>
                {cashiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div />
          )}
          <div className="md:col-span-5">
            <button className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
              Apply Filters
            </button>
            {params.toString() && (
              <Link
                to="/cashier/shifts"
                className="ml-2 text-sm text-slate-600 hover:underline"
              >
                Reset
              </Link>
            )}
          </div>
        </Form>

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-700">
                <th className="px-4 py-3">Opened</th>
                <th className="px-4 py-3">Closed</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Cashier</th>
                <th className="px-4 py-3 text-right">Payments</th>
                <th className="px-4 py-3 text-right">Sum Amount</th>
                <th className="px-4 py-3 text-right">Tendered</th>
                <th className="px-4 py-3 text-right">Change</th>
                <th className="px-4 py-3 text-right">Drawer In</th>
                <th className="px-4 py-3 text-right">Out+Drop</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">Opening Float</th>
                <th className="px-4 py-3 text-right">Closing Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shifts.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-2">
                    {new Date(s.openedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    {s.closedAt ? (
                      new Date(s.closedAt).toLocaleString()
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">
                        OPEN
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{s.branch.name}</td>
                  <td className="px-4 py-2">{s.cashier.displayName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.paymentsCount}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {peso(s.sumAmount)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {peso(s.sumTendered)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {peso(s.sumChange)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {peso(s.drawerDeposits)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {peso(s.drawerOut + s.drawerDrops)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {peso(s.drawerBalance)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.openingFloat ? peso(Number(s.openingFloat)) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.closingTotal ? peso(Number(s.closingTotal)) : "—"}
                  </td>
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-6 text-center text-slate-500"
                  >
                    No shifts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
