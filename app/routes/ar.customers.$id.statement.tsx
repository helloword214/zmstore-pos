import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import { db } from "~/utils/db.server";
import {
  applyDiscounts,
  buildCartFromOrderItems,
  fetchCustomerRulesAt,
} from "~/services/pricing";
import { requireRole } from "~/utils/auth.server";

type Txn = {
  kind: "charge" | "payment";
  date: string; // ISO
  label: string;
  debit: number; // charges
  credit: number; // payments
  orderId?: number;
  paymentId?: number;
  creditApplied?: number; // capped credit actually applied to balance
  running?: number; // balance after this txn (opening → running)
  items?: Array<{
    id: number;
    name: string;
    qty: number;
    unit: number; // original unit on the order line
    effUnit: number; // effective unit after rules-at-time
    effLine: number; // qty * effUnit
  }>;
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

// Parse "YYYY-MM-DD" as LOCAL midnight (avoid UTC shift).
function parseYmdLocal(v: string | null): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const [, yy, mm, dd] = m.map(Number);
  return new Date(yy, mm - 1, dd); // local 00:00
}

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN", "CASHIER"]);
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw new Response("Invalid ID", { status: 400 });

  const url = new URL(request.url);
  const startParam = parseYmdLocal(url.searchParams.get("start"));
  const endParam = parseYmdLocal(url.searchParams.get("end"));
  const showItems = url.searchParams.get("items") === "1";

  // Default period: current month to today
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1); // local 00:00
  const defaultEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // today 00:00 local
  const start = startParam ?? defaultStart; // inclusive
  const end = endParam ?? defaultEnd; // inclusive (date-only)
  // exclusive end = start of the next day (so the chosen 'end' day is fully included)
  const endExclusive = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() + 1
  );

  if (+start >= +endExclusive) {
    return json(
      { error: "Start date must be on or before End date." },
      { status: 400 }
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
          createdAt: true,
          paidAt: true,
          items: {
            select: {
              id: true,
              productId: true,
              name: true,
              qty: true,
              unitPrice: true,
              product: {
                select: { price: true, srp: true, allowPackSale: true },
              },
            },
          },
          payments: {
            select: {
              id: true,
              amount: true,
              createdAt: true,
              method: true,
              refNo: true,
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

  const r2 = (n: number) => +Number(n).toFixed(2);

  // Helper: compute discounted total AND itemized breakdown using rules valid at its reference instant
  const totalForOrderAt = async (o: (typeof customer.orders)[number]) => {
    const refAt = o.paidAt ?? o.createdAt;
    const rulesAt = await fetchCustomerRulesAt(db, id, refAt);
    const cart = buildCartFromOrderItems({
      items: o.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        name: it.name ?? "",
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        product: {
          price: it.product?.price == null ? null : Number(it.product.price),
          srp: it.product?.srp == null ? null : Number(it.product.srp),
          allowPackSale: it.product?.allowPackSale ?? null,
        },
      })),
      rules: rulesAt,
    });
    const pricing = applyDiscounts(cart, rulesAt, { id });
    // Build per-line itemization (effective prices mapped by item id)
    const items =
      cart.items.map((ci) => {
        const adj = pricing.adjustedItems.find((a) => a.id === ci.id);
        const effUnit = adj?.effectiveUnitPrice ?? Number(ci.unitPrice);
        return {
          id: ci.id,
          name: ci.name,
          qty: Number(ci.qty),
          unit: Number(ci.unitPrice),
          effUnit: r2(effUnit),
          effLine: r2(Number(ci.qty) * effUnit),
        };
      }) ?? [];
    return { total: pricing.total, items };
  };

  // Opening balance before the period
  let openingCharges = 0;
  let openingPayments = 0;
  for (const o of customer.orders) {
    if (o.createdAt < start) {
      const { total } = await totalForOrderAt(o);
      openingCharges += total;
    }
    for (const p of o.payments) {
      if (p.createdAt < start) {
        openingPayments += Number(p.amount);
      }
    }
  }
  const openingBalance = +(openingCharges - openingPayments).toFixed(2);

  // In-range transactions
  const txns: Txn[] = [];
  for (const o of customer.orders) {
    if (o.createdAt >= start && o.createdAt < endExclusive) {
      const { total, items } = await totalForOrderAt(o);
      const charge = +total.toFixed(2);
      txns.push({
        kind: "charge",
        date: o.createdAt.toISOString(),
        label: `Order ${o.orderCode}`,
        debit: charge,
        credit: 0,
        orderId: o.id,
        items: showItems ? items : undefined,
      });
    }
    for (const p of o.payments) {
      if (p.createdAt >= start && p.createdAt < endExclusive) {
        txns.push({
          kind: "payment",
          date: p.createdAt.toISOString(),
          label: `Payment ${p.method}${p.refNo ? ` • ${p.refNo}` : ""}`,
          debit: 0,
          credit: Number(p.amount),
          orderId: o.id,
          paymentId: p.id,
        });
      }
    }
  }
  txns.sort((a, b) => +new Date(a.date) - +new Date(b.date));

  const totals = txns.reduce(
    (acc, t) => {
      acc.debits += t.debit;
      acc.credits += t.credit;
      return acc;
    },
    { debits: 0, credits: 0 }
  );
  // Compute running balance and CAP each payment to what's due at that moment
  let run = openingBalance;
  const txnsWithApplied = txns.map((t) => {
    if (t.debit > 0) {
      // charge: add fully
      run = +(run + t.debit).toFixed(2);
      return { ...t, creditApplied: 0, running: run };
    }
    // payment: cap to current due (never let running go negative)
    const dueNow = Math.max(0, run);
    const applied = Math.min(Number(t.credit || 0), dueNow);
    run = +(run - applied).toFixed(2);
    return { ...t, creditApplied: applied, running: run };
  });
  // Totals using APPLIED credits so the math matches closing balance
  const totalsApplied = {
    debits: totals.debits,
    credits: txnsWithApplied.reduce((s, t) => s + (t.creditApplied || 0), 0),
  };
  const closingBalance = +(
    openingBalance +
    totalsApplied.debits -
    totalsApplied.credits
  ).toFixed(2);

  return json<LoaderData>({
    customer: {
      id: customer.id,
      name: displayName,
      alias: customer.alias ?? null,
      phone: customer.phone ?? null,
    },
    period: { start: ymd(start), end: ymd(end) },
    openingBalance,
    txns: txnsWithApplied,
    totals: totalsApplied,
    closingBalance,
  });
}

export default function CustomerStatementPage() {
  const { customer, period, openingBalance, txns, totals, closingBalance } =
    useLoaderData<LoaderData>();
  const [sp] = useSearchParams();
  const showItems = sp.get("items") === "1";

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-5 py-4 flex items-center justify-between no-print">
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
              Back to Ledger
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

      <div className="mx-auto max-w-4xl px-5 py-6 space-y-4">
        {/* Period selector */}
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
          <label className="text-sm inline-flex items-center gap-2">
            <input
              type="checkbox"
              name="items"
              value="1"
              defaultChecked={showItems}
              onChange={(e) => {
                // keep start/end when toggling
                const form = e.currentTarget.form!;
                if (e.currentTarget.checked) {
                  // ensure a value is submitted
                } else {
                  // unchecked → remove param by adding empty hidden input override
                  const i = document.createElement("input");
                  i.type = "hidden";
                  i.name = "items";
                  i.value = "";
                  form.appendChild(i);
                }
              }}
            />
            <span className="text-slate-700">Show items</span>
          </label>
          <button className="h-[38px] rounded-xl bg-indigo-600 text-white px-3 text-sm hover:bg-indigo-700">
            Apply
          </button>
        </Form>

        {/* Statement Card */}
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
                {/* header row */}
                <div className="px-4 py-2 text-xs text-slate-500 flex items-center justify-between">
                  <div className="w-[60%]">Date • Details</div>
                  <div className="flex gap-6 w-[40%] justify-end">
                    <div className="w-28 text-right">Charges</div>
                    <div className="w-28 text-right">Payments</div>
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
                      {t.kind === "charge" && t.items?.length ? (
                        <details
                          className="mt-1 text-[12px]"
                          {...(showItems ? { open: true } : {})}
                        >
                          <summary className="cursor-pointer text-slate-500">
                            Items ({t.items.length})
                          </summary>
                          <ul className="mt-1 space-y-1 text-slate-600">
                            {t.items.map((li) => (
                              <li
                                key={li.id}
                                className="flex items-center justify-between"
                              >
                                <span className="truncate">
                                  {li.name} • {li.qty} ×{" "}
                                  {li.effUnit !== li.unit ? (
                                    <>
                                      <s className="text-slate-400">
                                        {peso(li.unit)}
                                      </s>{" "}
                                      →{" "}
                                      <b className="text-slate-800">
                                        {peso(li.effUnit)}
                                      </b>
                                    </>
                                  ) : (
                                    <>{peso(li.effUnit)}</>
                                  )}
                                </span>
                                <span className="tabular-nums">
                                  {peso(li.effLine)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                    <div className="flex gap-6 w-[40%] justify-end">
                      <div className="w-28 text-right">
                        {t.debit ? `+ ${peso(t.debit)}` : "—"}
                      </div>
                      <div className="w-28 text-right">
                        {t.creditApplied
                          ? `− ${peso(t.creditApplied)}`
                          : t.credit
                          ? `− ${peso(t.credit)}`
                          : "—"}
                      </div>
                      <div className="w-28 text-right font-medium">
                        {peso(t.running ?? 0)}
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
              <span className="text-slate-600">Total Payments</span>
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
