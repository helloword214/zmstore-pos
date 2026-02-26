/* app/routes/store.cashier-ar.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { CashierChargeStatus } from "@prisma/client";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTEmptyState } from "~/components/ui/SoTEmptyState";
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

type LoaderData = {
  rows: Array<{
    id: number;
    status: string;
    amount: number;
    paid: number;
    remaining: number;
    note: string | null;
    createdAt: string;
    settledAt: string | null;
    cashier: { id: number; name: string; email: string | null };
    shift: { id: number } | null;
    variance: { id: number; variance: number; note: string | null } | null;
  }>;
};

const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number.isFinite(n) ? n : 0,
  );

// ------------------------------------------------------------
// PLAN: Payroll deduction tagging only (CashierCharge)
// ------------------------------------------------------------
const PLAN_TAG = "PLAN:PAYROLL_DEDUCTION";
const hasPlanTag = (note: string | null | undefined) =>
  String(note ?? "").includes(PLAN_TAG);

const upsertPlanTag = (
  existingNote: string | null | undefined,
  extra: string,
) => {
  const base = String(existingNote ?? "").trim();
  const parts: string[] = [];
  if (!base.includes(PLAN_TAG)) parts.push(PLAN_TAG);
  if (base) parts.push(base);
  if (String(extra || "").trim()) parts.push(String(extra).trim());
  return parts.filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();
};

function statusTone(status: string): "neutral" | "warning" | "success" | "info" {
  if (status === "OPEN") return "warning";
  if (status === "PARTIALLY_SETTLED") return "info";
  if (status === "SETTLED") return "success";
  return "neutral";
}

function nameOfUser(u: any) {
  const emp = u?.employee;
  return (
    emp?.alias ||
    [emp?.firstName, emp?.lastName].filter(Boolean).join(" ") ||
    u?.email ||
    `User#${u?.id ?? "?"}`
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  const charges = await db.cashierCharge.findMany({
    where: {
      status: {
        in: [CashierChargeStatus.OPEN, CashierChargeStatus.PARTIALLY_SETTLED],
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      amount: true,
      note: true,
      createdAt: true,
      settledAt: true,
      cashierId: true,
      shiftId: true,
      cashier: {
        select: {
          id: true,
          email: true,
          employee: {
            select: { firstName: true, lastName: true, alias: true },
          },
        },
      },
      variance: { select: { id: true, variance: true, note: true } },
      payments: { select: { amount: true } },
    },
  });

  const out: LoaderData = {
    rows: charges.map((c) => {
      const total = r2(Number(c.amount ?? 0));
      const paid = r2(
        (c.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0),
      );
      const remaining = r2(Math.max(0, total - paid));

      return {
        id: c.id,
        status: String(c.status ?? ""),
        amount: total,
        paid,
        remaining,
        note: c.note ?? null,
        createdAt: c.createdAt.toISOString(),
        settledAt: c.settledAt ? c.settledAt.toISOString() : null,
        cashier: {
          id: c.cashier.id,
          email: c.cashier.email ?? null,
          name: nameOfUser(c.cashier),
        },
        shift: c.shiftId ? { id: Number(c.shiftId) } : null,
        variance: c.variance
          ? {
              id: c.variance.id,
              variance: r2(Number(c.variance.variance ?? 0)),
              note: c.variance.note ?? null,
            }
          : null,
      };
    }),
  };

  return json(out, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  if (intent !== "set-collection-plan") {
    throw new Response("Unsupported intent", { status: 400 });
  }

  const chargeId = Number(fd.get("chargeId"));
  const note = String(fd.get("note") || "").trim(); // optional remark (cutoff/date/etc)
  const plan = String(fd.get("plan") || "")
    .trim()
    .toUpperCase();

  if (!Number.isFinite(chargeId) || chargeId <= 0) {
    throw new Response("Invalid charge id", { status: 400 });
  }
  if (plan !== "PAYROLL_DEDUCTION") {
    throw new Response("Invalid plan", { status: 400 });
  }

  const charge = await db.cashierCharge.findUnique({
    where: { id: chargeId },
    select: { id: true, status: true, note: true },
  });
  if (!charge) throw new Response("Charge not found", { status: 404 });

  const st = String(charge.status ?? "");
  if (st === "WAIVED" || st === "SETTLED") {
    throw new Response("Charge is not editable", { status: 400 });
  }

  await db.cashierCharge.update({
    where: { id: chargeId },
    data: { note: upsertPlanTag(charge.note, note) },
  });

  return redirect("/store/cashier-ar?plan=payroll");
}

export default function StoreCashierARPage() {
  const { rows } = useLoaderData<LoaderData>();
  const [sp] = useSearchParams();

  const showDone =
    String(sp.get("plan") || "") === "payroll" ||
    String(sp.get("ok") || "") === "1";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Cashier AR (Payroll Plan)"
        subtitle="AR list only. Tag items for payroll deduction. Actual salary deduction happens in payroll."
        backTo="/store"
        backLabel="Dashboard"
      />

      <div className="mx-auto max-w-6xl px-5 py-6 space-y-3">
        <SoTActionBar
          right={
            <Link
              to="/store/cashier-variances"
              className="inline-flex items-center text-sm font-medium text-indigo-700 transition-colors duration-150 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              Cashier variances →
            </Link>
          }
        />
        {showDone ? (
          <SoTAlert tone="success" className="rounded-2xl px-4 py-3 text-sm">
            Tagged for payroll deduction.
          </SoTAlert>
        ) : null}

        <SoTCard className="overflow-hidden p-0">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-800">
              Open / Partially settled
            </div>
            <div className="text-xs text-slate-500">{rows.length} item(s)</div>
          </div>

          <SoTTable>
            <SoTTableHead>
              <SoTTableRow className="border-t-0">
                <SoTTh>Cashier</SoTTh>
                <SoTTh>Shift</SoTTh>
                <SoTTh>Status</SoTTh>
                <SoTTh align="right">Amount</SoTTh>
                <SoTTh align="right">Paid</SoTTh>
                <SoTTh align="right">Remaining</SoTTh>
                <SoTTh>Payroll plan</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {rows.length === 0 ? (
                <SoTTableEmptyRow
                  colSpan={7}
                  message={
                    <SoTEmptyState
                      title="No cashier AR."
                      hint="Open and partially settled cashier charges will appear here."
                    />
                  }
                />
              ) : (
                rows.map((c) => (
                  <SoTTableRow key={c.id}>
                    <SoTTd>
                      <div className="text-slate-800">{c.cashier.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {c.cashier.email ?? "—"} · charge ref #{c.id}
                      </div>
                      {c.variance ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          variance ref #{c.variance.id} ·{" "}
                          <span className="font-medium">
                            {peso(Math.abs(c.variance.variance))}
                          </span>
                        </div>
                      ) : null}
                    </SoTTd>

                    <SoTTd>
                      {c.shift ? (
                        <span className="font-mono text-slate-800">
                          shift#{c.shift.id}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </SoTTd>

                    <SoTTd>
                      <SoTStatusBadge tone={statusTone(c.status)}>
                        {c.status}
                      </SoTStatusBadge>

                      {hasPlanTag(c.note) ? (
                        <SoTStatusBadge tone="warning" className="ml-2">
                          Payroll deduction plan
                        </SoTStatusBadge>
                      ) : null}

                      {c.note ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Note: {c.note}
                        </div>
                      ) : null}
                    </SoTTd>

                    <SoTTd align="right" className="tabular-nums">
                      {peso(c.amount)}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums text-emerald-700">
                      {peso(c.paid)}
                    </SoTTd>
                    <SoTTd align="right" className="tabular-nums text-rose-700">
                      {peso(c.remaining)}
                    </SoTTd>

                    <SoTTd>
                      <Form method="post" className="grid gap-2">
                        <input type="hidden" name="chargeId" value={c.id} />
                        <input
                          name="note"
                          placeholder="Note (optional) e.g., cutoff/date/remark"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                        />
                        <input
                          type="hidden"
                          name="plan"
                          value="PAYROLL_DEDUCTION"
                        />
                        <SoTButton
                          type="submit"
                          name="_intent"
                          value="set-collection-plan"
                          variant="secondary"
                          className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-200"
                          disabled={hasPlanTag(c.note)}
                        >
                          {hasPlanTag(c.note)
                            ? "Already tagged for payroll"
                            : "Tag for payroll deduction (AR)"}
                        </SoTButton>
                        <div className="text-[11px] text-slate-500">
                          Remaining:{" "}
                          <span className="font-medium">{peso(c.remaining)}</span>
                        </div>
                      </Form>
                    </SoTTd>
                  </SoTTableRow>
                ))
              )}
            </tbody>
          </SoTTable>
        </SoTCard>
      </div>
    </main>
  );
}
