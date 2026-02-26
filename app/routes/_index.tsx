import { Link, Form } from "@remix-run/react";
import * as React from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireRole } from "~/utils/auth.server";

/* ────────────────────────────────────────────────────────────── */
/* Small, dependency-free charts                                 */
/* ────────────────────────────────────────────────────────────── */

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  return null;
}

function Sparkline({
  data,
  width = 220,
  height = 56,
  strokeWidth = 2,
}: {
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  const path = React.useMemo(() => {
    if (!data.length) return "";
    const max = Math.max(...data);
    const min = Math.min(...data);
    const norm = (v: number) =>
      height - ((v - min) / (max - min || 1)) * (height - 8) - 4;
    const step = width / (data.length - 1 || 1);
    return data
      .map((v, i) => `${i === 0 ? "M" : "L"} ${i * step},${norm(v)}`)
      .join(" ");
  }, [data, height, width]);

  const last = data[data.length - 1] ?? 0;
  const prev = data[data.length - 2] ?? last;
  const up = last >= prev;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-14">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        className={up ? "text-emerald-600" : "text-rose-600"}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BarChartMini({ data, labels }: { data: number[]; labels: string[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="grid grid-cols-7 items-end gap-2 h-28">
      {data.map((v, i) => {
        const h = Math.round((v / max) * 100);
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className="w-6 rounded-md bg-indigo-200"
              style={{ height: `${Math.max(8, h)}%` }}
            />
            <div className="text-[10px] text-slate-500">{labels[i]}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */
/* Index Dashboard                                                */
/* ────────────────────────────────────────────────────────────── */
export default function Index() {
  // Mock data (swap with loader data later)
  const sales7d = [9_200, 10_450, 8_870, 11_230, 10_980, 12_540, 13_120];
  const orders7d = [42, 51, 39, 55, 48, 60, 63];
  const labels7d = ["M", "T", "W", "T", "F", "S", "S"];

  const todaySales = 13120; // PHP
  const todayOrders = 63; // count
  const avgTicket = todayOrders ? todaySales / todayOrders : 0;
  const itemsSold = 187; // placeholder

  return (
    <main className="min-h-screen bg-[#f7f7fb] text-slate-900">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            Zaldy Merchandise <span className="text-indigo-700">Dashboard</span>
          </h1>
          <div className="flex items-center gap-2">
            <Link
              to="/products"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              Products
            </Link>
            <Link
              to="/pad-order"
              className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              Open Order Pad
            </Link>
            <Form method="post" action="/logout">
              <button
                type="submit"
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                title="Sign out"
              >
                Logout
              </button>
            </Form>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* KPI cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPI
            title="Today's Sales"
            value={php(todaySales)}
            delta="+4.1%"
            good
          />
          <KPI title="Orders" value={todayOrders.toString()} delta="+5" good />
          <KPI title="Avg Ticket" value={php(avgTicket)} delta="-₱8" />
          <KPI
            title="Items Sold"
            value={itemsSold.toString()}
            delta="+12"
            good
          />
        </section>

        {/* Charts row */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium tracking-wide text-slate-700">
                Sales (last 7 days)
              </h2>
              <span className="text-[11px] text-slate-500">PHP</span>
            </div>
            <div className="mt-2">
              <Sparkline data={sales7d} />
            </div>
            <div className="mt-2">
              <BarChartMini data={orders7d} labels={labels7d} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
            <h3 className="text-sm font-medium tracking-wide text-slate-700">
              Quick Actions
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <DashLink
                to="/cashier"
                label="Open Cashier Queue"
                sub="Lock & settle orders"
              />
              <DashLink
                to="/reports"
                label="View Reports"
                sub="Sales, payments, inventory"
              />
              <DashLink
                to="/orders/new"
                label="Create Order (Ticket)"
                sub="Manual entry & print"
              />
              <DashLink
                to="/settings"
                label="Settings"
                sub="Branch, printers, discounts"
              />
            </div>
          </div>
        </section>

        {/* Two-up: Top categories / Recent activity */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
            <h3 className="text-sm font-medium tracking-wide text-slate-700">
              Top Categories
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              {[
                ["LPG", 42_500],
                ["Rice", 31_900],
                ["Feeds", 28_300],
                ["Pet", 12_400],
              ].map(([name, amt]) => (
                <li
                  key={String(name)}
                  className="flex items-center justify-between"
                >
                  <span className="text-slate-700">{name as string}</span>
                  <span className="font-medium">{php(Number(amt))}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
            <h3 className="text-sm font-medium tracking-wide text-slate-700">
              Recent Activity
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <Activity text="Order #A3X7 paid — ₱1,240.00" />
              <Activity text="Ticket #B912 reprinted" />
              <Activity text="Dispatched delivery (Order #C77D)" />
              <Activity text="Inventory sync completed" />
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────── */
/* Subcomponents                                                  */
/* ────────────────────────────────────────────────────────────── */

function KPI({
  title,
  value,
  delta,
  good,
}: {
  title: string;
  value: string;
  delta?: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {delta && (
        <div
          className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 ${
            good
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-rose-50 text-rose-700 ring-rose-200"
          }`}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

function DashLink({
  to,
  label,
  sub,
}: {
  to: string;
  label: string;
  sub?: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
    >
      <span className="font-medium">{label}</span>
      {sub && <span className="text-[11px] text-slate-500">{sub}</span>}
    </Link>
  );
}

function Activity({ text }: { text: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-slate-700">{text}</span>
      <span className="h-2 w-2 rounded-full bg-slate-300" />
    </li>
  );
}

function php(n: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(n);
}
