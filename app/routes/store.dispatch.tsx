/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Store Manager (or Admin) lang ang pwede dito
  await requireRole(request, ["STORE_MANAGER", "ADMIN"] as any);

  const forDispatch = await db.order.findMany({
    where: {
      channel: "DELIVERY",
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dispatchedAt: null,
    },
    orderBy: [{ id: "desc" }],
    take: 50,
    select: {
      id: true,
      orderCode: true,
      riderName: true,
      stagedAt: true,
      dispatchedAt: true,
      fulfillmentStatus: true,
      subtotal: true,
      totalBeforeDiscount: true,
      printedAt: true,
    },
  });

  return json({ forDispatch });
}

export default function StoreDispatchQueuePage() {
  const { forDispatch } = useLoaderData<typeof loader>() as any;

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Delivery Dispatch Queue
            </h1>
            <p className="text-xs text-slate-500">
              Orders from pad-order marked as DELIVERY and not yet dispatched.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/runs/new"
              className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
            >
              + New Run
            </Link>
            <Link
              to="/store"
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              ← Back to Store Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-medium tracking-wide text-slate-700">
              For Dispatch (Delivery)
            </h2>
            <span className="text-[11px] text-slate-500">
              {forDispatch.length} item(s)
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {forDispatch.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-600">
                Nothing to dispatch right now.
              </div>
            ) : (
              forDispatch.map((r: any) => (
                <div key={r.id} className="px-4 py-3 hover:bg-slate-50/60">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-slate-700">
                        {r.orderCode}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Rider: {r.riderName || "—"} • Status:{" "}
                        {r.fulfillmentStatus || "—"}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Printed{" "}
                        {r.printedAt
                          ? new Date(r.printedAt).toLocaleString()
                          : "—"}
                      </div>
                    </div>

                    <Link
                      to={`/orders/${r.id}/dispatch`}
                      className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                      title="Open Dispatch Staging"
                    >
                      Open Dispatch
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
