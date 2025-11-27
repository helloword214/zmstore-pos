/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, Form } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

type LoaderData = {
  me: {
    id: number;
    role: string;
    name: string;
    alias: string | null;
    email: string;
  };
  stats: {
    activeProducts: number;
    lowStockProducts: number;
    openRuns: number;
  };
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);
  // Load auth user + linked employee to show real name on header
  const userRow = await db.user.findUnique({
    where: { id: me.userId },
    include: { employee: true },
  });

  if (!userRow) {
    throw new Response("User not found", { status: 404 });
  }

  const emp = userRow.employee;
  const fullName =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : // fallback kung walang employee name → gumamit ng email or generic label
        userRow.email ?? "Unknown user";
  const alias = emp?.alias ?? null;

  // Simple manager snapshot stats
  const [activeProducts, lowStockProducts, openRuns] = await Promise.all([
    db.product.count({ where: { isActive: true } }),
    // Approx lang muna: low stock = stock < 5
    db.product.count({
      where: {
        isActive: true,
        stock: { lt: 5 },
      },
    }),
    db.deliveryRun.count({
      where: {
        status: { in: ["PLANNED", "DISPATCHED"] },
      },
    }),
  ]);

  return json<LoaderData>({
    me: {
      id: me.userId,
      role: me.role,
      name: fullName,
      alias,
      email: userRow.email ?? "",
    },
    stats: {
      activeProducts,
      lowStockProducts,
      openRuns,
    },
  });
}

export default function StoreManagerDashboard() {
  const { me, stats } = useLoaderData<LoaderData>();

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Store Manager Dashboard
            </h1>
            <p className="text-xs text-slate-500">
              Logged in as{" "}
              <span className="font-medium text-slate-700">
                {me.alias ? `${me.alias} (${me.name})` : me.name}
              </span>
              {" · "}
              <span className="uppercase tracking-wide">{me.role}</span>
              {" · "}
              <span>{me.email}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-700">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              Inventory & Dispatch Control
            </span>

            <Form method="post" action="/logout">
              <button
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm hover:bg-slate-50"
                title="Sign out"
              >
                Logout
              </button>
            </Form>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-6">
        {/* Quick overview cards */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Store Snapshot
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-500">
                Active SKUs
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {stats.activeProducts}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Products currently enabled for selling.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                Low Stock (approx)
              </div>
              <div className="mt-2 text-2xl font-semibold text-amber-900">
                {stats.lowStockProducts}
              </div>
              <p className="mt-1 text-xs text-amber-800">
                Items with stock &lt; 5. Review for re-ordering.
              </p>
            </div>

            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-sky-600">
                Open Runs
              </div>
              <div className="mt-2 text-2xl font-semibold text-sky-900">
                {stats.openRuns}
              </div>
              <p className="mt-1 text-xs text-sky-800">
                Delivery runs in PLANNED or DISPATCHED status.
              </p>
            </div>
          </div>
        </section>

        {/* Main actions */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Store Manager Actions
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Inventory overview */}
            <Link
              to="/products"
              className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
                  Catalog
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Product & Inventory List
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Review products, prices, units, locations, and stock levels.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-indigo-600 group-hover:text-indigo-700">
                Open products →
              </div>
            </Link>

            {/* Stock movements (planned route) */}
            <Link
              to="/store/stock"
              className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-500">
                  Inventory Flow
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Stock Movements
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Track items going out on runs and stock returning to store.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-emerald-600 group-hover:text-emerald-700">
                View stock movements →
              </div>
            </Link>

            {/* Delivery runs control */}
            <Link
              to="/runs"
              className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-sky-500">
                  Delivery Runs
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Runs & Rider Loadout
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Monitor active runs, rider assignments, and loadout snapshots.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-sky-600 group-hover:text-sky-700">
                Open runs →
              </div>
            </Link>

            {/* Delivery dispatch queue (from pad-order) */}
            <Link
              to="/store/dispatch"
              className="group flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
                  Dispatch
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  Delivery Dispatch Queue
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  See DELIVERY orders from pad-order and open dispatch staging.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-medium text-indigo-600 group-hover:text-indigo-700">
                Open dispatch queue →
              </div>
            </Link>
          </div>
        </section>

        {/* Utility section */}
        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-900">
                Low Stock Watchlist
              </h2>
              <Link
                to="/products?filter=low-stock"
                className="text-xs font-medium text-rose-600 hover:text-rose-700"
              >
                Review items →
              </Link>
            </div>
            <p className="text-xs text-slate-500">
              Later puwede natin gawin na real low-stock report (stock vs
              minStock). For now, shortcut filter lang muna.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-900">
                Inbound Deliveries
              </h2>
              <Link
                to="/store/inbound"
                className="text-xs font-medium text-slate-600 hover:text-slate-800"
              >
                Plan feature →
              </Link>
            </div>
            <p className="text-xs text-slate-500">
              Placeholder for future: encode supplier deliveries, add stock, and
              attach documents (DR/Invoice).
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
