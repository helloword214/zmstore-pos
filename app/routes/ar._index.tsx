import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import {
  SoTTable,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
  SoTTh,
  SoTTd,
} from "~/components/ui/SoTTable";
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
  const totalOpenBalance = rows.reduce((sum, row) => sum + row.balance, 0);
  const overdueCount = rows.filter((row) => {
    if (!row.nextDue) return false;
    return new Date(row.nextDue).getTime() < Date.now();
  }).length;
  const searchActive = q.trim().length > 0;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Accounts Receivable"
        subtitle="Customers with open receivable balance ready for review."
        backTo="/cashier"
        backLabel="Dashboard"
        maxWidthClassName="max-w-5xl"
      />

      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SoTCard compact>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Customers
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {rows.length}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Accounts with open balance
            </div>
          </SoTCard>
          <SoTCard compact tone={totalOpenBalance > 0 ? "info" : "default"}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Open Balance
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {peso(totalOpenBalance)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Visible receivable total
            </div>
          </SoTCard>
          <SoTCard compact tone={overdueCount > 0 ? "warning" : "default"}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Past Due
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {overdueCount}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Customers with overdue balance
            </div>
          </SoTCard>
          <SoTCard compact tone={searchActive ? "success" : "default"}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Search
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {searchActive ? "Filtered" : "All"}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {searchActive ? q : "No active query"}
            </div>
          </SoTCard>
        </div>

        <SoTCard compact className="mb-3">
          <Form method="get" className="flex flex-wrap items-center gap-2">
            <SoTFormField label="Search" className="min-w-[260px] flex-1">
              <input
                name="q"
                defaultValue={q}
                placeholder="Search name / alias / phone..."
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
              />
            </SoTFormField>
            <div className="pt-4">
              <SoTButton variant="primary" type="submit">
                Search
              </SoTButton>
            </div>
          </Form>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <SoTStatusBadge tone="neutral">{rows.length} visible</SoTStatusBadge>
            {searchActive ? (
              <Link to="/ar" className="text-indigo-700 hover:text-indigo-800">
                Clear search
              </Link>
            ) : null}
          </div>
        </SoTCard>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            AR Inbox
          </div>

          <SoTTable>
            <SoTTableHead>
              <tr>
                <SoTTh>Customer</SoTTh>
                <SoTTh>Open Entries</SoTTh>
                <SoTTh>Next Due</SoTTh>
                <SoTTh align="right">Balance</SoTTh>
                <SoTTh align="right"></SoTTh>
              </tr>
            </SoTTableHead>
            <tbody>
              {rows.length === 0 ? (
                <SoTTableEmptyRow colSpan={5} message="No open balances." />
              ) : (
                rows.map((r) => (
                  <SoTTableRow key={r.customerId}>
                    <SoTTd>
                      <div className="font-medium text-slate-900">
                        {r.name}
                        {r.alias ? <span className="text-slate-500"> ({r.alias})</span> : null}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {r.phone ?? "No phone"}
                      </div>
                    </SoTTd>
                    <SoTTd className="text-sm text-slate-700">
                      {r.openEntries} open entr{r.openEntries === 1 ? "y" : "ies"}
                    </SoTTd>
                    <SoTTd className="text-sm text-slate-700">
                      {r.nextDue
                        ? new Date(r.nextDue).toLocaleDateString()
                        : "No due date"}
                      {r.nextDue &&
                      new Date(r.nextDue).getTime() < Date.now() ? (
                        <div className="mt-1">
                          <SoTStatusBadge tone="warning">Past due</SoTStatusBadge>
                        </div>
                      ) : null}
                    </SoTTd>
                    <SoTTd align="right" className="font-semibold tabular-nums text-slate-900">
                      {peso(r.balance)}
                    </SoTTd>
                    <SoTTd align="right">
                      <Link to={`/ar/customers/${r.customerId}`}>
                        <SoTButton>Open Ledger</SoTButton>
                      </Link>
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>
        </div>
      </div>
    </main>
  );
}
