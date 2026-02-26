// app/routes/customers.$id.tsx
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTDataRow } from "~/components/ui/SoTDataRow";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTPageHeader } from "~/components/ui/SoTPageHeader";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const url = new URL(request.url);
  const isAdminCtx = url.searchParams.get("ctx") === "admin";
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

  return json({ customer, name, arBalance, rulesCount, isAdminCtx });
}

export default function CustomerProfile() {
  const { customer, name, arBalance, rulesCount, isAdminCtx } =
    useLoaderData<typeof loader>();
  const ctxSuffix = isAdminCtx ? "?ctx=admin" : "";
  const backHref = isAdminCtx ? "/customers?ctx=admin" : "/customers";

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Customer Profile"
        subtitle="Master record view for pricing and operational setup."
        backTo={backHref}
        backLabel="Customers"
        maxWidthClassName="max-w-4xl"
      />

      <section className="mx-auto max-w-4xl space-y-4 px-5 py-6">
        <SoTPageHeader
          title={name}
          subtitle={
            <>
              {customer.alias ? `(${customer.alias}) • ` : ""}
              {customer.phone || "—"}
            </>
          }
          maxWidthClassName="max-w-none"
          className="py-0"
          actions={
            <>
              <Link
                to={`/customers/${customer.id}/edit${ctxSuffix}`}
                className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Edit
              </Link>
              <Link
                to={`/customers/${customer.id}/pricing${ctxSuffix}`}
                className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Pricing Rules
              </Link>
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-3">
          <SoTCard>
            <SoTDataRow
              label="AR Balance (open)"
              value={
                <span className="font-mono tabular-nums">{peso(arBalance)}</span>
              }
            />
          </SoTCard>

          <SoTCard>
            <SoTDataRow
              label="Credit Limit"
              value={
                customer.creditLimit == null
                  ? "—"
                  : peso(Number(customer.creditLimit))
              }
            />
          </SoTCard>

          <SoTCard>
            <SoTDataRow label="Active Pricing Rules" value={rulesCount} />
            <Link
              to={`/customers/${customer.id}/pricing${ctxSuffix}`}
              className="mt-2 inline-block text-xs text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              Manage rules →
            </Link>
          </SoTCard>
        </div>

        <SoTCard>
          <div className="mb-2 text-sm font-medium text-slate-700">Notes</div>
          <div className="whitespace-pre-wrap text-sm text-slate-700">
            {customer.notes || "—"}
          </div>
        </SoTCard>
      </section>
    </main>
  );
}

// Keep data stable; UI-only page
export const shouldRevalidate = () => false;
