/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
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

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Accounts Receivable"
        subtitle="SoT: customerAr open balances only"
        backTo="/cashier"
        backLabel="Dashboard"
        maxWidthClassName="max-w-5xl"
      />

      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
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
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Customers with Open Approved Balance
          </div>

          <SoTTable>
            <SoTTableHead>
              <tr>
                <SoTTh>Customer</SoTTh>
                <SoTTh>Meta</SoTTh>
                <SoTTh align="right">Balance</SoTTh>
                <SoTTh align="right"></SoTTh>
              </tr>
            </SoTTableHead>
            <tbody>
              {rows.length === 0 ? (
                <SoTTableEmptyRow colSpan={4} message="No open balances." />
              ) : (
                rows.map((r) => (
                  <SoTTableRow key={r.customerId}>
                    <SoTTd>
                      <div className="font-medium text-slate-900">
                        {r.name}
                        {r.alias ? <span className="text-slate-500"> ({r.alias})</span> : null}
                      </div>
                    </SoTTd>
                    <SoTTd className="text-xs text-slate-500">
                      {r.phone ?? "—"} • {r.openEntries} open A/R entr
                      {r.openEntries === 1 ? "y" : "ies"}
                      {r.nextDue
                        ? ` • due ${new Date(r.nextDue).toLocaleDateString()}`
                        : ""}
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
