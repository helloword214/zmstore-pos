import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { CustomerArStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
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

const PAGE_SIZE = 50;
const OPEN_AR_STATUSES = [
  CustomerArStatus.OPEN,
  CustomerArStatus.PARTIALLY_SETTLED,
];

type Row = {
  customerId: number;
  name: string;
  alias: string | null;
  phone: string | null;
  openEntries: number;
  nextDue: string | null;
  balance: number;
};

function parsePage(raw: string | null) {
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.floor(value) !== value || value < 1) {
    return 1;
  }
  return value;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  await requireOpenShift(request, { next: `${url.pathname}${url.search}` });

  const q = (url.searchParams.get("q") || "").trim();
  const requestedPage = parsePage(url.searchParams.get("page"));

  const customerFilter: Prisma.CustomerWhereInput | undefined = q
    ? {
        OR: [
          { firstName: { contains: q, mode: "insensitive" as const } },
          { lastName: { contains: q, mode: "insensitive" as const } },
          { alias: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const arWhere: Prisma.CustomerArWhereInput = {
    balance: { gt: 0 },
    status: { in: OPEN_AR_STATUSES },
    ...(customerFilter ? { customer: customerFilter } : {}),
  };
  const now = new Date();

  const [summary, customerGroups, overdueGroups] = await Promise.all([
    db.customerAr.aggregate({
      where: arWhere,
      _sum: { balance: true },
    }),
    db.customerAr.groupBy({
      by: ["customerId"],
      where: arWhere,
    }),
    db.customerAr.groupBy({
      by: ["customerId"],
      where: {
        ...arWhere,
        dueDate: { lt: now },
      },
    }),
  ]);

  const totalCustomers = customerGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalCustomers / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * PAGE_SIZE;

  const pageGroups = await db.customerAr.groupBy({
    by: ["customerId"],
    where: arWhere,
    _count: { _all: true },
    _min: { dueDate: true },
    _sum: { balance: true },
    orderBy: [
      {
        _sum: {
          balance: "desc",
        },
      },
      { customerId: "asc" },
    ],
    skip,
    take: PAGE_SIZE,
  });

  const customerIds = pageGroups.map((group) => group.customerId);
  const customers = customerIds.length
    ? await db.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          alias: true,
          phone: true,
        },
      })
    : [];
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  const rows: Row[] = pageGroups.map((group) => {
    const customer = customerById.get(group.customerId);
    const name = `${customer?.firstName || ""}${
      customer?.middleName ? ` ${customer.middleName}` : ""
    } ${customer?.lastName || ""}`.trim();

    return {
      customerId: group.customerId,
      name: name || `Customer #${group.customerId}`,
      alias: customer?.alias ?? null,
      phone: customer?.phone ?? null,
      openEntries: group._count._all,
      nextDue: group._min.dueDate ? group._min.dueDate.toISOString() : null,
      balance: r2(Math.max(0, Number(group._sum.balance ?? 0))),
    };
  });

  return json({
    q,
    rows,
    page,
    pageSize: PAGE_SIZE,
    totalCustomers,
    totalOpenBalance: r2(Number(summary._sum.balance ?? 0)),
    totalPages,
    totalPastDueCustomers: overdueGroups.length,
  });
}

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number(n || 0),
  );

export default function ARIndexPage() {
  const {
    q,
    rows,
    page,
    pageSize,
    totalCustomers,
    totalOpenBalance,
    totalPages,
    totalPastDueCustomers,
  } = useLoaderData<typeof loader>();
  const searchActive = q.trim().length > 0;
  const pageStart = totalCustomers === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, totalCustomers);
  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams();
    const query = q.trim();
    if (query) params.set("q", query);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/ar?${qs}` : "/ar";
  };
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Customer Balances"
        subtitle="Collect payments from customers with open balance."
        backTo="/cashier"
        backLabel="Dashboard"
        maxWidthClassName="max-w-5xl"
      />

      <div className="mx-auto max-w-5xl space-y-3 px-5 py-6">
        <SoTCard compact tone={totalOpenBalance > 0 ? "info" : "default"}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Open Balance
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {peso(totalOpenBalance)}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              <SoTStatusBadge tone="neutral">
                {totalCustomers} customer(s)
              </SoTStatusBadge>
              <SoTStatusBadge
                tone={totalPastDueCustomers > 0 ? "warning" : "neutral"}
              >
                {totalPastDueCustomers} past due
              </SoTStatusBadge>
              {searchActive ? (
                <SoTStatusBadge tone="success">Filtered</SoTStatusBadge>
              ) : null}
            </div>
          </div>
        </SoTCard>

        <SoTCard compact>
          <Form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <SoTFormField label="Search" className="min-w-[220px] flex-1">
              <input
                name="q"
                defaultValue={q}
                placeholder="Search name / alias / phone..."
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
              />
            </SoTFormField>
            <div className="flex items-center gap-2">
              <SoTButton variant="primary" type="submit" className="h-9">
                Search
              </SoTButton>
              {searchActive ? (
                <Link
                  to="/ar"
                  className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                >
                  Clear
                </Link>
              ) : null}
            </div>
          </Form>
        </SoTCard>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-medium text-slate-700">
              Open Balances
            </div>
            <div className="text-xs text-slate-500">
              Showing {pageStart}-{pageEnd} of {totalCustomers}
            </div>
          </div>

          <SoTTable>
            <SoTTableHead>
              <tr>
                <SoTTh>Customer</SoTTh>
                <SoTTh>Items</SoTTh>
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
                      {r.openEntries} item{r.openEntries === 1 ? "" : "s"}
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
                        <SoTButton>Collect Payment</SoTButton>
                      </Link>
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>

          {totalPages > 1 ? (
            <div className="flex flex-col gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <div>
                Page {page} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                {hasPrevious ? (
                  <Link
                    to={pageHref(page - 1)}
                    className="inline-flex h-8 items-center rounded-xl border border-slate-200 bg-white px-3 font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="inline-flex h-8 items-center rounded-xl border border-slate-100 bg-slate-50 px-3 text-slate-400">
                    Previous
                  </span>
                )}
                {hasNext ? (
                  <Link
                    to={pageHref(page + 1)}
                    className="inline-flex h-8 items-center rounded-xl border border-slate-200 bg-white px-3 font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="inline-flex h-8 items-center rounded-xl border border-slate-100 bg-slate-50 px-3 text-slate-400">
                    Next
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
