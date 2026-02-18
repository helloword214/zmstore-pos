/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";
import { r2, peso } from "~/utils/money";

type Txn = {
  kind: "charge" | "settlement";
  date: string;
  label: string;
  debit: number;
  credit: number;
  running: number;
};

type LoaderData = {
  customer: {
    id: number;
    name: string;
    alias: string | null;
    phone: string | null;
  };
  period: { start: string; end: string };
  openingBalance: number;
  txns: Txn[];
  totals: { debits: number; credits: number };
  closingBalance: number;
};

function parseYmdLocal(v: string | null): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  return new Date(yy, mm - 1, dd);
}

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  });

  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const startParam = parseYmdLocal(url.searchParams.get("start"));
  const endParam = parseYmdLocal(url.searchParams.get("end"));

  const now = new Date();
  const start = startParam ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const end =
    endParam ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endExclusive = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() + 1,
  );

  if (+start >= +endExclusive) {
    return json(
      { error: "Start date must be on or before End date." },
      { status: 400 },
    );
  }

  const customer = await db.customer.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
      customerAr: {
        select: {
          id: true,
          principal: true,
          createdAt: true,
          order: {
            select: {
              orderCode: true,
              channel: true,
            },
          },
          clearanceDecision: {
            select: {
              kind: true,
              clearanceCase: {
                select: {
                  receiptKey: true,
                },
              },
            },
          },
          payments: {
            select: {
              id: true,
              amount: true,
              refNo: true,
              note: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!customer) throw new Response("Not found", { status: 404 });

  const displayName = `${customer.firstName}${
    customer.middleName ? ` ${customer.middleName}` : ""
  } ${customer.lastName}`.trim();

  let openingCharges = 0;
  let openingSettlements = 0;

  for (const ar of customer.customerAr) {
    const principal = r2(Math.max(0, Number(ar.principal ?? 0)));
    if (ar.createdAt < start) {
      openingCharges = r2(openingCharges + principal);
    }

    for (const p of ar.payments ?? []) {
      if (p.createdAt < start) {
        openingSettlements = r2(
          openingSettlements + Math.max(0, Number(p.amount ?? 0)),
        );
      }
    }
  }

  const openingBalance = r2(openingCharges - openingSettlements);

  const txnsRaw: Array<Omit<Txn, "running">> = [];

  for (const ar of customer.customerAr) {
    const principal = r2(Math.max(0, Number(ar.principal ?? 0)));
    const orderPart = ar.order?.orderCode
      ? ` • ${ar.order.orderCode}${ar.order.channel ? ` (${ar.order.channel})` : ""}`
      : "";
    const decisionPart = ar.clearanceDecision?.kind
      ? ` • ${String(ar.clearanceDecision.kind)}`
      : "";
    const receiptPart = ar.clearanceDecision?.clearanceCase?.receiptKey
      ? ` • ${String(ar.clearanceDecision.clearanceCase.receiptKey)}`
      : "";

    if (ar.createdAt >= start && ar.createdAt < endExclusive) {
      txnsRaw.push({
        kind: "charge",
        date: ar.createdAt.toISOString(),
        label: `A/R #${ar.id}${orderPart}${decisionPart}${receiptPart}`,
        debit: principal,
        credit: 0,
      });
    }

    for (const p of ar.payments ?? []) {
      if (p.createdAt >= start && p.createdAt < endExclusive) {
        txnsRaw.push({
          kind: "settlement",
          date: p.createdAt.toISOString(),
          label: `Payment (A/R #${ar.id})${p.refNo ? ` • ${p.refNo}` : ""}${
            p.note ? ` • ${p.note}` : ""
          }`,
          debit: 0,
          credit: r2(Math.max(0, Number(p.amount ?? 0))),
        });
      }
    }
  }

  txnsRaw.sort((a, b) => +new Date(a.date) - +new Date(b.date));

  let run = openingBalance;
  const txns: Txn[] = txnsRaw.map((t) => {
    if (t.debit > 0) {
      run = r2(run + t.debit);
      return { ...t, running: run };
    }
    const dueNow = Math.max(0, run);
    const applied = Math.min(Math.max(0, t.credit), dueNow);
    run = r2(run - applied);
    return { ...t, credit: applied, running: run };
  });

  const totals = txns.reduce(
    (acc, t) => {
      acc.debits = r2(acc.debits + t.debit);
      acc.credits = r2(acc.credits + t.credit);
      return acc;
    },
    { debits: 0, credits: 0 },
  );

  const closingBalance = r2(openingBalance + totals.debits - totals.credits);

  return json<LoaderData>({
    customer: {
      id: customer.id,
      name: displayName,
      alias: customer.alias ?? null,
      phone: customer.phone ?? null,
    },
    period: { start: ymd(start), end: ymd(end) },
    openingBalance,
    txns,
    totals,
    closingBalance,
  });
}

export default function CustomerStatementPage() {
  const { customer, period, openingBalance, txns, totals, closingBalance } =
    useLoaderData<LoaderData>();
  const [sp] = useSearchParams();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#eef2ff_0%,_#f8fafc_45%,_#f3f4f6_100%)]">
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/85 backdrop-blur no-print">
        <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Statement of Account
            </h1>
            <div className="text-sm text-slate-600">
              {customer.name}
              {customer.alias ? ` (${customer.alias})` : ""} • {customer.phone ?? "—"}
            </div>
            <div className="text-xs text-slate-500">
              SoT: customerAr debits + customerArPayment credits
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/ar/customers/${customer.id}`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Back
            </Link>
            <button
              onClick={() => window.print()}
              className="rounded-xl bg-indigo-600 text-white px-3 py-2 text-sm hover:bg-indigo-700"
            >
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-6 space-y-4">
        <Form
          method="get"
          className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm p-3 flex flex-wrap items-end gap-3 no-print"
        >
          <label className="text-sm">
            <span className="text-slate-700">Start</span>
            <input
              type="date"
              name="start"
              defaultValue={sp.get("start") ?? period.start}
              className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <label className="text-sm">
            <span className="text-slate-700">End</span>
            <input
              type="date"
              name="end"
              defaultValue={sp.get("end") ?? period.end}
              className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <button className="h-[38px] rounded-xl bg-indigo-600 text-white px-3 text-sm hover:bg-indigo-700">
            Apply
          </button>
        </Form>

        <section className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-slate-500">Opening Balance</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
              {peso(openingBalance)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-slate-500">Charges (Period)</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">
              {peso(totals.debits)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs text-slate-500">Settlements (Period)</div>
            <div className="mt-1 text-lg font-semibold text-emerald-700 tabular-nums">
              {peso(totals.credits)}
            </div>
          </div>
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 shadow-sm">
            <div className="text-xs text-indigo-700">Closing Balance</div>
            <div className="mt-1 text-lg font-semibold text-indigo-900 tabular-nums">
              {peso(closingBalance)}
            </div>
          </div>
        </section>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-800">
              Statement • {period.start} → {period.end}
            </div>
            <div className="text-xs text-slate-500">
              {txns.length} transaction{txns.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date / Details</th>
                  <th className="px-4 py-2 text-right font-medium">Charges</th>
                  <th className="px-4 py-2 text-right font-medium">Settlements</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {txns.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-sm text-slate-600">
                      No transactions in this period.
                    </td>
                  </tr>
                ) : (
                  txns.map((t, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-700">
                        <div>{new Date(t.date).toLocaleString()}</div>
                        <div className="text-xs text-slate-500">{t.label}</div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {t.debit ? `+ ${peso(t.debit)}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                        {t.credit ? `− ${peso(t.credit)}` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">
                        {peso(t.running)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 text-sm space-y-1 border-t border-slate-100 bg-slate-50/60">
            <div className="flex justify-between">
              <span className="text-slate-600">Opening</span>
              <span className="font-medium">{peso(openingBalance)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">+ Charges</span>
              <span className="font-medium">{peso(totals.debits)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">- Settlements</span>
              <span className="font-medium">{peso(totals.credits)}</span>
            </div>
            <div className="flex justify-between font-semibold text-slate-900">
              <span>Closing Balance</span>
              <span>{peso(closingBalance)}</span>
            </div>
          </div>
        </div>

        <div className="no-print rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
          This statement is generated from approved customer A/R entries and A/R payment records only.
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          table { font-size: 11px; }
          th, td { padding-top: 6px !important; padding-bottom: 6px !important; }
        }
      `}</style>
    </main>
  );
}
