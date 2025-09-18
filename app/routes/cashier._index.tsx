/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useNavigation,
  useActionData,
  useRevalidator,
  useSearchParams,
} from "@remix-run/react";
import React from "react";
import { db } from "~/utils/db.server";

// Lock TTL: how long a cashier can hold an order before it becomes claimable again
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function loader() {
  const nowMs = Date.now();
  // Pull active UNPAID tickets (no expiry filter)
  const orders = await db.order.findMany({
    where: { status: "UNPAID", NOT: { isOnCredit: true } },
    orderBy: { printedAt: "desc" },
    take: 50,
    select: {
      id: true,
      orderCode: true,
      subtotal: true,
      printedAt: true,
      printCount: true,
      lockedAt: true,
      lockedBy: true,
    },
  });

  const rows = orders.map((o) => ({
    ...o,
    isLocked: !!o.lockedAt && nowMs - o.lockedAt.getTime() < LOCK_TTL_MS,
  }));

  // Active remits = DELIVERY orders not PAID yet (UNPAID or PARTIALLY_PAID)
  const remits = await db.order.findMany({
    where: {
      channel: "DELIVERY",
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
    },
    orderBy: { id: "desc" },
    take: 50,
    select: {
      id: true,
      orderCode: true,
      riderName: true,
      status: true,
      subtotal: true,
      totalBeforeDiscount: true,
      printedAt: true,
    },
  });

  return json(
    {
      rows,
      remits,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const action = String(fd.get("_action") || "");
  const id = Number(fd.get("id") || 0);

  // Cancel an UNPAID slip (safe, reversible by reprinting later if needed)
  if (action === "cancelSlip") {
    if (!id) return json({ ok: false, error: "Invalid id" }, { status: 400 });
    const reason = String(fd.get("cancelReason") || "").trim();
    if (!reason) {
      return json(
        { ok: false, error: "Reason is required to cancel a ticket." },
        { status: 400 }
      );
    }
    const ttlAgo = new Date(Date.now() - LOCK_TTL_MS);
    const updated = await db.order.updateMany({
      where: {
        id,
        status: "UNPAID",
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: ttlAgo } },
          { lockedBy: "CASHIER-01" },
        ],
      },
      data: {
        status: "CANCELLED",
        lockedAt: null,
        lockedBy: null,
        lockNote: `Cancelled at cashier: ${reason}`,
      },
    });
    if (updated.count !== 1) {
      return json(
        {
          ok: false,
          error: "Unable to cancel (already locked by another or processed).",
        },
        { status: 423 }
      );
    }
    return redirect("/cashier");
  }
  // Hard delete an accidental UNPAID slip (irreversible)
  if (action === "deleteSlip") {
    if (!id) return json({ ok: false, error: "Invalid id" }, { status: 400 });
    try {
      await db.$transaction(async (tx) => {
        const o = await tx.order.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!o || o.status !== "UNPAID") {
          throw new Error("Only UNPAID slips can be deleted.");
        }
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.payment.deleteMany({ where: { orderId: id } }).catch(() => {});
        await tx.order.delete({ where: { id } });
      });
      return redirect("/cashier");
    } catch (e: any) {
      return json(
        { ok: false, error: e.message || "Delete failed" },
        { status: 400 }
      );
    }
  }

  if (action === "openByCode") {
    const code = String(fd.get("code") || "").trim();
    if (!code)
      return json({ ok: false, error: "Enter a code" }, { status: 400 });

    // 1) Atomically claim the lock by orderCode
    const claimed = await db.order.updateMany({
      where: {
        orderCode: code,
        status: "UNPAID",
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } }, // expired lock
        ],
      },
      data: { lockedAt: new Date(), lockedBy: "CASHIER-01" },
    });
    if (claimed.count !== 1) {
      // Could be wrong code or already locked by someone else within TTL
      const existing = await db.order.findFirst({
        where: { orderCode: code, status: "UNPAID" },
        select: { lockedBy: true, lockedAt: true },
      });
      if (!existing) {
        return json(
          { ok: false, error: "No UNPAID order with that code" },
          { status: 404 }
        );
      }
      return json(
        {
          ok: false,
          error: existing.lockedBy
            ? `Locked by ${existing.lockedBy}`
            : "Unable to lock order",
        },
        { status: 423 }
      );
    }
    // 2) Fetch id to redirect (separate read to keep claim atomic)
    const order = await db.order.findFirst({
      where: { orderCode: code, status: "UNPAID" },
      select: { id: true },
    });

    if (!order) {
      return json(
        { ok: false, error: "Locked but not found. Please retry." },
        { status: 500 }
      );
    }
    return redirect(`/cashier/${order.id}`);
  }

  if (action === "openById") {
    const id = Number(fd.get("id") || 0);
    if (!id) return json({ ok: false, error: "Invalid id" }, { status: 400 });
    const claimed = await db.order.updateMany({
      where: {
        id,
        status: "UNPAID",
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } },
        ],
      },
      data: { lockedAt: new Date(), lockedBy: "CASHIER-01" },
    });
    if (claimed.count !== 1) {
      const existing = await db.order.findUnique({
        where: { id },
        select: { lockedBy: true, lockedAt: true, status: true },
      });
      return json(
        {
          ok: false,
          error:
            existing?.status !== "UNPAID"
              ? "Order is not UNPAID"
              : existing?.lockedBy
              ? `Locked by ${existing.lockedBy}`
              : "Unable to lock order",
        },
        { status: 423 }
      );
    }
    return redirect(`/cashier/${id}`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CashierQueue() {
  const { rows, remits } = useLoaderData<typeof loader>() as any;
  const nav = useNavigation();
  const actionData = useActionData<typeof action>();

  const revalidator = useRevalidator();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "remits" ? "remits" : "tickets";

  // Revalidate on focus + every 5s while visible
  React.useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    };
    document.addEventListener("visibilitychange", onVis);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") revalidator.revalidate();
    }, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(id);
    };
  }, [revalidator]);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-5 py-4">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Cashier Queue
          </h1>

          {/* Tabs */}
          <div className="mt-3 inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
            <button
              className={`px-3 py-1.5 ${
                tab === "tickets"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => {
                sp.set("tab", "tickets");
                setSp(sp, { replace: true });
              }}
            >
              Active Tickets
            </button>
            <button
              className={`px-3 py-1.5 border-l border-slate-200 ${
                tab === "remits"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => {
                sp.set("tab", "remits");
                setSp(sp, { replace: true });
              }}
            >
              Active Remits
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-5 py-6">
        {/* Open by code (tickets tab) */}
        {tab === "tickets" && (
          <Form method="post" className="mb-5">
            <div className="flex items-center gap-2">
              <input
                name="code"
                placeholder="Scan or type Order Code"
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                autoFocus
              />
              <input type="hidden" name="_action" value="openByCode" />
              <button
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 active:shadow-none disabled:opacity-60"
                disabled={nav.state !== "idle"}
              >
                Open
              </button>
            </div>
          </Form>
        )}

        {actionData && "error" in actionData && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {actionData.error}
          </div>
        )}

        {/* Lists */}
        {tab === "tickets" ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-medium tracking-wide text-slate-700">
                Active tickets
              </h2>
              <span className="text-[11px] text-slate-500">
                {rows.length} item(s)
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {rows.map((r) => {
                return (
                  <div key={r.id} className="px-4 py-3 hover:bg-slate-50/60">
                    <div className="flex items-start justify-between gap-2">
                      {/* Open */}
                      <Form method="post" className="flex-1">
                        <input type="hidden" name="_action" value="openById" />
                        <input type="hidden" name="id" value={r.id} />
                        <button
                          type="submit"
                          className="w-full text-left disabled:opacity-60"
                          disabled={r.isLocked}
                          title={
                            r.isLocked
                              ? `Locked by ${r.lockedBy ?? "someone"}`
                              : ""
                          }
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-mono text-slate-700">
                              {r.orderCode}
                            </div>
                            <div className="text-sm">
                              {r.isLocked && (
                                <span className="mr-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                                  LOCKED
                                </span>
                              )}
                              <span className="text-slate-600">
                                Ticket #{r.printCount}
                              </span>
                            </div>
                          </div>
                          <div className="text-xs text-slate-500">
                            Printed {new Date(r.printedAt).toLocaleString()}
                          </div>
                        </button>
                      </Form>

                      {/* Actions: Cancel / Delete */}
                      <div className="flex shrink-0 items-center gap-2">
                        <Form
                          method="post"
                          onSubmit={(e) => {
                            const reason = prompt(
                              "Reason for cancelling this ticket?"
                            );
                            if (!reason) {
                              e.preventDefault();
                              return;
                            }
                            const input = document.createElement("input");
                            input.type = "hidden";
                            input.name = "cancelReason";
                            input.value = reason;
                            e.currentTarget.appendChild(input);
                          }}
                        >
                          <input
                            type="hidden"
                            name="_action"
                            value="cancelSlip"
                          />
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="inline-flex items-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            disabled={r.isLocked}
                            title="Cancel this ticket (moves to CANCELLED; auto-purges later)"
                          >
                            Cancel
                          </button>
                        </Form>

                        <Form
                          method="post"
                          onSubmit={(e) => {
                            if (
                              !confirm(
                                `Delete ticket ${r.orderCode}? This cannot be undone.`
                              )
                            ) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input
                            type="hidden"
                            name="_action"
                            value="deleteSlip"
                          />
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="inline-flex items-center rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                            disabled={r.isLocked}
                            title="Permanently delete this UNPAID ticket"
                          >
                            Delete
                          </button>
                        </Form>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // Active Remits tab
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-medium tracking-wide text-slate-700">
                Active remits (Delivery, not yet PAID)
              </h2>
              <span className="text-[11px] text-slate-500">
                {remits.length} item(s)
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {remits.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-600">
                  Nothing here.
                </div>
              ) : (
                remits.map((r: any) => (
                  <div key={r.id} className="px-4 py-3 hover:bg-slate-50/60">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-mono text-slate-700">
                          {r.orderCode}
                        </div>
                        <div className="text-xs text-slate-500">
                          Rider: {r.riderName || "—"} • Status: {r.status} •
                          Printed {new Date(r.printedAt).toLocaleString()}
                        </div>
                      </div>
                      <a
                        href={`/remit/${r.id}`}
                        className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                      >
                        Open Remit
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
