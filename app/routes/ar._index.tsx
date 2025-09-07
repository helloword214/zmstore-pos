import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, Form } from "@remix-run/react";
import { db } from "~/utils/db.server";

type Row = {
  customerId: number;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  alias?: string | null;
  phone?: string | null;
  balance: number;
  nextDue: string | null;
  openOrders: number;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  // 1) find customers that have open (credited or partial) orders
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
          totalBeforeDiscount: true,
          dueDate: true,
          payments: { select: { amount: true } },
          isOnCredit: true,
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
  });

  const rows: Row[] = customers
    .map((c) => {
      if (!c.orders.length) return null;

      let balance = 0;
      let nextDue: Date | null = null;

      for (const o of c.orders) {
        const paid = o.payments.reduce((s, p) => s + Number(p.amount), 0);
        const remaining = Math.max(0, Number(o.totalBeforeDiscount) - paid);
        balance += remaining;
        if (o.dueDate && (!nextDue || o.dueDate < nextDue)) nextDue = o.dueDate;
      }

      if (balance <= 0) return null;

      return {
        customerId: c.id,
        firstName: c.firstName,
        middleName: c.middleName,
        lastName: c.lastName,
        alias: c.alias ?? null,
        phone: c.phone ?? null,
        balance: Number(balance.toFixed(2)),
        nextDue: nextDue ? nextDue.toISOString() : null,
        openOrders: c.orders.length,
      };
    })
    .filter(Boolean) as Row[];

  // sort by highest balance, then nearest due date
  rows.sort((a, b) => {
    if (b.balance !== a.balance) return b.balance - a.balance;
    const ad = a.nextDue ? +new Date(a.nextDue) : Infinity;
    const bd = b.nextDue ? +new Date(b.nextDue) : Infinity;
    return ad - bd;
  });

  return json({ rows, q });
}

function nameOf(r: Row) {
  const mid = r.middleName ? ` ${r.middleName}` : "";
  const base = `${r.firstName}${mid} ${r.lastName}`.trim();
  const alias = r.alias ? ` (${r.alias})` : "";
  return `${base}${alias}`;
}

export default function ARListPage() {
  const { rows, q } = useLoaderData<typeof loader>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-5 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Accounts Receivable
          </h1>
          <Form method="get" className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name / alias / phone…"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
            <button className="rounded-xl bg-indigo-600 text-white px-3 py-2 text-sm hover:bg-indigo-700">
              Search
            </button>
          </Form>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Customers with Open Balances
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">
              No open balances.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((r) => (
                <li
                  key={r.customerId}
                  className="px-4 py-3 hover:bg-slate-50/70"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-slate-900 font-medium">
                        {nameOf(r)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {r.phone ?? "—"} • {r.openOrders} open order(s)
                        {r.nextDue
                          ? ` • due ${new Date(r.nextDue).toLocaleDateString()}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold text-slate-900">
                        ₱{r.balance.toFixed(2)}
                      </div>
                      <Link
                        to={`/ar/customers/${r.customerId}`}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                      >
                        Open Ledger
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
