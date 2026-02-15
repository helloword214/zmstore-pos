/* app/routes/store.cashier-ar.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { CashierChargeStatus } from "@prisma/client";

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
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Cashier AR (Payroll Plan)
            </h1>
            <p className="text-xs text-slate-500">
              AR list only. Tag items for payroll deduction. Actual salary
              deduction happens in payroll.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/store/cashier-variances"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cashier Variances →
            </Link>
            <Link
              to="/store"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Back
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4 space-y-3">
        {showDone ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Tagged for payroll deduction.
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-800">
              Open / Partially settled
            </div>
            <div className="text-xs text-slate-500">{rows.length} item(s)</div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Cashier</th>
                <th className="px-3 py-2 text-left font-medium">Shift</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Paid</th>
                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                <th className="px-3 py-2 text-left font-medium">
                  Payroll plan
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    No cashier AR.
                  </td>
                </tr>
              ) : (
                rows.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-slate-100 align-top"
                  >
                    <td className="px-3 py-2">
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
                    </td>

                    <td className="px-3 py-2">
                      {c.shift ? (
                        <span className="font-mono text-slate-800">
                          shift#{c.shift.id}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    <td className="px-3 py-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                        {c.status}
                      </span>

                      {hasPlanTag(c.note) ? (
                        <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                          Payroll deduction plan
                        </span>
                      ) : null}

                      {c.note ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Note: {c.note}
                        </div>
                      ) : null}
                    </td>

                    <td className="px-3 py-2 text-right tabular-nums">
                      {peso(c.amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                      {peso(c.paid)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                      {peso(c.remaining)}
                    </td>

                    <td className="px-3 py-2">
                      <Form method="post" className="grid gap-2">
                        <input type="hidden" name="chargeId" value={c.id} />
                        <input
                          name="note"
                          placeholder="Note (optional) e.g., cutoff/date/remark"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                        />
                        <input
                          type="hidden"
                          name="plan"
                          value="PAYROLL_DEDUCTION"
                        />
                        <button
                          type="submit"
                          name="_intent"
                          value="set-collection-plan"
                          className="inline-flex items-center justify-center rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
                          disabled={hasPlanTag(c.note)}
                        >
                          {hasPlanTag(c.note)
                            ? "Already tagged for payroll"
                            : "Tag for payroll deduction (AR)"}
                        </button>
                        <div className="text-[11px] text-slate-500">
                          Remaining:{" "}
                          <span className="font-medium">
                            {peso(c.remaining)}
                          </span>
                        </div>
                      </Form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
