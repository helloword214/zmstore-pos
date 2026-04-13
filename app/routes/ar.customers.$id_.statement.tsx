import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useSearchParams } from "@remix-run/react";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
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
import { r2, peso } from "~/utils/money";

type Txn = {
  kind: "charge" | "settlement";
  date: string;
  label: string;
  detail: string | null;
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
      ? `Order ${ar.order.orderCode}${ar.order.channel ? ` (${ar.order.channel})` : ""}`
      : "";
    const receiptPart = ar.clearanceDecision?.clearanceCase?.receiptKey
      ? `Receipt ${String(ar.clearanceDecision.clearanceCase.receiptKey)}`
      : "";
    const chargeDetail = [`Balance #${ar.id}`, orderPart, receiptPart]
      .filter(Boolean)
      .join(" • ");

    if (ar.createdAt >= start && ar.createdAt < endExclusive) {
      txnsRaw.push({
        kind: "charge",
        date: ar.createdAt.toISOString(),
        label: "Balance added",
        detail: chargeDetail,
        debit: principal,
        credit: 0,
      });
    }

    for (const p of ar.payments ?? []) {
      if (p.createdAt >= start && p.createdAt < endExclusive) {
        const paymentDetail = [
          `Balance #${ar.id}`,
          p.refNo ? `Ref ${p.refNo}` : "",
          p.note ?? "",
        ]
          .filter(Boolean)
          .join(" • ");
        txnsRaw.push({
          kind: "settlement",
          date: p.createdAt.toISOString(),
          label: "Payment received",
          detail: paymentDetail,
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
  const customerLabel = `${customer.name}${customer.alias ? ` (${customer.alias})` : ""}`;
  const hasActivity = txns.length > 0;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="no-print">
        <SoTNonDashboardHeader
          title="Customer Statement"
          subtitle={
            <>
              {customerLabel} • {customer.phone ?? "No phone"}
            </>
          }
          backTo={`/ar/customers/${customer.id}`}
          backLabel="Customer Balance"
          maxWidthClassName="max-w-5xl"
        />
      </div>

      <div className="mx-auto max-w-5xl space-y-3 px-5 py-6">
        <SoTCard compact tone={closingBalance > 0 ? "info" : "default"}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Closing Balance
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">
                {peso(closingBalance)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {period.start} to {period.end}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs sm:min-w-[360px] sm:grid-cols-3 sm:text-right">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="text-slate-500">Opening</div>
                <div className="mt-1 font-semibold tabular-nums text-slate-900">
                  {peso(openingBalance)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="text-slate-500">Charges</div>
                <div className="mt-1 font-semibold tabular-nums text-slate-900">
                  {peso(totals.debits)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="text-slate-500">Payments</div>
                <div className="mt-1 font-semibold tabular-nums text-emerald-700">
                  {peso(totals.credits)}
                </div>
              </div>
            </div>
          </div>
        </SoTCard>

        <SoTCard compact className="no-print">
          <Form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <SoTFormField label="Start" className="sm:w-44">
              <SoTInput
                type="date"
                name="start"
                defaultValue={sp.get("start") ?? period.start}
              />
            </SoTFormField>
            <SoTFormField label="End" className="sm:w-44">
              <SoTInput
                type="date"
                name="end"
                defaultValue={sp.get("end") ?? period.end}
              />
            </SoTFormField>
            <div className="flex flex-wrap items-center gap-2">
              <SoTButton type="submit" variant="primary">
                Apply
              </SoTButton>
              <SoTButton type="button" onClick={() => window.print()}>
                Print
              </SoTButton>
            </div>
          </Form>
        </SoTCard>

        <SoTCard className="overflow-hidden p-0">
          <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-slate-800">
                Statement Activity
              </div>
              <div className="text-xs text-slate-500">{customerLabel}</div>
            </div>
            <SoTStatusBadge tone={hasActivity ? "neutral" : "warning"}>
              {txns.length} transaction{txns.length === 1 ? "" : "s"}
            </SoTStatusBadge>
          </div>

          <SoTTable>
            <SoTTableHead>
              <tr>
                <SoTTh>Date / Details</SoTTh>
                <SoTTh align="right">Charges</SoTTh>
                <SoTTh align="right">Payments</SoTTh>
                <SoTTh align="right">Balance</SoTTh>
              </tr>
            </SoTTableHead>
            <tbody>
              {txns.length === 0 ? (
                <SoTTableEmptyRow colSpan={4} message="No transactions in this period." />
              ) : (
                txns.map((t, i) => (
                  <SoTTableRow key={`${t.date}-${i}`}>
                    <SoTTd className="text-slate-700">
                      <div className="font-medium text-slate-900">{t.label}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {new Date(t.date).toLocaleString()}
                        {t.detail ? ` • ${t.detail}` : ""}
                      </div>
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums text-slate-900">
                      {t.debit ? `+ ${peso(t.debit)}` : "—"}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums text-emerald-700">
                      {t.credit ? `− ${peso(t.credit)}` : "—"}
                    </SoTTd>
                    <SoTTd align="right" className="font-semibold tabular-nums text-slate-900">
                      {peso(t.running)}
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>
        </SoTCard>
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
