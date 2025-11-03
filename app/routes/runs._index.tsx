/* eslint-disable @typescript-eslint/no-explicit-any */
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";

import { db } from "~/utils/db.server";

type Row = {
  id: number;
  runCode: string;
  status: "PLANNED" | "DISPATCHED" | "CLOSED" | "CANCELLED";
  riderLabel: string | null;
  createdAt: string;
  dispatchedAt: string | null;
};

export async function loader() {
  const runs = await db.deliveryRun.findMany({
    select: {
      id: true,
      runCode: true,
      status: true,
      riderId: true,
      createdAt: true,
      dispatchedAt: true,
    },
    orderBy: { id: "desc" },
    take: 50,
  });
  const riderIds = Array.from(
    new Set(runs.map((r) => r.riderId).filter(Boolean))
  ) as number[];
  const riders = riderIds.length
    ? await db.employee.findMany({
        where: { id: { in: riderIds } },
        select: { id: true, firstName: true, lastName: true, alias: true },
      })
    : [];
  const map = new Map<number, string>();
  for (const r of riders) {
    const label = (r.alias?.trim() ||
      [r.firstName, r.lastName].filter(Boolean).join(" ") ||
      `#${r.id}`)!;
    map.set(r.id, label);
  }
  const rows: Row[] = runs.map((r) => ({
    id: r.id,
    runCode: r.runCode,
    status: r.status as any,
    riderLabel: r.riderId ? map.get(r.riderId) ?? null : null,
    createdAt: r.createdAt.toISOString(),
    dispatchedAt: r.dispatchedAt ? r.dispatchedAt.toISOString() : null,
  }));
  return json({ rows });
}

export default function RunsIndexPage() {
  const { rows } = useLoaderData<typeof loader>();
  const nextHref = (r: Row) =>
    r.status === "PLANNED"
      ? `/runs/${r.id}/dispatch`
      : r.status === "DISPATCHED"
      ? `/runs/${r.id}/remit`
      : `/runs/${r.id}/summary`;
  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <div className="mx-auto max-w-5xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Runs</h1>
          <Link
            to="/runs/new"
            className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm"
          >
            + New Run
          </Link>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Run</th>
                <th className="px-3 py-2 text-left font-medium">Rider</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
                <th className="px-3 py-2 text-left font-medium">Dispatched</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-4 text-center text-slate-500"
                  >
                    No runs yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono">{r.runCode}</td>
                    <td className="px-3 py-2">{r.riderLabel ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs">
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.dispatchedAt
                        ? new Date(r.dispatchedAt).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={nextHref(r)}
                        className="text-indigo-600 hover:underline"
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
