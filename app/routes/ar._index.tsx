/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";

const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

type Row = {
  customerId: number;
  name: string;
  alias: string | null;
  phone: string | null;
  openEntries: number;
  nextDue: string | null;
  balance: number;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  await requireOpenShift(request, { next: `${url.pathname}${url.search}` });

  const q = (url.searchParams.get("q") || "").trim();

  const customerFilter = q
    ? {
        OR: [
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
          { alias: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const arRows = await db.customerAr.findMany({
    where: {
      balance: { gt: 0 },
      status: { in: ["OPEN", "PARTIALLY_SETTLED"] },
      ...(customerFilter ? { customer: customerFilter } : {}),
    },
    select: {
      customerId: true,
      balance: true,
      dueDate: true,
      customer: {
        select: {
          firstName: true,
          middleName: true,
          lastName: true,
          alias: true,
          phone: true,
        },
      },
    },
    orderBy: [{ customerId: "asc" }, { createdAt: "asc" }],
    take: 500,
  });

  const grouped = new Map<number, Row>();

  for (const ar of arRows) {
    const cid = Number(ar.customerId ?? 0);
    if (!cid) continue;

    const bal = r2(Math.max(0, Number(ar.balance ?? 0)));
    if (bal <= 0) continue;

    const existing = grouped.get(cid);
    if (!existing) {
      const c = ar.customer;
      const name = `${c?.firstName || ""}${c?.middleName ? ` ${c.middleName}` : ""} ${
        c?.lastName || ""
      }`.trim();

      grouped.set(cid, {
        customerId: cid,
        name: name || `Customer #${cid}`,
        alias: c?.alias ?? null,
        phone: c?.phone ?? null,
        openEntries: 1,
        nextDue: ar.dueDate ? ar.dueDate.toISOString() : null,
        balance: bal,
      });
      continue;
    }

    existing.openEntries += 1;
    existing.balance = r2(existing.balance + bal);

    if (ar.dueDate) {
      const next = existing.nextDue ? new Date(existing.nextDue) : null;
      if (!next || ar.dueDate < next) {
        existing.nextDue = ar.dueDate.toISOString();
      }
    }
  }

  const rows = Array.from(grouped.values()).sort((a, b) => {
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
              SoT: customerAr open balances only
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
            Customers with Open Approved Balance
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-600">No open balances.</div>
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
                      {r.phone ?? "—"} • {r.openEntries} open A/R entr{r.openEntries === 1 ? "y" : "ies"}
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
