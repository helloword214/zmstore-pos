/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";

// --------------------
// AR SoT helpers
// --------------------
const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const isRiderShortageRef = (refNo: unknown) => {
  const ref = String(refNo ?? "").toUpperCase();
  return ref === "RIDER_SHORTAGE" || ref.startsWith("RIDER-SHORTAGE");
};

const sumSettlementCredits = (
  payments: Array<{ amount: any; method: any; refNo: any }> | null | undefined,
) =>
  r2(
    (payments ?? []).reduce((sum, p) => {
      const method = String(p?.method ?? "").toUpperCase();
      const amt = Number(p?.amount ?? 0);
      if (!Number.isFinite(amt) || amt <= 0) return sum;
      if (method === "CASH") return sum + amt;
      if (method === "INTERNAL_CREDIT" && isRiderShortageRef(p?.refNo))
        return sum + amt;
      return sum;
    }, 0),
  );

const sumFrozenLineTotals = (
  lines: Array<{ lineTotal: any }> | null | undefined,
) => r2((lines ?? []).reduce((s, it) => s + Number(it?.lineTotal ?? 0), 0));

// --------------------
type Row = {
  customerId: number;
  name: string;
  alias: string | null;
  phone: string | null;
  openOrders: number;
  nextDue: string | null;
  balance: number;
};

export async function loader({ request }: LoaderFunctionArgs) {
  // ✅ Shift required for CASHIER (Admin bypass is built-in)
  const url = new URL(request.url);
  await requireOpenShift(request, { next: `${url.pathname}${url.search}` });

  const q = (url.searchParams.get("q") || "").trim();

  // Customers + open orders (UNPAID/PARTIALLY_PAID)
  const customers = await db.customer.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { alias: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
      orders: {
        where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
        select: {
          id: true,
          dueDate: true,
          originRunReceiptId: true,
          originRunReceipt: {
            select: {
              id: true,
              lines: { select: { lineTotal: true } },
            },
          },
          items: { select: { lineTotal: true } },
          payments: { select: { amount: true, method: true, refNo: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 250,
  });

  // For DELIVERY parent orders: load PARENT receipts in one batch
  const orderIds = customers.flatMap((c) => c.orders.map((o) => o.id));
  const parentReceipts = orderIds.length
    ? await db.runReceipt.findMany({
        where: { kind: "PARENT", parentOrderId: { in: orderIds } },
        select: {
          id: true,
          parentOrderId: true,
          lines: { select: { lineTotal: true } },
        },
      })
    : [];
  const parentByOrderId = new Map<
    number,
    { lines: Array<{ lineTotal: any }> }
  >();
  for (const rr of parentReceipts) {
    if (rr.parentOrderId != null && !parentByOrderId.has(rr.parentOrderId)) {
      parentByOrderId.set(rr.parentOrderId, { lines: rr.lines ?? [] });
    }
  }

  const rows: Row[] = [];
  for (const c of customers) {
    if (!c.orders.length) continue;

    let balance = 0;
    let nextDue: Date | null = null;

    for (const o of c.orders) {
      const originLines = o.originRunReceipt?.lines ?? [];
      const parentLines = parentByOrderId.get(o.id)?.lines ?? [];
      const itemLines = (o.items ?? []).map((x: any) => ({
        lineTotal: x?.lineTotal,
      }));

      const charge =
        originLines.length > 0
          ? sumFrozenLineTotals(originLines as any)
          : parentLines.length > 0
          ? sumFrozenLineTotals(parentLines as any)
          : sumFrozenLineTotals(itemLines as any);

      const settled = sumSettlementCredits(o.payments as any);
      const remaining = Math.max(0, r2(charge - settled));
      balance = r2(balance + remaining);

      if (remaining > 0 && o.dueDate) {
        if (!nextDue || o.dueDate < nextDue) nextDue = o.dueDate;
      }
    }

    if (balance <= 0) continue;

    const name = `${c.firstName}${c.middleName ? ` ${c.middleName}` : ""} ${
      c.lastName
    }`.trim();

    rows.push({
      customerId: c.id,
      name,
      alias: c.alias ?? null,
      phone: c.phone ?? null,
      openOrders: c.orders.length,
      nextDue: nextDue ? nextDue.toISOString() : null,
      balance,
    });
  }

  rows.sort((a, b) => {
    if (b.balance !== a.balance) return b.balance - a.balance;
    const ad = a.nextDue ? +new Date(a.nextDue) : Infinity;
    const bd = b.nextDue ? +new Date(b.nextDue) : Infinity;
    return ad - bd;
  });

  return json({ q, rows });
}

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number(n || 0),
  );

export default function ARIndexPage() {
  const { q, rows } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Accounts Receivable
            </h1>
            <div className="text-xs text-slate-500">
              SoT: frozen line totals only • settlement = CASH + rider-shortage
              bridge
            </div>
          </div>

          <Form method="get" className="flex items-center gap-2">
            <Link
              to="/cashier"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ← Cashier
            </Link>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name / alias / phone…"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
            <button className="rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700">
              Search
            </button>
          </Form>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Customers with Open Balance
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-600">
              No open balances.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows.map((r) => (
                <div
                  key={r.customerId}
                  className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/70"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">
                      {r.name}
                      {r.alias ? (
                        <span className="text-slate-500"> ({r.alias})</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.phone ?? "—"} • {r.openOrders} open order(s)
                      {r.nextDue
                        ? ` • due ${new Date(r.nextDue).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-sm font-semibold text-slate-900 tabular-nums">
                      {peso(r.balance)}
                    </div>
                    <Link
                      to={`/ar/customers/${r.customerId}`}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      Open Ledger
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
