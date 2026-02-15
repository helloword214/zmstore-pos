/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  Outlet,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";
import { assertActiveShiftWritable } from "~/utils/shiftGuards.server";
import { allocateReceiptNo } from "~/utils/receipt";
import { r2 } from "~/utils/money";
import {
  type PaymentLite,
  EPS,
  isSettlementPayment,
  sumSettlementCredits,
  sumFrozenLineTotals,
  hasAllFrozenLineTotals,
} from "~/services/settlementSoT";

function parseMoney(v: FormDataEntryValue | null) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

type LedgerRow =
  | {
      kind: "order";
      date: string;
      label: string;
      debit: number;
      credit: 0;
      orderId: number;
      due: string | null;
      remainingAfter: number;
    }
  | {
      kind: "payment";
      date: string;
      label: string;
      debit: 0;
      credit: number;
      creditApplied: number;
      orderId: number;
      paymentId: number;
      method: string;
      refNo: string | null;
    };

type LoaderData = {
  customer: {
    id: number;
    name: string;
    alias: string | null;
    phone: string | null;
  };
  orders: Array<{
    id: number;
    orderCode: string;
    channel: string;
    status: string;
    createdAt: string;
    dueDate: string | null;
    charge: number; // SoT
    settled: number; // SoT
    remaining: number; // SoT
  }>;
  rows: LedgerRow[];
  balance: number;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  // ✅ Shift required for CASHIER; keep exact return URL
  const url = new URL(request.url);
  await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  });

  const customerId = Number(params.id);
  if (!Number.isFinite(customerId))
    throw new Response("Invalid ID", { status: 400 });

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
      orders: {
        // Show all open + paid (for context)
        where: { status: { in: ["UNPAID", "PARTIALLY_PAID", "PAID"] } },
        select: {
          id: true,
          orderCode: true,
          channel: true,
          status: true,
          createdAt: true,
          dueDate: true,
          originRunReceiptId: true,
          originRunReceipt: {
            select: { id: true, lines: { select: { lineTotal: true } } },
          },
          items: { select: { lineTotal: true } },
          payments: {
            select: {
              id: true,
              amount: true,
              method: true,
              refNo: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
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

  // Batch load PARENT receipts for non-origin orders
  const orderIds = customer.orders.map((o) => o.id);
  const parentReceipts = orderIds.length
    ? await db.runReceipt.findMany({
        where: { kind: "PARENT", parentOrderId: { in: orderIds } },
        select: {
          id: true,
          parentOrderId: true,
          lines: { select: { lineTotal: true } },
        },
      })
    : [];
  const parentByOrderId = new Map<number, Array<{ lineTotal: any }>>();
  for (const rr of parentReceipts) {
    if (rr.parentOrderId != null && !parentByOrderId.has(rr.parentOrderId)) {
      parentByOrderId.set(rr.parentOrderId, rr.lines ?? []);
    }
  }

  // Build order summaries (SoT)
  const orders = customer.orders.map((o) => {
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

    const settled = sumSettlementCredits(o.payments as any);
    const remaining = Math.max(0, r2(charge - settled));

    return {
      id: o.id,
      orderCode: o.orderCode,
      channel: o.channel,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      dueDate: o.dueDate ? o.dueDate.toISOString() : null,
      charge,
      settled,
      remaining,
    };
  });

  // Ledger rows (chronological): charge then payments
  const rows: LedgerRow[] = [];
  let balance = 0;

  for (const o of customer.orders) {
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

    // charge row
    balance = r2(balance + charge);
    rows.push({
      kind: "order",
      date: o.createdAt.toISOString(),
      label: `Order ${o.orderCode} (${o.channel})`,
      debit: charge,
      credit: 0,
      orderId: o.id,
      due: o.dueDate ? o.dueDate.toISOString() : null,
      remainingAfter: balance,
    });

    // payments (AR settlement truth shown in ledger):
    // - CASH always counts
    // - INTERNAL_CREDIT only if rider-shortage bridge
    for (const p of o.payments) {
      const method = String(p.method ?? "").toUpperCase();
      const amt = Number(p.amount ?? 0);
      if (!isSettlementPayment(p as any as PaymentLite)) continue;

      // Cap credit to never make customer balance negative (display correctness)
      const dueNow = Math.max(0, balance);
      const applied = Math.min(Math.max(0, amt), dueNow);

      balance = r2(balance - applied);

      rows.push({
        kind: "payment",
        date: p.createdAt.toISOString(),
        label:
          method === "INTERNAL_CREDIT"
            ? `Settlement (Rider shortage bridge)${
                p.refNo ? ` • ${p.refNo}` : ""
              }`
            : `Payment ${method}${p.refNo ? ` • ${p.refNo}` : ""}`,
        debit: 0,
        credit: r2(amt),
        creditApplied: r2(applied),
        orderId: o.id,
        paymentId: p.id,
        method,
        refNo: p.refNo ?? null,
      });
    }
  }

  rows.sort((a, b) => +new Date(a.date) - +new Date(b.date));

  // Closing balance should match SoT remaining sum for open orders
  const openBalance = r2(
    orders.reduce((s, x) => s + Math.max(0, x.remaining), 0),
  );

  return json<LoaderData>({
    customer: {
      id: customer.id,
      name: displayName,
      alias: customer.alias ?? null,
      phone: customer.phone ?? null,
    },
    orders,
    rows,
    balance: openBalance,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const me = await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  });
  const customerId = Number(params.id);
  if (!Number.isFinite(customerId))
    return json({ ok: false, error: "Invalid ID" }, { status: 400 });

  // ─────────────────────────────────────────────
  // 🔒 SHIFT WRITABLE GUARD (writes happen here)
  // - NO SHIFT     → redirect to open shift
  // - LOCKED SHIFT → redirect shift console (?locked=1)
  // ─────────────────────────────────────────────
  const { shiftId: shiftIdForPayment } = await assertActiveShiftWritable({
    request,
    next: `${url.pathname}${url.search || ""}`,
  });

  const fd = await request.formData();
  const act = String(fd.get("_action") || "");

  if (act !== "recordPayment") {
    return json({ ok: false, error: "Unknown action" }, { status: 400 });
  }

  // CASH only for now
  const amountRaw = parseMoney(fd.get("amount"));
  const refNo = String(fd.get("refNo") || "").trim() || null;
  const orderIdRaw = Number(fd.get("orderId") || 0);
  const orderId =
    Number.isFinite(orderIdRaw) && orderIdRaw > 0 ? orderIdRaw : null;

  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    return json({ ok: false, error: "Enter amount > 0" }, { status: 400 });
  }

  // Helper inside tx: compute SoT remaining for an order
  const getSoTRemaining = async (tx: any, oid: number) => {
    const ord = await tx.order.findUnique({
      where: { id: oid },
      select: {
        id: true,
        customerId: true,
        originRunReceiptId: true,
        originRunReceipt: {
          select: { id: true, lines: { select: { lineTotal: true } } },
        },
        items: { select: { lineTotal: true } },
        payments: { select: { amount: true, method: true, refNo: true } },
      },
    });
    if (!ord) return 0;

    const parentReceipt = !ord.originRunReceiptId
      ? await tx.runReceipt.findFirst({
          where: { kind: "PARENT", parentOrderId: ord.id },
          select: { id: true, lines: { select: { lineTotal: true } } },
        })
      : null;

    const originLines = ord.originRunReceipt?.lines ?? [];
    const parentLines = parentReceipt?.lines ?? [];
    const itemLines = (ord.items ?? []).map((x: any) => ({
      lineTotal: x?.lineTotal,
    }));

    // ✅ HARD GUARD: Block AR payment if totals are not frozen (no trusted lineTotal SoT).
    // Acceptable sources of truth for "charge":
    // 1) originRunReceipt.lines.lineTotal
    // 2) parentReceipt.lines.lineTotal
    // 3) order.items.lineTotal (fallback snapshot)
    const hasFrozenOrigin = hasAllFrozenLineTotals(originLines as any);
    const hasFrozenParent = hasAllFrozenLineTotals(parentLines as any);
    const hasFrozenItems = hasAllFrozenLineTotals(itemLines as any);

    if (!hasFrozenOrigin && !hasFrozenParent && !hasFrozenItems) {
      throw new Error(
        `Blocked: Order #${ord.id} totals are not frozen yet (missing line totals). Finalize/freeze first (Manager check-in / parent receipt).`,
      );
    }

    const charge =
      originLines.length > 0
        ? sumFrozenLineTotals(originLines as any)
        : parentLines.length > 0
        ? sumFrozenLineTotals(parentLines as any)
        : sumFrozenLineTotals(itemLines as any);

    const settled = sumSettlementCredits(ord.payments as any);
    return Math.max(0, r2(charge - settled));
  };

  let change = 0;
  let lastAppliedOrderId: number | null = null;
  let lastPaymentId: number | null = null;

  try {
    await db.$transaction(async (tx) => {
      // Validate customer exists
      const cust = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!cust) throw new Error("Customer not found");

      // Determine targets: either one order, or FIFO open orders
      let targets: Array<{ id: number }> = [];

      if (orderId) {
        // Confirm this order belongs to customer
        const ord = await tx.order.findUnique({
          where: { id: orderId },
          select: { id: true, customerId: true, status: true },
        });
        if (!ord || ord.customerId !== customerId) {
          throw new Error("Order not found for this customer.");
        }
        targets = [{ id: orderId }];
      } else {
        targets = await tx.order.findMany({
          where: { customerId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });
        if (!targets.length)
          throw new Error("No open orders for this customer.");
      }

      let remainingToApply = r2(amountRaw);

      for (const t of targets) {
        if (remainingToApply <= EPS) break;

        const due = await getSoTRemaining(tx, t.id);
        if (due <= EPS) continue;

        const apply = Math.min(remainingToApply, due);
        if (apply <= EPS) continue;

        // Record CASH payment (capture last payment id for print redirect)
        const p = await tx.payment.create({
          data: {
            orderId: t.id,
            method: "CASH",
            amount: r2(apply),
            refNo,
            cashierId: me.userId,
            // ✅ Always tag to an ACTIVE + WRITABLE shift
            shiftId: shiftIdForPayment ?? null,
            // Keep types consistent w/ other routes (string money fields)
            tendered: r2(apply).toFixed(2),
            change: "0.00",
          },
          select: { id: true, orderId: true },
        });
        lastAppliedOrderId = Number(p.orderId);
        lastPaymentId = Number(p.id);

        remainingToApply = r2(remainingToApply - apply);

        // Update order status based on SoT after payment
        const dueAfter = await getSoTRemaining(tx, t.id);
        if (dueAfter <= EPS) {
          const receiptNo = await allocateReceiptNo(tx);
          await tx.order.update({
            where: { id: t.id },
            data: {
              status: "PAID",
              paidAt: new Date(),
              receiptNo,
              isOnCredit: false,
            },
          });
        } else {
          await tx.order.update({
            where: { id: t.id },
            data: {
              status: "PARTIALLY_PAID",
              isOnCredit: true,
            },
          });
        }
      }

      change = Math.max(0, r2(remainingToApply));
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, { status: 400 });
  }

  // ✅ Centralized print route (do not delete old routes yet)
  // If at least one payment was applied, bounce to /orders/:id/receipt and let it decide:
  // - OFFICIAL RECEIPT (PAID + receiptNo)
  // - ACK / CREDIT ACK (partial / on-credit)
  if (lastAppliedOrderId && lastPaymentId) {
    const returnTo = `/ar/customers/${customerId}`;
    const qs = new URLSearchParams({
      autoprint: "1",
      autoback: "1",
      returnTo,
      pid: String(lastPaymentId),
      tendered: r2(amountRaw).toFixed(2),
      change: r2(change).toFixed(2),
    });
    return redirect(`/orders/${lastAppliedOrderId}/receipt?${qs.toString()}`);
  }

  const qs = new URLSearchParams();
  if (change > 0) qs.set("change", change.toFixed(2));
  return redirect(`/ar/customers/${customerId}?${qs.toString()}`);
}

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number(n || 0),
  );

export default function CustomerLedgerPage() {
  const { customer, orders, rows, balance } = useLoaderData<LoaderData>();
  const nav = useNavigation();
  const [sp] = useSearchParams();

  // Default current month → today
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const startStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(
    start.getDate(),
  )}`;
  const endStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )}`;
  const statementHref = `/ar/customers/${customer.id}/statement?start=${startStr}&end=${endStr}`;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Customer Ledger
            </h1>
            <div className="text-sm text-slate-600">
              {customer.name}
              {customer.alias ? ` (${customer.alias})` : ""} •{" "}
              {customer.phone ?? "—"}
            </div>
            <div className="text-xs text-slate-500">
              SoT: frozen totals only • settlement includes rider-shortage
              bridge
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/ar"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ← AR Index
            </Link>
            <Link
              to={statementHref}
              className="rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white shadow-sm hover:bg-indigo-700"
            >
              Statement
            </Link>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right">
              <div className="text-xs text-slate-500">Open Balance</div>
              <div className="text-lg font-semibold text-slate-900 tabular-nums">
                {peso(balance)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {sp.get("change") ? (
        <div className="mx-auto max-w-5xl px-5 pt-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Change not applied to AR (excess payment):{" "}
            <b>{peso(Number(sp.get("change") || 0))}</b>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-5xl px-5 py-6 grid gap-6 lg:grid-cols-3">
        {/* Orders summary */}
        <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Open / Recent Orders (SoT)
          </div>

          {orders.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-600">No orders.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {orders.map((o) => (
                <div
                  key={o.id}
                  className="px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {o.orderCode}{" "}
                      <span className="text-xs text-slate-500">
                        ({o.channel})
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(o.createdAt).toLocaleString()}
                      {o.dueDate
                        ? ` • due ${new Date(o.dueDate).toLocaleDateString()}`
                        : ""}
                      {" • "}
                      <span className="uppercase">{o.status}</span>
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      Charge {peso(o.charge)} • Settled {peso(o.settled)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-indigo-700 tabular-nums">
                      {peso(o.remaining)}
                    </div>
                    <div className="text-[11px] text-slate-500">remaining</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Record Payment */}
        <aside className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Record Customer Payment (CASH)
          </div>

          <Form method="post" className="p-4 space-y-3">
            <input type="hidden" name="_action" value="recordPayment" />

            <label className="block text-sm">
              <span className="text-slate-700">Amount</span>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                inputMode="decimal"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <label className="block text-sm">
              <span className="text-slate-700">Apply to Order (optional)</span>
              <input
                name="orderId"
                type="number"
                placeholder="Order ID (blank = FIFO oldest)"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <label className="block text-sm">
              <span className="text-slate-700">Reference (optional)</span>
              <input
                name="refNo"
                placeholder="notes / OR / last4"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              disabled={nav.state !== "idle"}
            >
              {nav.state !== "idle" ? "Saving…" : "Save Payment"}
            </button>

            <div className="text-xs text-slate-500">
              Note: rider shortage is <b>not</b> collected from customer.
            </div>
          </Form>
        </aside>

        {/* Activity */}
        <section className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Activity (Charges + Settlements)
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-600">No activity.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows.map((r: any, i: number) => (
                <div
                  key={i}
                  className="px-4 py-3 flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900 truncate">
                      {r.kind === "order" ? "Charge" : "Settlement"} • {r.label}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(r.date).toLocaleString()}
                      {r.kind === "order" && r.due
                        ? ` • due ${new Date(r.due).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-sm font-semibold tabular-nums ${
                        r.kind === "order"
                          ? "text-slate-900"
                          : "text-emerald-700"
                      }`}
                    >
                      {r.kind === "order"
                        ? `+ ${peso(r.debit)}`
                        : `− ${peso(r.creditApplied ?? r.credit)}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Nested statement route */}
      <Outlet />
    </main>
  );
}
