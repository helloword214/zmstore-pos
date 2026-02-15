/* app/routes/store.rider-variances.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { Prisma, RiderChargeStatus } from "@prisma/client";

type LoaderData = {
  tab: "open" | "awaiting" | "history";
  counts: {
    open: number;
    awaiting: number;
    history: number;
  };
  rows: Array<{
    id: number;
    status: string;
    resolution: string | null;
    createdAt: string;
    expected: number;
    actual: number;
    variance: number;
    note: string | null;
    receipt: null | {
      id: number;
      receiptKey: string;
      kind: string;
    };
    managerApprovedAt: string | null;
    riderAcceptedAt: string | null;
    run: { id: number; runCode: string };
    rider: { id: number; name: string };
  }>;
};

const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  const url = new URL(request.url);
  const tabRaw = String(url.searchParams.get("tab") || "open");
  const tab: LoaderData["tab"] =
    tabRaw === "awaiting" || tabRaw === "history" ? tabRaw : "open";

  // Counts for badges / navbar alert consistency
  const [openCount, awaitingCount, historyCount] = await Promise.all([
    db.riderRunVariance.count({ where: { status: "OPEN" } }),
    db.riderRunVariance.count({
      where: {
        status: "MANAGER_APPROVED",
        resolution: "CHARGE_RIDER",
        riderAcceptedAt: null,
        variance: { lt: 0 }, // shortage-only
      },
    }),
    db.riderRunVariance.count({
      where: {
        OR: [
          // explicit closed/waived
          { status: { in: ["WAIVED", "CLOSED", "RIDER_ACCEPTED"] } },
          // manager already approved info-only (cleared for cashier)
          { status: "MANAGER_APPROVED", resolution: { in: ["INFO_ONLY"] } },
        ],
      },
    }),
  ]);

  // Row filters per tab
  const where =
    tab === "open"
      ? { status: "OPEN" as const }
      : tab === "awaiting"
      ? ({
          status: "MANAGER_APPROVED" as const,
          resolution: "CHARGE_RIDER" as const,
          riderAcceptedAt: null,
          variance: { lt: 0 },
        } as const)
      : ({
          OR: [
            { status: { in: ["WAIVED", "CLOSED", "RIDER_ACCEPTED"] as any } },
            {
              status: "MANAGER_APPROVED" as const,
              resolution: "INFO_ONLY" as const,
            },
          ],
        } as any);

  const rows = await db.riderRunVariance.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: tab === "history" ? 100 : 200,
    select: {
      id: true,
      status: true,
      resolution: true,
      createdAt: true,
      expected: true,
      actual: true,
      variance: true,
      note: true,
      managerApprovedAt: true,
      riderAcceptedAt: true,
      receipt: {
        select: { id: true, receiptKey: true, kind: true },
      },
      run: { select: { id: true, runCode: true } },
      rider: {
        select: { id: true, firstName: true, lastName: true, alias: true },
      },
    },
  });

  const out: LoaderData = {
    tab,
    counts: {
      open: openCount,
      awaiting: awaitingCount,
      history: historyCount,
    },
    rows: rows.map((v) => ({
      id: v.id,
      status: String(v.status ?? ""),
      resolution: v.resolution ? String(v.resolution) : null,
      createdAt: v.createdAt.toISOString(),
      expected: r2(Number(v.expected ?? 0)),
      actual: r2(Number(v.actual ?? 0)),
      variance: r2(Number(v.variance ?? 0)),
      note: v.note ?? null,
      receipt: v.receipt
        ? {
            id: v.receipt.id,
            receiptKey: v.receipt.receiptKey,
            kind: String(v.receipt.kind),
          }
        : null,
      managerApprovedAt: v.managerApprovedAt
        ? v.managerApprovedAt.toISOString()
        : null,
      riderAcceptedAt: v.riderAcceptedAt
        ? v.riderAcceptedAt.toISOString()
        : null,
      run: { id: v.run.id, runCode: v.run.runCode },
      rider: {
        id: v.rider.id,
        name: v.rider.alias
          ? `${v.rider.alias} (${v.rider.firstName} ${v.rider.lastName})`
          : `${v.rider.firstName} ${v.rider.lastName}`,
      },
    })),
  };

  return json(out);
}

export async function action({ request }: ActionFunctionArgs) {
  const me = await requireRole(request, ["STORE_MANAGER", "ADMIN"]);

  const fd = await request.formData();
  const intent = String(fd.get("_intent") || "");
  const id = Number(fd.get("id"));
  const resolution = String(fd.get("resolution") || "");
  const note = String(fd.get("note") || "").trim();

  if (!Number.isFinite(id) || id <= 0)
    throw new Response("Invalid variance id", { status: 400 });
  if (intent !== "manager-decide")
    throw new Response("Unsupported intent", { status: 400 });

  if (!["CHARGE_RIDER", "WAIVE", "INFO_ONLY"].includes(resolution)) {
    throw new Response("Invalid resolution", { status: 400 });
  }

  const row = await db.riderRunVariance.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      runId: true,
      riderId: true,
      variance: true,
    },
  });
  if (!row) throw new Response("Variance not found", { status: 404 });

  // only allow decision from OPEN (or allow re-decision while MANAGER_APPROVED if needed)
  if (!["OPEN", "MANAGER_APPROVED"].includes(String(row.status ?? ""))) {
    throw new Response("Variance is not editable", { status: 400 });
  }

  const now = new Date();

  // Status transitions:
  // - CHARGE_RIDER -> MANAGER_APPROVED (wait rider accept)
  // - INFO_ONLY   -> MANAGER_APPROVED (cashier can finalize; no rider accept needed)
  // - WAIVE       -> WAIVED (cleared)
  const nextStatus = resolution === "WAIVE" ? "WAIVED" : "MANAGER_APPROVED";
  const managerApprovedById = Number((me as any).userId) || null;

  await db.$transaction(async (tx) => {
    // 1) update variance decision
    await tx.riderRunVariance.update({
      where: { id },
      data: {
        resolution: resolution as any,
        status: nextStatus as any,
        managerApprovedAt: now,
        managerApprovedById,
        note: note.length ? note : undefined,
      },
    });

    // 2) OPTION B ledger side-effects
    if (resolution === "CHARGE_RIDER") {
      // ✅ Charge only for shortage (negative variance). If overage, no RiderCharge.
      const rawVar = Number(row.variance ?? 0);
      const amtNum = rawVar < 0 ? Math.abs(rawVar) : 0;
      const amt = new Prisma.Decimal(amtNum.toFixed(2));

      // create OR update (idempotent) because varianceId is @unique
      if (amtNum > 0) {
        await tx.riderCharge.upsert({
          where: { varianceId: row.id },
          create: {
            varianceId: row.id,
            runId: row.runId,
            riderId: row.riderId,
            amount: amt,
            status: RiderChargeStatus.OPEN,
            note: note.length ? note : undefined,
            createdById: managerApprovedById,
          },
          update: {
            runId: row.runId,
            riderId: row.riderId,
            amount: amt,
            status: RiderChargeStatus.OPEN,
            note: note.length ? note : undefined,
            // keep createdById as-is if already set
          },
        });
      } else {
        // If previously created charge exists (old bug), waive it to avoid charging for overage.
        await tx.riderCharge.updateMany({
          where: {
            varianceId: row.id,
            status: {
              in: [RiderChargeStatus.OPEN, RiderChargeStatus.PARTIALLY_SETTLED],
            },
          },
          data: { status: RiderChargeStatus.WAIVED, settledAt: now },
        });
      }
    }

    if (resolution === "WAIVE") {
      // if a charge already exists for this variance, waive it too
      await tx.riderCharge.updateMany({
        where: {
          varianceId: row.id,
          status: {
            in: [RiderChargeStatus.OPEN, RiderChargeStatus.PARTIALLY_SETTLED],
          },
        },
        data: { status: RiderChargeStatus.WAIVED, settledAt: now },
      });
    }
  });

  return redirect("/store/rider-variances");
}

export default function StoreRiderVariancesPage() {
  const { rows, tab, counts } = useLoaderData<LoaderData>();
  const [sp] = useSearchParams();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  const tabLink = (t: "open" | "awaiting" | "history") => {
    const next = new URLSearchParams(sp);
    next.set("tab", t);
    return `?${next.toString()}`;
  };

  const isHistory = tab === "history";
  const pageTitle =
    tab === "open"
      ? "Open (needs decision)"
      : tab === "awaiting"
      ? "Waiting rider acceptance"
      : "History (cleared)";

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Rider Variances
            </h1>
            <p className="text-xs text-slate-500">
              Review shortages/overages before cashier can finalize settlement.
            </p>
          </div>
          <Link
            to="/store"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Back
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-slate-800">
                {pageTitle}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Link
                  to={tabLink("open")}
                  className={`inline-flex items-center rounded-full border px-2 py-1 ${
                    tab === "open"
                      ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Open
                  {counts.open > 0 ? (
                    <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {counts.open}
                    </span>
                  ) : null}
                </Link>
                <Link
                  to={tabLink("awaiting")}
                  className={`inline-flex items-center rounded-full border px-2 py-1 ${
                    tab === "awaiting"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Awaiting rider
                  {counts.awaiting > 0 ? (
                    <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {counts.awaiting}
                    </span>
                  ) : null}
                </Link>
                <Link
                  to={tabLink("history")}
                  className={`inline-flex items-center rounded-full border px-2 py-1 ${
                    tab === "history"
                      ? "border-slate-300 bg-slate-100 text-slate-800"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  History
                  {counts.history > 0 ? (
                    <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                      {counts.history}
                    </span>
                  ) : null}
                </Link>
              </div>
            </div>
            <div className="text-xs text-slate-500">{rows.length} item(s)</div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Run</th>
                <th className="px-3 py-2 text-left font-medium">Rider</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Expected</th>
                <th className="px-3 py-2 text-right font-medium">Actual</th>
                <th className="px-3 py-2 text-right font-medium">Variance</th>
                <th className="px-3 py-2 text-left font-medium">
                  {isHistory ? "Details" : "Decision"}
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
                    No variances to review.
                  </td>
                </tr>
              ) : (
                rows.map((v) => (
                  <tr
                    key={v.id}
                    className="border-t border-slate-100 align-top"
                  >
                    <td className="px-3 py-2">
                      <div className="font-mono text-slate-800">
                        {v.run.runCode}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        ref #{v.id}
                      </div>
                      {v.receipt ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                            AUTO · {v.receipt.kind} · {v.receipt.receiptKey}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-slate-400">
                          no receipt link
                        </div>
                      )}
                      <div className="mt-1 text-[11px] text-slate-500">
                        {new Date(v.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-3 py-2">{v.rider.name}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                        {v.status}
                      </span>
                      {v.resolution ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          resolution:{" "}
                          <span className="font-medium">{v.resolution}</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {peso(v.expected)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {peso(v.actual)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span
                        className={
                          v.variance < 0 ? "text-rose-700" : "text-emerald-700"
                        }
                      >
                        {peso(v.variance)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {isHistory ? (
                        <div className="space-y-1 text-[11px] text-slate-600">
                          <div>
                            Note:{" "}
                            <span className="font-medium">{v.note ?? "—"}</span>
                          </div>
                          <div>
                            Manager approved:{" "}
                            <span className="font-medium">
                              {v.managerApprovedAt
                                ? new Date(v.managerApprovedAt).toLocaleString()
                                : "—"}
                            </span>
                          </div>
                          <div>
                            Rider accepted:{" "}
                            <span className="font-medium">
                              {v.riderAcceptedAt
                                ? new Date(v.riderAcceptedAt).toLocaleString()
                                : "—"}
                            </span>
                          </div>
                        </div>
                      ) : tab === "awaiting" ? (
                        <div className="space-y-2">
                          <div className="text-xs text-amber-700">
                            Waiting rider acceptance
                          </div>
                          <Link
                            className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
                            to={`/rider/variance/${v.id}`}
                          >
                            View rider page →
                          </Link>
                          <div className="text-[11px] text-slate-500">
                            Note: {v.note ?? "—"}
                          </div>
                        </div>
                      ) : (
                        <>
                          <Form method="post" className="flex flex-col gap-2">
                            <input type="hidden" name="id" value={v.id} />
                            <select
                              name="resolution"
                              defaultValue={v.resolution ?? ""}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                            >
                              <option value="" disabled>
                                Select decision…
                              </option>
                              <option value="CHARGE_RIDER">
                                Charge rider (needs rider accept)
                              </option>
                              <option value="INFO_ONLY">
                                Info only (no rider accept)
                              </option>
                              <option value="WAIVE">Waive</option>
                            </select>
                            <input
                              name="note"
                              placeholder="Optional note"
                              defaultValue={v.note ?? ""}
                              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                            />
                            <button
                              type="submit"
                              name="_intent"
                              value="manager-decide"
                              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
                            >
                              Save decision
                            </button>
                          </Form>
                        </>
                      )}
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
