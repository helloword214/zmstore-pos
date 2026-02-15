/* app/routes/store.payroll.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import {
  Prisma,
  RiderChargePaymentMethod,
  RiderChargeStatus,
  CashierChargePaymentMethod,
  CashierChargeStatus,
} from "@prisma/client";

// ---------------------------
// helpers
// ---------------------------
const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number.isFinite(n) ? n : 0,
  );

const PLAN_TAG = "PLAN:PAYROLL_DEDUCTION";
const hasPlanTag = (note: string | null | undefined) =>
  String(note ?? "").includes(PLAN_TAG);

const getAuthUserId = (me: any) => {
  const v = Number(me?.userId ?? me?.id ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

type ChargeRow = {
  id: number;
  kind: "RIDER" | "CASHIER";
  status: string;
  amount: number;
  paid: number;
  remaining: number;
  createdAt: string;
  note: string | null;
  run: { id: number; runCode: string } | null;
  variance: { id: number; variance: number; note: string | null } | null;
  shift: { id: number } | null;
};

type LoaderData = {
  me: {
    id: number;
    role: string;
    name: string;
    alias: string | null;
    email: string;
  };
  employees: Array<{
    key: string; // "RIDER:12" or "CASHIER:8"
    kind: "RIDER" | "CASHIER";
    id: number;
    name: string;
    openItems: number;
    totalRemaining: number;
  }>;
  selected: {
    key: string;
    kind: "RIDER" | "CASHIER";
    id: number;
    name: string;
  } | null;
  charges: ChargeRow[];
  totals: { remaining: number; items: number };
};

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  // header identity (same style as /store)
  const userRow = await db.user.findUnique({
    where: { id: me.userId },
    include: { employee: true },
  });
  if (!userRow) throw new Response("User not found", { status: 404 });

  const emp = userRow.employee;
  const fullName =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : userRow.email ?? "Unknown user";

  const url = new URL(request.url);
  const kindRaw = String(url.searchParams.get("kind") || "").toUpperCase();
  const idRaw = Number(url.searchParams.get("id") || 0);
  // backward compat: ?rider=123
  const riderCompat = Number(url.searchParams.get("rider") || 0);

  const selectedKind: "RIDER" | "CASHIER" =
    riderCompat > 0 ? "RIDER" : kindRaw === "CASHIER" ? "CASHIER" : "RIDER";
  const selectedId = riderCompat > 0 ? riderCompat : idRaw;
  const selectedKey = selectedId > 0 ? `${selectedKind}:${selectedId}` : "";

  // Pull all payroll-tagged open charges (both ledgers) then group in JS.
  const [riderChargesAll, cashierChargesAll] = await Promise.all([
    db.riderCharge.findMany({
      where: {
        status: {
          in: [RiderChargeStatus.OPEN, RiderChargeStatus.PARTIALLY_SETTLED],
        },
        note: { contains: PLAN_TAG },
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        amount: true,
        note: true,
        createdAt: true,
        riderId: true,
        rider: {
          select: { id: true, firstName: true, lastName: true, alias: true },
        },
        run: { select: { id: true, runCode: true } },
        variance: { select: { id: true, variance: true, note: true } },
        payments: { select: { amount: true } },
      },
    }),
    db.cashierCharge.findMany({
      where: {
        status: {
          in: [CashierChargeStatus.OPEN, CashierChargeStatus.PARTIALLY_SETTLED],
        },
        note: { contains: PLAN_TAG },
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        amount: true,
        note: true,
        createdAt: true,
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
    }),
  ]);

  // Normalize to a unified list
  const chargesAll: Array<
    ChargeRow & {
      employeeKey: string;
      employeeName: string;
      employeeKind: "RIDER" | "CASHIER";
      employeeId: number;
    }
  > = [];

  for (const c of riderChargesAll) {
    const total = r2(Number(c.amount ?? 0));
    const paid = r2(
      (c.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0),
    );
    const remaining = r2(Math.max(0, total - paid));
    if (remaining <= 0) continue;

    const name = c.rider.alias
      ? `${c.rider.alias} (${c.rider.firstName} ${c.rider.lastName})`
      : `${c.rider.firstName} ${c.rider.lastName}`;

    chargesAll.push({
      id: c.id,
      kind: "RIDER",
      status: String(c.status ?? ""),
      amount: total,
      paid,
      remaining,
      createdAt: c.createdAt.toISOString(),
      note: c.note ?? null,
      run: c.run ? { id: c.run.id, runCode: c.run.runCode } : null,
      variance: c.variance
        ? {
            id: c.variance.id,
            variance: r2(Number(c.variance.variance ?? 0)),
            note: c.variance.note ?? null,
          }
        : null,
      shift: null,
      employeeKey: `RIDER:${c.riderId}`,
      employeeName: name,
      employeeKind: "RIDER",
      employeeId: c.riderId,
    });
  }

  for (const c of cashierChargesAll) {
    const total = r2(Number(c.amount ?? 0));
    const paid = r2(
      (c.payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0),
    );
    const remaining = r2(Math.max(0, total - paid));
    if (remaining <= 0) continue;

    const name =
      c.cashier.employee?.alias ||
      [c.cashier.employee?.firstName, c.cashier.employee?.lastName]
        .filter(Boolean)
        .join(" ") ||
      c.cashier.email ||
      `User#${c.cashier.id}`;

    chargesAll.push({
      id: c.id,
      kind: "CASHIER",
      status: String(c.status ?? ""),
      amount: total,
      paid,
      remaining,
      createdAt: c.createdAt.toISOString(),
      note: c.note ?? null,
      run: null,
      variance: c.variance
        ? {
            id: c.variance.id,
            variance: r2(Number(c.variance.variance ?? 0)),
            note: c.variance.note ?? null,
          }
        : null,
      shift: c.shiftId ? { id: Number(c.shiftId) } : null,
      employeeKey: `CASHIER:${c.cashierId}`,
      employeeName: name,
      employeeKind: "CASHIER",
      employeeId: c.cashierId,
    });
  }

  // Build per-employee summary
  const byEmp = new Map<string, LoaderData["employees"][number]>();
  for (const c of chargesAll) {
    const cur = byEmp.get(c.employeeKey) ?? {
      key: c.employeeKey,
      kind: c.employeeKind,
      id: c.employeeId,
      name: c.employeeName,
      openItems: 0,
      totalRemaining: 0,
    };
    cur.openItems += 1;
    cur.totalRemaining = r2(cur.totalRemaining + c.remaining);
    byEmp.set(c.employeeKey, cur);
  }

  const employees = Array.from(byEmp.values()).sort(
    (a, b) => b.totalRemaining - a.totalRemaining,
  );

  const selected = selectedKey
    ? employees.find((e) => e.key === selectedKey) ?? null
    : null;
  const selectedCharges: ChargeRow[] = selected
    ? chargesAll
        .filter((c) => c.employeeKey === selected.key)
        .map((c) => ({
          id: c.id,
          kind: c.kind,
          status: c.status,
          amount: c.amount,
          paid: c.paid,
          remaining: c.remaining,
          createdAt: c.createdAt,
          note: c.note,
          run: c.run,
          variance: c.variance,
          shift: c.shift,
        }))
        .filter((c) => c.remaining > 0)
    : [];

  const totals = {
    remaining: r2(
      selectedCharges.reduce((s, c) => s + Number(c.remaining || 0), 0),
    ),
    items: selectedCharges.length,
  };

  return json<LoaderData>({
    me: {
      id: me.userId,
      role: me.role,
      name: fullName,
      alias: emp?.alias ?? null,
      email: userRow.email ?? "",
    },
    employees,
    selected: selected
      ? {
          key: selected.key,
          kind: selected.kind,
          id: selected.id,
          name: selected.name,
        }
      : null,
    charges: selectedCharges,
    totals,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);
  const recordedByUserId = getAuthUserId(me as any) || null;

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  if (intent !== "record-deduction") {
    throw new Response("Unsupported intent", { status: 400 });
  }

  const kind = String(fd.get("kind") || "").toUpperCase();
  const employeeId = Number(fd.get("employeeId"));
  const amountRaw = String(fd.get("amount") || "").trim();
  const note = String(fd.get("note") || "").trim(); // required: cutoff/date/reference

  if (!["RIDER", "CASHIER"].includes(kind)) {
    throw new Response("Invalid kind", { status: 400 });
  }
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw new Response("Invalid employee", { status: 400 });
  }

  const amtNum = Number(amountRaw);
  if (!Number.isFinite(amtNum) || amtNum <= 0) {
    throw new Response("Invalid deduction amount", { status: 400 });
  }

  if (!note.length) {
    throw new Response("Note is required (e.g., cutoff/date)", { status: 400 });
  }

  const now = new Date();

  await db.$transaction(async (tx) => {
    const charges =
      kind === "RIDER"
        ? await tx.riderCharge.findMany({
            where: {
              riderId: employeeId,
              status: {
                in: [
                  RiderChargeStatus.OPEN,
                  RiderChargeStatus.PARTIALLY_SETTLED,
                ],
              },
              note: { contains: PLAN_TAG },
            },
            orderBy: [{ createdAt: "asc" }],
            select: {
              id: true,
              amount: true,
              status: true,
              varianceId: true,
              createdAt: true,
              payments: { select: { amount: true } },
            },
          })
        : await tx.cashierCharge.findMany({
            where: {
              cashierId: employeeId,
              status: {
                in: [
                  CashierChargeStatus.OPEN,
                  CashierChargeStatus.PARTIALLY_SETTLED,
                ],
              },
              note: { contains: PLAN_TAG },
            },
            orderBy: [{ createdAt: "asc" }],
            select: {
              id: true,
              amount: true,
              status: true,
              varianceId: true,
              createdAt: true,
              payments: { select: { amount: true } },
            },
          });

    // Build remaining per charge
    const list = charges
      .map((c) => {
        const total = Number(c.amount ?? 0);
        const paid = (c.payments ?? []).reduce(
          (s, p) => s + Number(p.amount ?? 0),
          0,
        );
        const remaining = Math.max(0, total - paid);
        return { ...c, total, paid, remaining };
      })
      .filter((c) => c.remaining > 0);

    if (list.length === 0) {
      throw new Response("No payroll-tagged AR for this employee", {
        status: 400,
      });
    }

    const totalRemaining = list.reduce((s, c) => s + c.remaining, 0);
    const payTotal = Math.min(totalRemaining, amtNum);
    if (payTotal <= 0.0001) {
      throw new Response("Nothing to deduct", { status: 400 });
    }

    // Distribute deduction FIFO across charges
    let left = payTotal;

    for (const c of list) {
      if (left <= 0.0001) break;

      const payAmt = Math.min(c.remaining, left);
      if (payAmt <= 0.0001) continue;

      if (kind === "RIDER") {
        await tx.riderChargePayment.create({
          data: {
            chargeId: c.id,
            amount: new Prisma.Decimal(payAmt.toFixed(2)),
            method: RiderChargePaymentMethod.PAYROLL_DEDUCTION,
            note: `[PAYROLL:${note}]${
              recordedByUserId ? ` REC_BY:${recordedByUserId}` : ""
            }`,
            refNo: undefined,
            shiftId: null,
            cashierId: null,
          },
        });
      } else {
        await tx.cashierChargePayment.create({
          data: {
            chargeId: c.id,
            amount: new Prisma.Decimal(payAmt.toFixed(2)),
            method: CashierChargePaymentMethod.PAYROLL_DEDUCTION,
            note: `[PAYROLL:${note}]${
              recordedByUserId ? ` REC_BY:${recordedByUserId}` : ""
            }`,
            refNo: undefined,
            shiftId: null,
            cashierId: null,
          },
        });
      }

      // recompute paid/remaining for this charge (cheap + safe)
      const agg =
        kind === "RIDER"
          ? await tx.riderChargePayment.aggregate({
              where: { chargeId: c.id },
              _sum: { amount: true },
            })
          : await tx.cashierChargePayment.aggregate({
              where: { chargeId: c.id },
              _sum: { amount: true },
            });
      const paid2 = Number((agg as any)._sum?.amount ?? 0);
      const rem2 = Math.max(0, c.total - paid2);

      const nextStatus =
        rem2 <= 0.009
          ? "SETTLED"
          : paid2 > 0.009
          ? "PARTIALLY_SETTLED"
          : "OPEN";

      if (kind === "RIDER") {
        await tx.riderCharge.update({
          where: { id: c.id },
          data: {
            status: nextStatus as any,
            settledAt: nextStatus === "SETTLED" ? now : null,
          },
        });
      } else {
        await tx.cashierCharge.update({
          where: { id: c.id },
          data: {
            status: nextStatus as any,
            settledAt: nextStatus === "SETTLED" ? now : null,
          },
        });
      }

      // keep variance sync behavior (ledger → variance state)
      if (c.varianceId) {
        if (kind === "RIDER") {
          if (nextStatus === "SETTLED") {
            await tx.riderRunVariance.updateMany({
              where: {
                id: c.varianceId,
                status: {
                  in: [
                    "OPEN",
                    "MANAGER_APPROVED",
                    "RIDER_ACCEPTED",
                    "PARTIALLY_SETTLED",
                  ] as any,
                },
              },
              data: { status: "CLOSED" as any, resolvedAt: now },
            });
          } else if (nextStatus === "PARTIALLY_SETTLED") {
            await tx.riderRunVariance.updateMany({
              where: {
                id: c.varianceId,
                status: {
                  in: ["OPEN", "MANAGER_APPROVED", "RIDER_ACCEPTED"] as any,
                },
              },
              data: { status: "PARTIALLY_SETTLED" as any },
            });
          }
        } else {
          // Cashier variance statuses do not have PARTIALLY_SETTLED; close only when fully settled.
          if (nextStatus === "SETTLED") {
            await tx.cashierShiftVariance.updateMany({
              where: {
                id: c.varianceId,
                status: { in: ["OPEN", "MANAGER_APPROVED"] as any },
              },
              data: { status: "CLOSED" as any, resolvedAt: now },
            });
          }
        }
      }

      left = left - payAmt;
    }
  });

  return redirect(`/store/payroll?kind=${kind}&id=${employeeId}&deducted=1`);
}

export default function StorePayrollPage() {
  const { me, employees, selected, charges, totals } =
    useLoaderData<LoaderData>();
  const [sp] = useSearchParams();

  const kindRaw = String(sp.get("kind") || "").toUpperCase();
  const safeKindParam: "RIDER" | "CASHIER" =
    kindRaw === "CASHIER" ? "CASHIER" : "RIDER";
  const idParam = Number(sp.get("id") || 0);
  const riderCompat = Number(sp.get("rider") || 0);
  const selectedKey =
    selected?.key ??
    (riderCompat > 0
      ? `RIDER:${riderCompat}`
      : idParam > 0
      ? `${safeKindParam}:${idParam}`
      : "");
  const didDeduct = String(sp.get("deducted") || "") === "1";

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Payroll
            </h1>
            <p className="text-xs text-slate-500">
              Logged in as{" "}
              <span className="font-medium text-slate-700">
                {me.alias ? `${me.alias} (${me.name})` : me.name}
              </span>
              {" · "}
              <span className="uppercase tracking-wide">{me.role}</span>
              {" · "}
              <span>{me.email}</span>
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              to="/store/rider-ar"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              title="Tag AR items for payroll"
            >
              Rider AR →
            </Link>
            <Link
              to="/store/cashier-ar"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              title="Tag cashier AR items for payroll"
            >
              Cashier AR →
            </Link>
            <Link
              to="/store"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Back
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-5 py-6">
        {didDeduct ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Payroll deduction recorded.
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Left: employees list */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-800">
                Employees with payroll-tagged AR
              </div>
              <div className="text-xs text-slate-500">
                {employees.length} employee(s)
              </div>
            </div>

            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Employee</th>
                  <th className="px-3 py-2 text-right font-medium">Items</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Remaining
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-slate-500"
                    >
                      No payroll-tagged AR yet. Use{" "}
                      <span className="font-medium">Rider AR</span> /{" "}
                      <span className="font-medium">Cashier AR</span> to tag
                      items.
                    </td>
                  </tr>
                ) : (
                  employees.map((e) => {
                    const active = selectedKey === e.key;
                    return (
                      <tr key={e.key} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="text-slate-900">{e.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {e.kind}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {e.openItems}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                          {peso(e.totalRemaining)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            to={`/store/payroll?kind=${e.kind}&id=${e.id}`}
                            className={`inline-flex items-center justify-center rounded-xl border px-3 py-1.5 text-xs font-medium hover:bg-slate-50 ${
                              active
                                ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                                : "border-slate-200 bg-white text-slate-700"
                            }`}
                          >
                            {active ? "Selected" : "Open"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Right: selected employee details */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <div className="text-sm font-medium text-slate-800">
                {selected
                  ? `Payroll deduction · ${selected.name}`
                  : "Select an employee"}
              </div>
              {selected ? (
                <div className="text-xs text-slate-500">
                  {totals.items} item(s) · Remaining{" "}
                  <span className="font-medium text-rose-700">
                    {peso(totals.remaining)}
                  </span>
                </div>
              ) : (
                <div className="text-xs text-slate-500">—</div>
              )}
            </div>

            {!selected ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                Pick an employee on the left to record payroll deduction.
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  This records{" "}
                  <span className="font-semibold">PAYROLL_DEDUCTION</span>{" "}
                  payments (FIFO), and updates charge/variance statuses.
                </div>

                <Form
                  method="post"
                  className="grid gap-2 rounded-xl border border-slate-200 p-3"
                >
                  <input type="hidden" name="kind" value={selected.kind} />
                  <input type="hidden" name="employeeId" value={selected.id} />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      name="amount"
                      inputMode="decimal"
                      placeholder="Deduct amount"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                    />
                    <input
                      name="note"
                      placeholder="Cutoff/date (required)"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    name="_intent"
                    value="record-deduction"
                    className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    Record payroll deduction
                  </button>
                  <div className="text-[11px] text-slate-500">
                    Tip: kung gusto mo exact, set amount = remaining{" "}
                    {peso(totals.remaining)}.
                  </div>
                </Form>

                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Ref</th>
                        <th className="px-3 py-2 text-left font-medium">
                          Link
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Status
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          Remaining
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {charges.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-3 py-6 text-center text-slate-500"
                          >
                            No open items.
                          </td>
                        </tr>
                      ) : (
                        charges.map((c) => (
                          <tr key={c.id} className="border-t border-slate-100">
                            <td className="px-3 py-2">
                              <div className="text-slate-900">#{c.id}</div>
                              <div className="text-[11px] text-slate-500">
                                {c.kind}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {new Date(c.createdAt).toLocaleString()}
                              </div>
                              {c.variance ? (
                                <div className="text-[11px] text-slate-500">
                                  variance #{c.variance.id} ·{" "}
                                  <span className="font-medium">
                                    {peso(Math.abs(c.variance.variance))}
                                  </span>
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              {c.kind === "RIDER" ? (
                                c.run ? (
                                  <span className="font-mono text-slate-800">
                                    {c.run.runCode}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )
                              ) : c.shift ? (
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
                                  Payroll-tagged
                                </span>
                              ) : null}
                              {c.note ? (
                                <div className="mt-1 text-[11px] text-slate-500">
                                  Note: {c.note}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                              {peso(c.remaining)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="text-[11px] text-slate-500">
                  Only charges with{" "}
                  <span className="font-mono">{PLAN_TAG}</span> are shown here.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
