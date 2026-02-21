/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";
import { assertActiveShiftWritable } from "~/utils/shiftGuards.server";
import { r2 } from "~/utils/money";

const EPS = 0.009;

function parseMoney(v: FormDataEntryValue | null) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseMoneyQuery(raw: string | null) {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return r2(n);
}

function parseIntQuery(raw: string | null) {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n <= 0) return null;
  return n;
}

function parsePaymentIdsQuery(raw: string | null) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseIntQuery(s.trim()))
    .filter((n): n is number => typeof n === "number" && n > 0)
    .slice(0, 80);
}

function parseAppliedLinesQuery(raw: string | null) {
  if (!raw) return [] as Array<{ arId: number; amount: number }>;
  const out: Array<{ arId: number; amount: number }> = [];
  for (const part of raw.split(",")) {
    const [arIdRaw, amountRaw] = part.split(":");
    const arId = parseIntQuery((arIdRaw || "").trim());
    const amount = parseMoneyQuery((amountRaw || "").trim());
    if (!arId || amount == null) continue;
    out.push({ arId, amount });
  }
  return out.slice(0, 120);
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type EntryRow = {
  id: number;
  createdAt: string;
  dueDate: string | null;
  status: string;
  principal: number;
  paid: number;
  remaining: number;
  orderCode: string | null;
  channel: string | null;
  decisionKind: string | null;
  receiptKey: string | null;
};

type LedgerRow =
  | {
      kind: "ar";
      date: string;
      label: string;
      debit: number;
      credit: 0;
      arId: number;
      due: string | null;
      runningAfter: number;
    }
  | {
      kind: "payment";
      date: string;
      label: string;
      debit: 0;
      credit: number;
      creditApplied: number;
      arId: number;
      paymentId: number;
      refNo: string | null;
      runningAfter: number;
    };

type LoaderData = {
  customer: {
    id: number;
    name: string;
    alias: string | null;
    phone: string | null;
  };
  entries: EntryRow[];
  rows: LedgerRow[];
  balance: number;
  lastPayment: null | {
    paid: number;
    applied: number;
    change: number;
    refNo: string | null;
    shiftId: number | null;
    cashierId: number | null;
    at: string;
    paymentIds: number[];
    lines: Array<{
      arId: number;
      amount: number;
      paymentId: number | null;
    }>;
  };
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  });

  const customerId = Number(params.id);
  if (!Number.isFinite(customerId)) {
    throw new Response("Invalid ID", { status: 400 });
  }

  const customer = await db.customer.findUnique({
    where: { id: customerId },
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
          createdAt: true,
          dueDate: true,
          status: true,
          principal: true,
          balance: true,
          order: {
            select: {
              id: true,
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

  const entries: EntryRow[] = customer.customerAr.map((ar) => {
    const principal = r2(Math.max(0, Number(ar.principal ?? 0)));
    const remaining = r2(Math.max(0, Number(ar.balance ?? 0)));
    const paid = r2(Math.max(0, principal - remaining));

    return {
      id: ar.id,
      createdAt: ar.createdAt.toISOString(),
      dueDate: ar.dueDate ? ar.dueDate.toISOString() : null,
      status: String(ar.status ?? ""),
      principal,
      paid,
      remaining,
      orderCode: ar.order?.orderCode ?? null,
      channel: ar.order?.channel ?? null,
      decisionKind: ar.clearanceDecision?.kind
        ? String(ar.clearanceDecision.kind)
        : null,
      receiptKey: ar.clearanceDecision?.clearanceCase?.receiptKey
        ? String(ar.clearanceDecision.clearanceCase.receiptKey)
        : null,
    };
  });

  const events: Array<{
    kind: "ar" | "payment";
    date: string;
    arId: number;
    label: string;
    debit: number;
    credit: number;
    due?: string | null;
    paymentId?: number;
    refNo?: string | null;
  }> = [];

  for (const ar of customer.customerAr) {
    const principal = r2(Math.max(0, Number(ar.principal ?? 0)));
    const orderPart = ar.order?.orderCode ? ` • ${ar.order.orderCode}` : "";
    const decisionPart = ar.clearanceDecision?.kind
      ? ` • ${String(ar.clearanceDecision.kind)}`
      : "";

    events.push({
      kind: "ar",
      date: ar.createdAt.toISOString(),
      arId: ar.id,
      label: `A/R #${ar.id}${orderPart}${decisionPart}`,
      debit: principal,
      credit: 0,
      due: ar.dueDate ? ar.dueDate.toISOString() : null,
    });

    for (const p of ar.payments ?? []) {
      events.push({
        kind: "payment",
        date: p.createdAt.toISOString(),
        arId: ar.id,
        label: `Payment${p.refNo ? ` • ${p.refNo}` : ""}${
          p.note ? ` • ${p.note}` : ""
        }`,
        debit: 0,
        credit: r2(Math.max(0, Number(p.amount ?? 0))),
        paymentId: p.id,
        refNo: p.refNo ?? null,
      });
    }
  }

  events.sort((a, b) => {
    const d = +new Date(a.date) - +new Date(b.date);
    if (d !== 0) return d;
    if (a.kind === b.kind) return 0;
    return a.kind === "ar" ? -1 : 1;
  });

  let running = 0;
  const rows: LedgerRow[] = events.map((evt) => {
    if (evt.kind === "ar") {
      running = r2(running + evt.debit);
      return {
        kind: "ar",
        date: evt.date,
        label: evt.label,
        debit: evt.debit,
        credit: 0,
        arId: evt.arId,
        due: evt.due ?? null,
        runningAfter: running,
      };
    }

    const dueNow = Math.max(0, running);
    const applied = r2(Math.min(Math.max(0, evt.credit), dueNow));
    running = r2(running - applied);

    return {
      kind: "payment",
      date: evt.date,
      label: evt.label,
      debit: 0,
      credit: r2(evt.credit),
      creditApplied: applied,
      arId: evt.arId,
      paymentId: Number(evt.paymentId ?? 0),
      refNo: evt.refNo ?? null,
      runningAfter: running,
    };
  });

  const balance = r2(entries.reduce((sum, e) => sum + Math.max(0, e.remaining), 0));

  const posted = url.searchParams.get("posted") === "1";
  let lastPayment: LoaderData["lastPayment"] = null;

  if (posted) {
    const paid = parseMoneyQuery(url.searchParams.get("paid"));
    const applied = parseMoneyQuery(url.searchParams.get("applied"));
    const change = parseMoneyQuery(url.searchParams.get("change")) ?? 0;
    const refNo = String(url.searchParams.get("ref") || "").trim() || null;
    const shiftId = parseIntQuery(url.searchParams.get("shift"));
    const cashierId = parseIntQuery(url.searchParams.get("cashier"));
    const atRaw = String(url.searchParams.get("at") || "").trim();
    const atIso = atRaw && !Number.isNaN(Date.parse(atRaw))
      ? new Date(atRaw).toISOString()
      : new Date().toISOString();

    const queryLines = parseAppliedLinesQuery(url.searchParams.get("lines"));
    const paymentIds = parsePaymentIdsQuery(url.searchParams.get("pids"));

    let proofLines: Array<{ arId: number; amount: number; paymentId: number | null }> =
      queryLines.map((ln) => ({
        arId: ln.arId,
        amount: ln.amount,
        paymentId: null,
      }));
    let proofIds = paymentIds;
    let proofRefNo = refNo;
    let proofShiftId = shiftId;
    let proofCashierId = cashierId;
    let proofAt = atIso;

    if (paymentIds.length) {
      const dbPayments = await db.customerArPayment.findMany({
        where: {
          id: { in: paymentIds },
          ar: { customerId },
        },
        select: {
          id: true,
          arId: true,
          amount: true,
          refNo: true,
          shiftId: true,
          cashierId: true,
          createdAt: true,
        },
        orderBy: { id: "asc" },
      });
      const byId = new Map<number, (typeof dbPayments)[number]>();
      for (const p of dbPayments) byId.set(p.id, p);
      const ordered = paymentIds
        .map((id) => byId.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));

      if (ordered.length) {
        proofLines = ordered.map((p) => ({
          arId: p.arId,
          amount: r2(Number(p.amount ?? 0)),
          paymentId: p.id,
        }));
        proofIds = ordered.map((p) => p.id);
        proofRefNo = proofRefNo ?? (ordered[0].refNo ?? null);
        proofShiftId = proofShiftId ?? (ordered[0].shiftId ?? null);
        proofCashierId = proofCashierId ?? (ordered[0].cashierId ?? null);
        proofAt = ordered[0].createdAt.toISOString();
      }
    }

    if (paid != null && applied != null && paid > 0 && applied > 0) {
      lastPayment = {
        paid,
        applied,
        change: Math.max(0, change),
        refNo: proofRefNo,
        shiftId: proofShiftId ?? null,
        cashierId: proofCashierId ?? null,
        at: proofAt,
        paymentIds: proofIds,
        lines: proofLines,
      };
    }
  }

  return json<LoaderData>({
    customer: {
      id: customer.id,
      name: displayName,
      alias: customer.alias ?? null,
      phone: customer.phone ?? null,
    },
    entries,
    rows,
    balance,
    lastPayment,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const me = await requireOpenShift(request, {
    next: `${url.pathname}${url.search || ""}`,
  });

  const customerId = Number(params.id);
  if (!Number.isFinite(customerId)) {
    return json({ ok: false, error: "Invalid ID" }, { status: 400 });
  }

  const { shiftId: shiftIdForPayment } = await assertActiveShiftWritable({
    request,
    next: `${url.pathname}${url.search || ""}`,
  });

  const fd = await request.formData();
  const act = String(fd.get("_action") || "");
  if (act !== "recordPayment") {
    return json({ ok: false, error: "Unknown action" }, { status: 400 });
  }

  const amountRaw = parseMoney(fd.get("amount"));
  const refNo = String(fd.get("refNo") || "").trim() || null;
  const arIdRaw = Number(fd.get("arId") || 0);
  const arId = Number.isFinite(arIdRaw) && arIdRaw > 0 ? arIdRaw : null;

  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    return json({ ok: false, error: "Enter amount > 0" }, { status: 400 });
  }

  const paidTotal = r2(amountRaw);
  let change = 0;
  let appliedTotal = 0;
  const appliedLines: Array<{ arId: number; amount: number; paymentId: number }> =
    [];

  try {
    await db.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!customer) throw new Error("Customer not found.");

      let targets: Array<{ id: number }> = [];
      if (arId) {
        const row = await tx.customerAr.findFirst({
          where: { id: arId, customerId },
          select: { id: true, balance: true },
        });
        if (!row) throw new Error("A/R entry not found for this customer.");
        if (Number(row.balance ?? 0) <= EPS) {
          throw new Error("Selected A/R entry is already settled.");
        }
        targets = [{ id: row.id }];
      } else {
        targets = await tx.customerAr.findMany({
          where: {
            customerId,
            balance: { gt: 0 },
            status: { in: ["OPEN", "PARTIALLY_SETTLED"] },
          },
          select: { id: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        if (!targets.length) throw new Error("No open A/R entries for this customer.");
      }

      let remainingToApply = paidTotal;

      for (const t of targets) {
        if (remainingToApply <= EPS) break;

        const row = await tx.customerAr.findUnique({
          where: { id: t.id },
          select: { id: true, balance: true, status: true },
        });
        if (!row) continue;

        const due = r2(Math.max(0, Number(row.balance ?? 0)));
        if (due <= EPS) continue;

        const apply = r2(Math.min(remainingToApply, due));
        if (apply <= EPS) continue;

        const createdPayment = await tx.customerArPayment.create({
          data: {
            arId: row.id,
            amount: apply,
            refNo,
            shiftId: shiftIdForPayment ?? null,
            cashierId: me.userId,
          },
          select: { id: true },
        });
        appliedLines.push({ arId: row.id, amount: apply, paymentId: createdPayment.id });

        const newBalance = r2(Math.max(0, due - apply));
        await tx.customerAr.update({
          where: { id: row.id },
          data: {
            balance: newBalance,
            status: newBalance <= EPS ? "SETTLED" : "PARTIALLY_SETTLED",
            settledAt: newBalance <= EPS ? new Date() : null,
          } as any,
        });

        remainingToApply = r2(remainingToApply - apply);
        appliedTotal = r2(appliedTotal + apply);
      }

      if (appliedTotal <= EPS) {
        throw new Error("No open A/R entries available for this payment.");
      }

      change = Math.max(0, r2(remainingToApply));
    });
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, { status: 400 });
  }

  const qs = new URLSearchParams();
  qs.set("posted", "1");
  qs.set("paid", paidTotal.toFixed(2));
  qs.set("applied", appliedTotal.toFixed(2));
  if (change > 0) qs.set("change", change.toFixed(2));
  if (refNo) qs.set("ref", refNo);
  if (shiftIdForPayment) qs.set("shift", String(shiftIdForPayment));
  qs.set("cashier", String(me.userId));
  qs.set("at", new Date().toISOString());
  if (appliedLines.length) {
    qs.set(
      "pids",
      appliedLines.map((ln) => String(ln.paymentId)).join(","),
    );
    qs.set(
      "lines",
      appliedLines.map((ln) => `${ln.arId}:${ln.amount.toFixed(2)}`).join(","),
    );
  }
  return redirect(`/ar/customers/${customerId}?${qs.toString()}`);
}

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number(n || 0),
  );

export default function CustomerLedgerPage() {
  const { customer, entries, rows, balance, lastPayment } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<{ ok?: boolean; error?: string }>();
  const actionError =
    actionData && typeof actionData.error === "string" ? actionData.error : "";
  const nav = useNavigation();
  const [sp] = useSearchParams();
  const legacyChange = Number(sp.get("change") || 0);
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
  const clearSuccessHref = `/ar/customers/${customer.id}`;

  const printReceipt = () => {
    if (!lastPayment) return;
    const printedAt = new Date().toLocaleString();
    const paidStr = peso(lastPayment.paid);
    const appliedStr = peso(lastPayment.applied);
    const changeStr = peso(lastPayment.change);
    const linesHtml = lastPayment.lines.length
      ? lastPayment.lines
          .map(
            (ln) => `<div class="line"><span>A/R #${ln.arId}</span><span>${escapeHtml(
              peso(ln.amount),
            )}</span></div>`,
          )
          .join("")
      : `<div class="line"><span>Applied</span><span>${escapeHtml(
          appliedStr,
        )}</span></div>`;
    const paymentIds = lastPayment.paymentIds.length
      ? lastPayment.paymentIds.map((id) => `#${id}`).join(", ")
      : "N/A";
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>A/R Payment Receipt</title>
  <style>
    @page { size: 58mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 2mm; width: 58mm; font-family: "Courier New", monospace; color: #111827; font-size: 11px; }
    .wrap { width: 100%; }
    .center { text-align: center; }
    .title { font-weight: 700; font-size: 12px; }
    .sub { font-size: 10px; color: #475569; }
    .sep { border-top: 1px dashed #94a3b8; margin: 6px 0; }
    .line { display: flex; justify-content: space-between; gap: 6px; margin: 2px 0; }
    .strong { font-weight: 700; }
    .small { font-size: 10px; color: #475569; word-break: break-word; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="center title">A/R PAYMENT RECEIPT</div>
    <div class="center sub">${escapeHtml(printedAt)}</div>
    <div class="sep"></div>
    <div class="line"><span>Customer</span><span>${escapeHtml(customer.name)}</span></div>
    <div class="line"><span>Cashier</span><span>#${lastPayment.cashierId ?? "N/A"}</span></div>
    <div class="line"><span>Shift</span><span>#${lastPayment.shiftId ?? "N/A"}</span></div>
    <div class="line"><span>Ref</span><span>${escapeHtml(lastPayment.refNo ?? "N/A")}</span></div>
    <div class="sep"></div>
    <div class="line strong"><span>Paid</span><span>${escapeHtml(paidStr)}</span></div>
    <div class="line"><span>Applied</span><span>${escapeHtml(appliedStr)}</span></div>
    <div class="line"><span>Change</span><span>${escapeHtml(changeStr)}</span></div>
    <div class="sep"></div>
    <div class="small">Applied Lines</div>
    ${linesHtml}
    <div class="sep"></div>
    <div class="small">Payment IDs: ${escapeHtml(paymentIds)}</div>
    <div class="small">Recorded At: ${escapeHtml(
      new Date(lastPayment.at).toLocaleString(),
    )}</div>
  </div>
</body>
</html>`;

    const w = window.open("about:blank", "_blank", "width=420,height=720");
    if (!w) {
      window.alert("Popup blocked. Please allow popups for printing.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    window.setTimeout(() => {
      try {
        w.print();
      } catch {
        // no-op; user can still print manually from opened window
      }
    }, 120);
  };

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Customer A/R Ledger
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

      {lastPayment ? (
        <div className="mx-auto max-w-5xl px-5 pt-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <div className="font-semibold">A/R payment posted successfully.</div>
            <div className="mt-1 text-xs text-emerald-900/90">
              Paid {peso(lastPayment.paid)} • Applied {peso(lastPayment.applied)}{" "}
              • Change {peso(lastPayment.change)}
              {lastPayment.refNo ? ` • Ref ${lastPayment.refNo}` : ""}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                onClick={printReceipt}
              >
                Print Receipt (58mm)
              </button>
              <Link
                to={clearSuccessHref}
                className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100/60"
              >
                Clear
              </Link>
              {lastPayment.paymentIds.length ? (
                <span className="text-[11px] text-emerald-900/80">
                  Payment IDs: {lastPayment.paymentIds.map((id) => `#${id}`).join(", ")}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : legacyChange > 0 ? (
        <div className="mx-auto max-w-5xl px-5 pt-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Excess cash not applied: <b>{peso(legacyChange)}</b>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-5xl px-5 py-6 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            A/R Entries (Decision-backed)
          </div>

          {entries.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-600">No A/R entries.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {entries.map((e) => (
                <div key={e.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      A/R #{e.id}
                      {e.orderCode ? (
                        <span className="text-xs text-slate-500">
                          {` • ${e.orderCode}${e.channel ? ` (${e.channel})` : ""}`}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(e.createdAt).toLocaleString()}
                      {e.dueDate
                        ? ` • due ${new Date(e.dueDate).toLocaleDateString()}`
                        : ""}
                      {e.decisionKind ? ` • ${e.decisionKind}` : ""}
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      Principal {peso(e.principal)} • Paid {peso(e.paid)}
                      {e.receiptKey ? ` • ${e.receiptKey}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-indigo-700 tabular-nums">
                      {peso(e.remaining)}
                    </div>
                    <div className="text-[11px] text-slate-500">{e.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Record A/R Payment (CASH)
          </div>

          <Form method="post" className="p-4 space-y-3">
            <input type="hidden" name="_action" value="recordPayment" />

            {actionError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {actionError}
              </div>
            ) : null}

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
              <span className="text-slate-700">A/R Entry ID (optional)</span>
              <input
                name="arId"
                type="number"
                placeholder="Blank = FIFO oldest"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
              />
            </label>

            <label className="block text-sm">
              <span className="text-slate-700">Reference (optional)</span>
              <input
                name="refNo"
                placeholder="OR / notes"
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
              Payments are applied to approved customerAr balances only.
            </div>
          </Form>
        </aside>

        <section className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            Activity (A/R Charges + Payments)
          </div>
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-sm text-slate-600">No activity.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <div key={`${r.kind}-${i}`} className="px-4 py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900 truncate">
                      {r.kind === "ar" ? "A/R Charge" : "Payment"} • {r.label}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(r.date).toLocaleString()}
                      {r.kind === "ar" && r.due
                        ? ` • due ${new Date(r.due).toLocaleDateString()}`
                        : ""}
                      {` • A/R #${r.arId}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-sm font-semibold tabular-nums ${
                        r.kind === "ar" ? "text-slate-900" : "text-emerald-700"
                      }`}
                    >
                      {r.kind === "ar"
                        ? `+ ${peso(r.debit)}`
                        : `− ${peso(r.creditApplied ?? r.credit)}`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Running: {peso(r.runningAfter)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

    </main>
  );
}
