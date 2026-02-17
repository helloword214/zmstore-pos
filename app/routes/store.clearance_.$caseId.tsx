/* app/routes/store.clearance.$caseId.tsx */
/* STORE MANAGER — Commercial Clearance Case (Decision-enabled) */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import * as React from "react";
import { Prisma } from "@prisma/client";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { MONEY_EPS, r2, peso } from "~/utils/money";

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
    customerId: number | null;

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
    latestClaimType: "OPEN_BALANCE" | "PRICE_BARGAIN" | "OTHER" | null;

    latestDecision?: {
      kind: string;
      decidedAt: string | null;
      note: string | null;
      approvedDiscount: number | null;
      arBalance: number | null;
      decidedById: number | null;
    } | null;
  };
};

type DecisionKind =
  | "APPROVE_OPEN_BALANCE"
  | "APPROVE_DISCOUNT_OVERRIDE"
  | "APPROVE_HYBRID"
  | "REJECT";
type DecisionAction = "APPROVE" | "REJECT";

type ActionData = { ok: true } | { ok: false; error: string };

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
      customerId: true,

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
      claims: {
        select: { type: true },
        orderBy: { id: "desc" },
        take: 1,
      },

      decisions: {
        select: {
          kind: true,
          decidedAt: true,
          note: true,
          overrideDiscountApproved: true,
          arBalance: true,
          decidedById: true,
        },
        orderBy: { id: "desc" },
        take: 1,
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

  const latestDecision = c.decisions?.[0]
    ? {
        kind: String(c.decisions[0].kind),
        decidedAt: c.decisions[0].decidedAt
          ? new Date(c.decisions[0].decidedAt as any).toISOString()
          : null,
        note: c.decisions[0].note ?? null,
        approvedDiscount:
          c.decisions[0].overrideDiscountApproved != null
            ? Number(c.decisions[0].overrideDiscountApproved)
            : null,
        arBalance:
          c.decisions[0].arBalance != null
            ? Number(c.decisions[0].arBalance)
            : null,
        decidedById: c.decisions[0].decidedById ?? null,
      }
    : null;
  const latestClaimTypeRaw = String(c.claims?.[0]?.type || "");
  const latestClaimType: LoaderData["case"]["latestClaimType"] =
    latestClaimTypeRaw === "PRICE_BARGAIN"
      ? "PRICE_BARGAIN"
      : latestClaimTypeRaw === "OPEN_BALANCE"
      ? "OPEN_BALANCE"
      : latestClaimTypeRaw === "OTHER"
      ? "OTHER"
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
      customerId: c.customerId ?? null,
      latestClaimType,

      order,
      runReceipt,
      latestDecision,
    },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  const caseId = Number(params.caseId);
  if (!Number.isFinite(caseId)) {
    return json<ActionData>(
      { ok: false, error: "Invalid caseId." },
      { status: 400 },
    );
  }

  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  if (intent !== "decide") {
    return redirect(`/store/clearance/${caseId}`);
  }

  const rawAction = String(fd.get("decisionKind") || "").trim();
  const decisionAction: DecisionAction | null =
    rawAction === "APPROVE" || rawAction === "REJECT"
      ? (rawAction as DecisionAction)
      : null;
  if (!decisionAction) {
    return json<ActionData>(
      { ok: false, error: "Invalid decision kind." },
      { status: 400 },
    );
  }

  const approvedDiscountRaw = String(fd.get("approvedDiscount") || "").trim();
  const approvedDiscountParsed = Number(
    approvedDiscountRaw.replace(/[^0-9.]/g, ""),
  );
  if (
    decisionAction === "APPROVE" &&
    (!approvedDiscountRaw || !Number.isFinite(approvedDiscountParsed))
  ) {
    return json<ActionData>(
      { ok: false, error: "Approved discount is required for approval." },
      { status: 400 },
    );
  }

  const note = String(fd.get("note") || "").trim().slice(0, 500) || null;
  if (!note) {
    return json<ActionData>(
      { ok: false, error: "Decision note is required." },
      { status: 400 },
    );
  }

  const dueDateRaw = String(fd.get("dueDate") || "").trim();
  const dueDate =
    dueDateRaw.length > 0 ? new Date(`${dueDateRaw}T00:00:00`) : null;
  if (dueDateRaw && (!dueDate || Number.isNaN(dueDate.getTime()))) {
    return json<ActionData>(
      { ok: false, error: "Invalid due date." },
      { status: 400 },
    );
  }

  try {
    await db.$transaction(async (tx) => {
      const c = await tx.clearanceCase.findUnique({
        where: { id: caseId } as any,
        select: {
          id: true,
          status: true,
          customerId: true,
          orderId: true,
          runId: true,
          frozenTotal: true,
          cashCollected: true,
          decisions: {
            select: { id: true },
            orderBy: { id: "desc" },
            take: 1,
          },
        },
      });
      if (!c) throw new Error("Clearance case not found.");
      if (String(c.status) !== "NEEDS_CLEARANCE") {
        throw new Error("Case is no longer pending clearance.");
      }
      if ((c.decisions || []).length > 0) {
        throw new Error("Decision already exists for this case.");
      }

      const frozenTotal = r2(Math.max(0, Number(c.frozenTotal ?? 0)));
      const cashCollected = r2(Math.max(0, Number(c.cashCollected ?? 0)));
      const balance = r2(Math.max(0, frozenTotal - cashCollected));
      if (balance <= MONEY_EPS) {
        throw new Error("No remaining balance to decide.");
      }

      let finalDecisionKind: DecisionKind = "REJECT";
      let approvedDiscount = 0;
      let arBalance = 0;

      if (decisionAction === "APPROVE") {
        const requestedDiscount = r2(Math.max(0, approvedDiscountParsed || 0));
        if (requestedDiscount > balance + MONEY_EPS) {
          throw new Error("Approved discount cannot exceed remaining balance.");
        }

        approvedDiscount = r2(Math.min(balance, requestedDiscount));
        arBalance = r2(Math.max(0, balance - approvedDiscount));

        finalDecisionKind =
          approvedDiscount <= MONEY_EPS
            ? "APPROVE_OPEN_BALANCE"
            : arBalance <= MONEY_EPS
            ? "APPROVE_DISCOUNT_OVERRIDE"
            : "APPROVE_HYBRID";
      }

      if (arBalance > MONEY_EPS && !c.customerId) {
        throw new Error("Selected decision requires a customer record.");
      }

      const dData: any = {
        caseId: c.id,
        kind: finalDecisionKind,
        decidedById: me.userId,
        note,
      };
      if (approvedDiscount > MONEY_EPS) {
        dData.overrideDiscountApproved = new Prisma.Decimal(
          approvedDiscount.toFixed(2),
        );
      }
      if (arBalance > MONEY_EPS) {
        dData.arBalance = new Prisma.Decimal(arBalance.toFixed(2));
      }

      const createdDecision = await tx.clearanceDecision.create({
        data: dData,
        select: { id: true },
      });

      if (arBalance > MONEY_EPS) {
        await tx.customerAr.create({
          data: {
            customerId: Number(c.customerId),
            clearanceDecisionId: Number(createdDecision.id),
            ...(c.orderId ? { orderId: Number(c.orderId) } : {}),
            ...(c.runId ? { runId: Number(c.runId) } : {}),
            principal: new Prisma.Decimal(arBalance.toFixed(2)),
            balance: new Prisma.Decimal(arBalance.toFixed(2)),
            status: "OPEN",
            ...(dueDate ? { dueDate } : {}),
            note,
          } as any,
        });
      }

      await tx.clearanceCase.update({
        where: { id: c.id } as any,
        data: { status: "DECIDED" } as any,
      });
    });
  } catch (e: any) {
    return json<ActionData>(
      { ok: false, error: String(e?.message || "Failed to save decision.") },
      { status: 400 },
    );
  }

  return redirect(`/store/clearance/${caseId}?decided=1`);
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
  const actionData = useActionData<ActionData>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const canDecide = c.status === "NEEDS_CLEARANCE" && !c.latestDecision;
  const defaultApprovedDiscountInput = React.useMemo(
    () => (c.latestClaimType === "PRICE_BARGAIN" ? c.balance.toFixed(2) : "0.00"),
    [c.latestClaimType, c.balance],
  );
  const [approvedDiscountInput, setApprovedDiscountInput] =
    React.useState(defaultApprovedDiscountInput);
  React.useEffect(() => {
    setApprovedDiscountInput(defaultApprovedDiscountInput);
  }, [defaultApprovedDiscountInput]);

  const approvedDiscountParsed = React.useMemo(() => {
    const cleaned = approvedDiscountInput.replace(/[^0-9.]/g, "").trim();
    if (cleaned === "") return 0;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : Number.NaN;
  }, [approvedDiscountInput]);

  const discountOutOfRange =
    Number.isNaN(approvedDiscountParsed) ||
    approvedDiscountParsed < -MONEY_EPS ||
    approvedDiscountParsed > c.balance + MONEY_EPS;
  const approvedDiscountPreview = Number.isNaN(approvedDiscountParsed)
    ? 0
    : r2(Math.max(0, Math.min(c.balance, approvedDiscountParsed)));
  const arPreview = r2(Math.max(0, c.balance - approvedDiscountPreview));
  const decisionPreview: Exclude<DecisionKind, "REJECT"> =
    approvedDiscountPreview <= MONEY_EPS
      ? "APPROVE_OPEN_BALANCE"
      : arPreview <= MONEY_EPS
      ? "APPROVE_DISCOUNT_OVERRIDE"
      : "APPROVE_HYBRID";
  const approveNeedsCustomer = arPreview > MONEY_EPS && !c.customerId;
  const approveDisabled = busy || discountOutOfRange || approveNeedsCustomer;

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
              {c.latestClaimType ? (
                <Pill tone={c.latestClaimType === "PRICE_BARGAIN" ? "amber" : "indigo"}>
                  REQUEST: {c.latestClaimType}
                </Pill>
              ) : null}
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
                  {c.runReceipt ? "Linked Parent Order" : "Walk-in Order"}
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

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
          <h2 className="text-sm font-medium text-slate-800">
            Manager Decision
          </h2>

          {c.latestDecision ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="font-medium">
                DECIDED: <span className="font-mono">{c.latestDecision.kind}</span>
              </div>
              {c.latestDecision.decidedAt ? (
                <div className="mt-1 text-xs">
                  decidedAt:{" "}
                  <span className="font-mono">{c.latestDecision.decidedAt}</span>
                </div>
              ) : null}
              {c.latestDecision.approvedDiscount != null ? (
                <div className="mt-1 text-xs">
                  approvedDiscount:{" "}
                  <span className="font-mono">
                    {peso(c.latestDecision.approvedDiscount)}
                  </span>
                </div>
              ) : null}
              {c.latestDecision.arBalance != null ? (
                <div className="mt-1 text-xs">
                  arBalance:{" "}
                  <span className="font-mono">
                    {peso(c.latestDecision.arBalance)}
                  </span>
                </div>
              ) : null}
              {c.latestDecision.note ? (
                <div className="mt-1 text-xs whitespace-pre-wrap">
                  note: {c.latestDecision.note}
                </div>
              ) : null}
            </div>
          ) : canDecide ? (
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="decide" />

              <div>
                <label
                  htmlFor="decision-note"
                  className="block text-xs text-slate-600 mb-1"
                >
                  Decision note (required)
                </label>
                <textarea
                  id="decision-note"
                  name="note"
                  rows={3}
                  required
                  maxLength={500}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="Explain decision context..."
                />
              </div>

              <div>
                <label
                  htmlFor="approved-discount"
                  className="block text-xs text-slate-600 mb-1"
                >
                  Approved discount (auto-classify)
                </label>
                <input
                  id="approved-discount"
                  type="text"
                  name="approvedDiscount"
                  inputMode="decimal"
                  value={approvedDiscountInput}
                  onChange={(e) => setApprovedDiscountInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="0.00"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    Decision: <span className="font-mono">{decisionPreview}</span>
                  </span>
                  <span>
                    Discount:{" "}
                    <span className="font-mono">
                      {peso(approvedDiscountPreview)}
                    </span>
                  </span>
                  <span>
                    A/R: <span className="font-mono">{peso(arPreview)}</span>
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="due-date"
                  className="block text-xs text-slate-600 mb-1"
                >
                  A/R due date (optional, used when A/R &gt; 0)
                </label>
                <input
                  id="due-date"
                  type="date"
                  name="dueDate"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>

              {actionData && !actionData.ok ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {actionData.error}
                </div>
              ) : null}
              {discountOutOfRange ? (
                <p className="text-xs text-amber-700">
                  Approved discount must be between 0 and {peso(c.balance)}.
                </p>
              ) : null}
              {approveNeedsCustomer ? (
                <p className="text-xs text-amber-700">
                  This approval creates A/R, so customer record is required.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  name="decisionKind"
                  value="APPROVE"
                  disabled={approveDisabled}
                  className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 disabled:opacity-50"
                >
                  Approve (auto-classify)
                </button>
                <button
                  type="submit"
                  name="decisionKind"
                  value="REJECT"
                  disabled={busy}
                  className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </Form>
          ) : (
            <div className="text-xs text-slate-500">Case is not pending.</div>
          )}
        </section>
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
