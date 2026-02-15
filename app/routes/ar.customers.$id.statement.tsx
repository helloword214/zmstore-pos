/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";
import { r2, peso } from "~/utils/money";

// --------------------
// AR SoT helpers
// --------------------

const isRiderShortageRef = (refNo: unknown) => {
  const ref = String(refNo ?? "").toUpperCase();
  return ref === "RIDER_SHORTAGE" || ref.startsWith("RIDER-SHORTAGE");
};

const sumFrozenLineTotals = (
  lines: Array<{ lineTotal: any }> | null | undefined,
) => r2((lines ?? []).reduce((s, it) => s + Number(it?.lineTotal ?? 0), 0));

type Txn = {
  kind: "charge" | "settlement";
  date: string; // ISO
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

// Parse "YYYY-MM-DD" as local midnight
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
  // ✅ Enforce shift for CASHIER; ADMIN bypass remains handled by requireOpenShift
  const url = new URL(request.url);
  await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  });

  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const startParam = parseYmdLocal(url.searchParams.get("start"));
  const endParam = parseYmdLocal(url.searchParams.get("end"));

  // default: current month → today
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
      orders: {
        where: { status: { in: ["UNPAID", "PARTIALLY_PAID", "PAID"] } },
        select: {
          id: true,
          orderCode: true,
          channel: true,
          createdAt: true,
          originRunReceiptId: true,
          originRunReceipt: {
            select: { id: true, lines: { select: { lineTotal: true } } },
          },
          items: { select: { lineTotal: true } },
          payments: {
            select: {
              amount: true,
              method: true,
              refNo: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!customer) throw new Response("Not found", { status: 404 });

  const displayName = `${customer.firstName}${
    customer.middleName ? ` ${customer.middleName}` : ""
  } ${customer.lastName}`.trim();

  // Batch PARENT receipts for delivery orders
  const orderIds = customer.orders.map((o) => o.id);
  const parentReceipts = orderIds.length
    ? await db.runReceipt.findMany({
        where: { kind: "PARENT", parentOrderId: { in: orderIds } },
        select: { parentOrderId: true, lines: { select: { lineTotal: true } } },
      })
    : [];
  const parentByOrderId = new Map<number, Array<{ lineTotal: any }>>();
  for (const rr of parentReceipts) {
    if (rr.parentOrderId != null && !parentByOrderId.has(rr.parentOrderId)) {
      parentByOrderId.set(rr.parentOrderId, rr.lines ?? []);
    }
  }

  // Opening balance = charges before start - settlements before start
  let openingCharges = 0;
  let openingSettlements = 0;

  for (const o of customer.orders) {
    // Charges are dated at order.createdAt
    if (o.createdAt < start) {
      const originLines = o.originRunReceipt?.lines ?? [];
      const parentLines = parentByOrderId.get(o.id) ?? [];
      const itemLines = (o.items ?? []).map((x: any) => ({
        lineTotal: x?.lineTotal,
      }));

      const charge =
        originLines.length > 0
          ? sumFrozenLineTotals(originLines as any)
          : parentLines.length > 0
          ? sumFrozenLineTotals(parentLines as any)
          : sumFrozenLineTotals(itemLines as any);

      openingCharges = r2(openingCharges + charge);
    }

    // Settlements are dated at payment.createdAt
    for (const p of o.payments ?? []) {
      const method = String(p.method ?? "").toUpperCase();
      const isSettlement =
        method === "CASH" ||
        (method === "INTERNAL_CREDIT" && isRiderShortageRef(p.refNo));
      if (!isSettlement) continue;

      if (p.createdAt < start) {
        openingSettlements = r2(openingSettlements + Number(p.amount ?? 0));
      }
    }
  }

  const openingBalance = r2(openingCharges - openingSettlements);

  // In-range txns
  const txnsRaw: Array<Omit<Txn, "running">> = [];

  for (const o of customer.orders) {
    // charge in-range
    if (o.createdAt >= start && o.createdAt < endExclusive) {
      const originLines = o.originRunReceipt?.lines ?? [];
      const parentLines = parentByOrderId.get(o.id) ?? [];
      const itemLines = (o.items ?? []).map((x: any) => ({
        lineTotal: x?.lineTotal,
      }));

      const charge =
        originLines.length > 0
          ? sumFrozenLineTotals(originLines as any)
          : parentLines.length > 0
          ? sumFrozenLineTotals(parentLines as any)
          : sumFrozenLineTotals(itemLines as any);

      txnsRaw.push({
        kind: "charge",
        date: o.createdAt.toISOString(),
        label: `Order ${o.orderCode} (${o.channel})`,
        debit: charge,
        credit: 0,
      });
    }

    // settlements in-range
    for (const p of o.payments ?? []) {
      const method = String(p.method ?? "").toUpperCase();
      const isSettlement =
        method === "CASH" ||
        (method === "INTERNAL_CREDIT" && isRiderShortageRef(p.refNo));
      if (!isSettlement) continue;

      if (p.createdAt >= start && p.createdAt < endExclusive) {
        txnsRaw.push({
          kind: "settlement",
          date: p.createdAt.toISOString(),
          label:
            method === "INTERNAL_CREDIT"
              ? `Settlement (Rider shortage bridge)${
                  p.refNo ? ` • ${p.refNo}` : ""
                }`
              : `Payment ${method}${p.refNo ? ` • ${p.refNo}` : ""}`,
          debit: 0,
          credit: r2(Number(p.amount ?? 0)),
        });
      }
    }
  }

  txnsRaw.sort((a, b) => +new Date(a.date) - +new Date(b.date));

  // Running balance, never negative (cap credits)
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
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur no-print">
        <div className="mx-auto max-w-5xl px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Statement of Account
            </h1>
            <div className="text-sm text-slate-600">
              {customer.name}
              {customer.alias ? ` (${customer.alias})` : ""} •{" "}
              {customer.phone ?? "—"}
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

      <div className="mx-auto max-w-5xl px-5 py-6 space-y-4">
        <Form
          method="get"
          className="rounded-2xl border border-slate-200 bg-white shadow-sm p-3 flex flex-wrap items-end gap-3 no-print"
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

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Statement • {period.start} → {period.end}
          </div>

          <div className="px-4 py-3 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Opening Balance</span>
              <span className="font-medium">{peso(openingBalance)}</span>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {txns.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-600">
                No transactions in this period.
              </div>
            ) : (
              <>
                <div className="px-4 py-2 text-xs text-slate-500 flex items-center justify-between">
                  <div className="w-[60%]">Date • Details</div>
                  <div className="flex gap-6 w-[40%] justify-end">
                    <div className="w-28 text-right">Charges</div>
                    <div className="w-28 text-right">Settlements</div>
                    <div className="w-28 text-right">Balance</div>
                  </div>
                </div>

                {txns.map((t, i) => (
                  <div
                    key={i}
                    className="px-4 py-2 text-sm flex items-center justify-between"
                  >
                    <div className="w-[60%] text-slate-700">
                      {new Date(t.date).toLocaleString()} • {t.label}
                    </div>
                    <div className="flex gap-6 w-[40%] justify-end">
                      <div className="w-28 text-right">
                        {t.debit ? `+ ${peso(t.debit)}` : "—"}
                      </div>
                      <div className="w-28 text-right text-emerald-700">
                        {t.credit ? `− ${peso(t.credit)}` : "—"}
                      </div>
                      <div className="w-28 text-right font-medium tabular-nums">
                        {peso(t.running)}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="px-4 py-3 text-sm space-y-1 border-t border-slate-100 bg-slate-50/50">
            <div className="flex justify-between">
              <span className="text-slate-600">Total Charges</span>
              <span className="font-medium">{peso(totals.debits)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Total Settlements</span>
              <span className="font-medium">- {peso(totals.credits)}</span>
            </div>
            <div className="flex justify-between font-semibold text-slate-900">
              <span>Closing Balance</span>
              <span>{peso(closingBalance)}</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>
    </main>
  );
}
