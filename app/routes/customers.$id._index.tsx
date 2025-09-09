// app/routes/customers.$id._index.tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";

export async function loader({ params }: LoaderFunctionArgs) {
  if (!params.id) throw new Response("Missing ID", { status: 400 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const customer = await db.customer.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
      creditLimit: true,
      notes: true,
      _count: { select: { customerItemPrices: true, orders: true } },
      orders: {
        where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
        select: { id: true, totalBeforeDiscount: true },
      },
    },
  });
  if (!customer) throw new Response("Not found", { status: 404 });

  const name = [customer.firstName, customer.middleName, customer.lastName]
    .filter(Boolean)
    .join(" ");
  const arBalance = customer.orders.reduce(
    (s, o) => s + Number(o.totalBeforeDiscount || 0),
    0
  );
  const rulesCount = customer._count.customerItemPrices;

  return json({ customer, name, arBalance, rulesCount });
}

export default function CustomerProfile() {
  const { customer, name, arBalance, rulesCount } =
    useLoaderData<typeof loader>();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // show items by default? add &items=1 if you want
  const statementHref = `/ar/customers/${customer.id}/statement?start=${ymd(
    start
  )}&end=${ymd(now)}`;

  return (
    <section className="px-4 md:px-0 pb-6">
      {/* Header (non-sticky) */}
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {name}
            </h1>
            <div className="text-sm text-slate-600">
              {customer.alias ? `(${customer.alias}) • ` : ""}
              {customer.phone || "—"}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              to={`/customers/${customer.id}/edit`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Edit
            </Link>
            <Link
              to={`/customers/${customer.id}/pricing`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Pricing Rules
            </Link>
          </div>
        </div>
      </div>

      {/* Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">AR Balance (open)</div>
          <div className="text-lg font-semibold text-slate-900">
            {peso(arBalance)}
          </div>

          {/* action pills */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to={`/ar/customers/${customer.id}`}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              title="View AR Ledger"
            >
              AR Ledger
            </Link>
            <Link
              to={statementHref}
              className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              title="Statement of Account"
            >
              Statement
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Credit Limit</div>
          <div className="text-lg font-semibold text-slate-900">
            {customer.creditLimit ?? "—"}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Active Pricing Rules</div>
          <div className="text-lg font-semibold text-slate-900">
            {rulesCount}
          </div>
          <Link
            to={`/customers/${customer.id}/pricing`}
            className="mt-2 inline-block text-xs text-indigo-600 hover:underline"
          >
            Manage rules →
          </Link>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-medium text-slate-700">Notes</div>
        <div className="text-sm text-slate-700 whitespace-pre-wrap">
          {customer.notes || "—"}
        </div>
      </div>
    </section>
  );
}

// Keep data stable; UI-only page
export const shouldRevalidate = () => false;
