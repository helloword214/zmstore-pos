/* app/routes/rider.variances.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import type { EmployeeRole } from "@prisma/client";

type LoaderData = {
  user: { name: string; alias: string | null; email: string | null };
  pending: Array<{
    id: number;
    createdAt: string;
    expected: number;
    actual: number;
    variance: number;
    note: string | null;
    run: { id: number; runCode: string };
  }>;
};

const r2 = (n: number) =>
  Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export async function loader({ request }: LoaderFunctionArgs) {
  const me = await requireRole(request, ["EMPLOYEE"]);

  const uid = Number((me as any).userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Response("Invalid user session", { status: 401 });
  }

  const userRow = await db.user.findUnique({
    where: { id: uid },
    include: { employee: true },
  });
  if (!userRow) throw new Response("User not found", { status: 404 });

  const emp = userRow.employee;
  if (!emp) throw new Response("Employee profile not linked", { status: 403 });
  if ((emp.role as EmployeeRole) !== "RIDER")
    throw new Response("Rider access only", { status: 403 });

  const pending = await db.riderRunVariance.findMany({
    where: {
      riderId: emp.id,
      status: "MANAGER_APPROVED",
      resolution: "CHARGE_RIDER",
      riderAcceptedAt: null,
      // ✅ Charge rider accept list must be shortage-only
      variance: { lt: 0 },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expected: true,
      actual: true,
      variance: true,
      note: true,
      run: { select: { id: true, runCode: true } },
    },
  });

  const fullName =
    emp && (emp.firstName || emp.lastName)
      ? `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim()
      : userRow.email ?? "";

  return json<LoaderData>({
    user: {
      name: fullName,
      alias: emp.alias ?? null,
      email: userRow.email ?? null,
    },
    pending: pending.map((v) => ({
      id: v.id,
      createdAt: v.createdAt.toISOString(),
      expected: r2(Number(v.expected ?? 0)),
      actual: r2(Number(v.actual ?? 0)),
      variance: r2(Number(v.variance ?? 0)),
      note: v.note ?? null,
      run: { id: v.run.id, runCode: v.run.runCode },
    })),
  });
}

export default function RiderVariancesListPage() {
  const { user, pending } = useLoaderData<LoaderData>();

  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Pending Variances
            </h1>
            <p className="text-xs text-slate-500">
              {user.alias ? `${user.alias} (${user.name})` : user.name}
              {user.email ? ` · ${user.email}` : ""}
            </p>
          </div>
          <Link
            to="/rider"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Back
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-4">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <div className="text-sm font-medium text-slate-800">
              Needs your acceptance (Charge rider)
            </div>
            <div className="text-xs text-slate-500">
              {pending.length} item(s)
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Run</th>
                <th className="px-3 py-2 text-right font-medium">Variance</th>
                <th className="px-3 py-2 text-left font-medium">Note</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    No pending acceptances.
                  </td>
                </tr>
              ) : (
                pending.map((v) => (
                  <tr key={v.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-mono text-slate-800">
                        {v.run.runCode}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        ref #{v.id}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="text-rose-700">
                        {peso(Math.abs(v.variance))}{" "}
                        <span className="ml-1 text-[11px] text-rose-600">
                          SHORT
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {v.note ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/rider/variance/${v.id}`}
                        className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                      >
                        Open
                      </Link>
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
