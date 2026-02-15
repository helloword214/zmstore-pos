/* app/routes/store.clearance.$caseId.tsx */
/* STORE MANAGER — Commercial Clearance Case (Read-only MVP) */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import * as React from "react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { r2, peso } from "~/utils/money";

type LoaderData = {
  case: {
    id: number;
    status: string;
    origin: string | null;
    flaggedAt: string | null;
    note: string | null;

    frozenTotal: number;
    cashCollected: number;
    balance: number;

    orderId: number | null;
    runId: number | null;
    runReceiptId: number | null;

    order?: {
      id: number;
      orderCode: string | null;
      channel: string | null;
      status: string | null;
      customerId: number | null;
      releasedAt: string | null;
      releasedApprovedBy: string | null;
      customerLabel: string;
    } | null;

    runReceipt?: {
      id: number;
      kind: string | null;
      receiptKey: string | null;
      runId: number | null;
      runCode: string | null;
      customerLabel: string;
    } | null;
  };
};

function buildCustomerLabelFromOrder(o: any) {
  const c = o?.customer;
  const name =
    [c?.firstName, c?.middleName, c?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "";
  const alias = c?.alias ? ` (${c.alias})` : "";
  const phone = c?.phone ? ` • ${c.phone}` : "";
  const fallback = o?.customerId
    ? `Customer #${o.customerId}`
    : "Walk-in / Unknown";
  return `${name || fallback}${alias}${phone}`.trim();
}

function buildCustomerLabelFromReceipt(r: any) {
  const base =
    (r?.customerName && String(r.customerName).trim()) ||
    (r?.customerId ? `Customer #${r.customerId}` : "Walk-in / Unknown");
  const phone = r?.customerPhone ? ` • ${r.customerPhone}` : "";
  return `${base}${phone}`.trim();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  const caseId = Number(params.caseId);
  if (!Number.isFinite(caseId))
    throw new Response("Invalid caseId", { status: 400 });

  const c = await db.clearanceCase.findUnique({
    where: { id: caseId } as any,
    select: {
      id: true,
      status: true,
      origin: true,
      flaggedAt: true,
      note: true,
      frozenTotal: true,
      cashCollected: true,
      orderId: true,
      runId: true,
      runReceiptId: true,

      order: {
        select: {
          id: true,
          orderCode: true,
          channel: true,
          status: true,
          customerId: true,
          releasedAt: true,
          releasedApprovedBy: true,
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
      },

      runReceipt: {
        select: {
          id: true,
          kind: true,
          receiptKey: true,
          customerId: true,
          customerName: true,
          customerPhone: true,
          runId: true,
          run: { select: { id: true, runCode: true } },
        },
      },
    },
  });

  if (!c) throw new Response("Not found", { status: 404 });

  const frozenTotal = r2(Math.max(0, Number(c.frozenTotal ?? 0)));
  const cashCollected = r2(Math.max(0, Number(c.cashCollected ?? 0)));
  const balance = r2(Math.max(0, frozenTotal - cashCollected));

  const order = c.order
    ? {
        id: Number(c.order.id),
        orderCode: c.order.orderCode ?? null,
        channel: c.order.channel ?? null,
        status: c.order.status ?? null,
        customerId: c.order.customerId ?? null,
        releasedAt: c.order.releasedAt
          ? new Date(c.order.releasedAt as any).toISOString()
          : null,
        releasedApprovedBy: c.order.releasedApprovedBy ?? null,
        customerLabel: buildCustomerLabelFromOrder(c.order),
      }
    : null;

  const runReceipt = c.runReceipt
    ? {
        id: Number(c.runReceipt.id),
        kind: c.runReceipt.kind ?? null,
        receiptKey: c.runReceipt.receiptKey ?? null,
        runId: c.runReceipt.runId ?? null,
        runCode: c.runReceipt.run?.runCode ?? null,
        customerLabel: buildCustomerLabelFromReceipt(c.runReceipt),
      }
    : null;

  return json<LoaderData>({
    case: {
      id: Number(c.id),
      status: String(c.status ?? ""),
      origin: c.origin ?? null,
      flaggedAt: c.flaggedAt
        ? new Date(c.flaggedAt as any).toISOString()
        : null,
      note: c.note ?? null,

      frozenTotal,
      cashCollected,
      balance,

      orderId: c.orderId ?? null,
      runId: c.runId ?? null,
      runReceiptId: c.runReceiptId ?? null,

      order,
      runReceipt,
    },
  });
}

function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "amber" | "indigo";
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "indigo"
      ? "border-indigo-200 bg-indigo-50 text-indigo-800"
      : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}
    >
      {children}
    </span>
  );
}

export default function StoreClearanceCasePage() {
  const data = useLoaderData<LoaderData>();
  const c = data.case;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-4xl px-5 py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-wide text-slate-900">
              Clearance Case <span className="font-mono">#{c.id}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Pill tone="indigo">{c.status}</Pill>
              {c.origin ? <Pill tone="slate">{c.origin}</Pill> : null}
              {c.balance > 0.009 ? (
                <Pill tone="amber">balance {peso(c.balance)}</Pill>
              ) : (
                <Pill tone="slate">no balance</Pill>
              )}
            </div>
            {c.flaggedAt ? (
              <p className="mt-1 text-xs text-slate-500">
                Flagged at: <span className="font-mono">{c.flaggedAt}</span>
              </p>
            ) : null}
          </div>

          <Link
            to="/store/clearance"
            className="text-sm text-indigo-600 hover:underline"
          >
            ← Back to Inbox
          </Link>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
          <h2 className="text-sm font-medium text-slate-800">Snapshot</h2>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] text-slate-500">Frozen total</div>
              <div className="mt-1 font-mono font-semibold">
                {peso(c.frozenTotal)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] text-slate-500">Cash collected</div>
              <div className="mt-1 font-mono font-semibold">
                {peso(c.cashCollected)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] text-slate-500">Balance</div>
              <div className="mt-1 font-mono font-semibold">
                {peso(c.balance)}
              </div>
            </div>
          </div>

          {c.note ? (
            <div className="mt-3">
              <div className="text-[11px] text-slate-500">Note</div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                {c.note}
              </div>
            </div>
          ) : null}
        </section>

        {c.order ? (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-slate-800">
                  Walk-in Order
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  {c.order.customerLabel}
                  {c.order.releasedApprovedBy ? (
                    <span className="ml-2 text-slate-500">
                      • releasedBy {c.order.releasedApprovedBy}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {c.order.orderCode ? (
                    <span className="font-mono">{c.order.orderCode}</span>
                  ) : null}
                  {c.order.channel ? (
                    <span className="ml-2">• {c.order.channel}</span>
                  ) : null}
                  {c.order.status ? (
                    <span className="ml-2">• {c.order.status}</span>
                  ) : null}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  to={`/cashier/${c.order.id}`}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open order →
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {c.runReceipt ? (
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-slate-800">
                  Delivery Receipt
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  {c.runReceipt.customerLabel} •{" "}
                  <span className="font-mono">
                    {c.runReceipt.receiptKey ?? `RR#${c.runReceipt.id}`}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {c.runReceipt.runCode ? (
                    <span className="font-mono">{c.runReceipt.runCode}</span>
                  ) : null}
                  {c.runReceipt.kind ? (
                    <span className="ml-2">• {c.runReceipt.kind}</span>
                  ) : null}
                </p>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  const err = useRouteError();
  if (isRouteErrorResponse(err)) {
    return (
      <main className="min-h-screen bg-[#f7f7fb] p-5">
        <div className="mx-auto max-w-3xl rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <div className="font-semibold">Error {err.status}</div>
          <div className="mt-1">{err.data || err.statusText}</div>
          <div className="mt-3">
            <Link to="/store/clearance" className="text-indigo-700 underline">
              Back to Inbox
            </Link>
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-[#f7f7fb] p-5">
      <div className="mx-auto max-w-3xl rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
        Unknown error.
      </div>
    </main>
  );
}
