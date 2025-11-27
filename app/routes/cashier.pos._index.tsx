/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useLoaderData,
  useNavigation,
  useActionData,
  useRevalidator,
  useSearchParams,
} from "@remix-run/react";
import React from "react";
import { db } from "~/utils/db.server";
import { requireRole, requireOpenShift } from "~/utils/auth.server";

// Lock TTL: how long a cashier can hold an order before it becomes claimable again
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["CASHIER", "ADMIN"]);
  // If other pages bounced us here to request opening a shift, send user to shift console
  const url = new URL(request.url);
  if (url.searchParams.get("openShift") === "1") {
    return redirect("/cashier/shift?open=1");
  }

  const nowMs = Date.now();
  // PICKUP tickets (cashier flow only)
  const pickupsRaw = await db.order.findMany({
    where: {
      channel: "PICKUP",
      status: "UNPAID",
      NOT: { isOnCredit: true },
    },
    // printedAt can be null; add tie-breaker
    orderBy: [{ printedAt: "desc" }, { id: "desc" }],
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
  const pickups = pickupsRaw.map((o) => {
    const locked = !!o.lockedAt && nowMs - o.lockedAt.getTime() < LOCK_TTL_MS;
    const lockExpiresAtMs = locked ? o.lockedAt!.getTime() + LOCK_TTL_MS : null;
    const lockRemainingSec = lockExpiresAtMs
      ? Math.max(0, Math.ceil((lockExpiresAtMs - nowMs) / 1000))
      : 0;
    return {
      ...o,
      isLocked: locked,
      lockRemainingSec,
    };
  });

  // FOR DISPATCH: delivery orders not yet dispatched (staging or new)
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

  return json(
    { pickups, forDispatch },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  // 🔒 Enforce open shift for CASHIER actions (ADMIN bypasses inside helper)
  // 🔒 Enforce open shift for CASHIER actions (ADMIN bypass handled inside helper)
  await requireOpenShift(request);
  const fd = await request.formData();
  const action = String(fd.get("_action") || "");
  const id = Number(fd.get("id") || 0);
  // Prefer form value → header → default
  const terminalId =
    String(fd.get("terminalId") || "") ||
    request.headers.get("x-terminal-id") ||
    "CASHIER-01";

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
          { lockedBy: terminalId },
        ],
      },
      data: { status: "CANCELLED", lockedAt: null, lockedBy: null },
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

    // At this point, requireOpenShift already guaranteed a valid open shift or redirected.

    // Peek order to decide flow (PICKUP → cashier, DELIVERY → dispatch)
    const found = await db.order.findFirst({
      where: { orderCode: code, status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      select: {
        id: true,
        channel: true,
        lockedAt: true,
        lockedBy: true,
        status: true,
      },
    });
    if (!found) {
      return json(
        { ok: false, error: "No UNPAID order with that code" },
        { status: 404 }
      );
    }
    // DELIVERY: go straight to Dispatch Staging (no cashier lock needed)
    if (found.channel === "DELIVERY") {
      return redirect(`/orders/${found.id}/dispatch`);
    }

    // PICKUP: atomically claim the lock by orderCode
    const claimed = await db.order.updateMany({
      where: {
        id: found.id,
        status: "UNPAID",
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } }, // expired lock
          // ✅ allow idempotent re-open by the same terminal
          { lockedBy: terminalId },
        ],
      },
      data: { lockedAt: new Date(), lockedBy: terminalId },
    });
    if (claimed.count !== 1) {
      return json(
        {
          ok: false,
          error: found.lockedBy
            ? `Locked by ${found.lockedBy}`
            : "Unable to lock order",
        },
        { status: 423 }
      );
    }

    return redirect(`/cashier/${found.id}`);
  }

  if (action === "openById") {
    const id = Number(fd.get("id") || 0);
    if (!id) return json({ ok: false, error: "Invalid id" }, { status: 400 });

    // Peek channel to decide flow
    const existing = await db.order.findUnique({
      where: { id },
      select: { status: true, channel: true, lockedBy: true, lockedAt: true },
    });
    if (!existing)
      return json({ ok: false, error: "Order not found" }, { status: 404 });
    // DELIVERY: go to Dispatch if not PAID
    if (existing.channel === "DELIVERY") {
      if (existing.status === "PAID") {
        return json(
          { ok: false, error: "Order already PAID" },
          { status: 400 }
        );
      }
      return redirect(`/orders/${id}/dispatch`);
    }
    // PICKUP must be UNPAID to open at cashier
    if (existing.status !== "UNPAID") {
      return json({ ok: false, error: "Order is not UNPAID" }, { status: 400 });
    }
    const claimed = await db.order.updateMany({
      where: {
        id,
        status: "UNPAID",
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } },
          // ✅ allow idempotent re-open by the same terminal
          { lockedBy: terminalId },
        ],
      },
      data: { lockedAt: new Date(), lockedBy: terminalId },
    });
    if (claimed.count !== 1) {
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

    return redirect(`/cashier/${id}`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CashierQueue() {
  const { pickups, forDispatch } = useLoaderData<typeof loader>() as any;
  // TODO: make this configurable (e.g., localStorage). For now keep consistent with headers/hidden input.
  const MY_TERMINAL = "CASHIER-01";
  const nav = useNavigation();
  const actionData = useActionData<typeof action>();

  const revalidator = useRevalidator();
  const [sp, setSp] = useSearchParams();
  const tabParam = sp.get("tab");
  const tab: "pickup" | "dispatch" =
    tabParam === "dispatch" ? "dispatch" : "pickup";
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
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Cashier Queue
            </h1>
            <div className="flex items-center gap-2">
              <Link
                to="/cashier"
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                ← Dashboard
              </Link>
              <Link
                to="/pad-order"
                className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
              >
                Add to cart (Order Pad)
              </Link>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-3 inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
            <button
              className={`px-3 py-1.5 ${
                tab === "pickup"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => {
                sp.set("tab", "pickup");
                setSp(sp, { replace: true });
              }}
            >
              Pickup
            </button>
            <button
              className={`px-3 py-1.5 border-l border-slate-200 ${
                tab === "dispatch"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => {
                sp.set("tab", "dispatch");
                setSp(sp, { replace: true });
              }}
            >
              For Dispatch
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-5 py-6">
        {/* Open by code (pickup tab only) */}
        {tab === "pickup" && (
          <Form method="post" className="mb-5">
            <div className="flex items-center gap-2">
              <input
                name="code"
                placeholder="Scan or type Order Code"
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder-slate-400 outline-none ring-0 transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                autoFocus
              />
              <input type="hidden" name="_action" value="openByCode" />
              <input type="hidden" name="terminalId" value={MY_TERMINAL} />
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
        {tab === "pickup" ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-medium tracking-wide text-slate-700">
                Pickup tickets
              </h2>
              <span className="text-[11px] text-slate-500">
                {pickups.length} item(s)
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {pickups.map((r) => {
                return (
                  <div key={r.id} className="px-4 py-3 hover:bg-slate-50/60">
                    <div className="flex items-start justify-between gap-2">
                      {/* Open */}
                      <Form method="post" className="flex-1">
                        <input type="hidden" name="_action" value="openById" />
                        <input type="hidden" name="id" value={r.id} />
                        <input
                          type="hidden"
                          name="terminalId"
                          value={MY_TERMINAL}
                        />
                        <button
                          type="submit"
                          className="w-full text-left disabled:opacity-60"
                          disabled={r.isLocked && r.lockedBy !== MY_TERMINAL}
                          title={
                            r.isLocked
                              ? r.lockedBy === MY_TERMINAL
                                ? "Locked by YOU (re-open allowed)"
                                : `Locked by ${r.lockedBy ?? "someone"}`
                              : "Open at cashier"
                          }
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-mono text-slate-700">
                              {r.orderCode}
                            </div>
                            <div className="text-sm">
                              {r.isLocked ? (
                                <span
                                  className="mr-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"
                                  title={
                                    r.lockedBy === MY_TERMINAL
                                      ? "You are holding this lock"
                                      : "Held by another cashier"
                                  }
                                >
                                  {r.lockedBy === MY_TERMINAL
                                    ? "LOCKED (you)"
                                    : "LOCKED"}{" "}
                                  · {r.lockRemainingSec}s
                                </span>
                              ) : null}
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
                          <input
                            type="hidden"
                            name="terminalId"
                            value={MY_TERMINAL}
                          />
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
                          <input
                            type="hidden"
                            name="terminalId"
                            value={MY_TERMINAL}
                          />
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
          // FOR DISPATCH tab (Delivery)
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
                  Nothing here.
                </div>
              ) : (
                forDispatch.map((r: any) => (
                  <div key={r.id} className="px-4 py-3 hover:bg-slate-50/60">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-slate-700">
                          {r.orderCode}
                        </div>
                        <div className="text-xs text-slate-500">
                          Rider: {r.riderName || "—"} • Status:{" "}
                          {r.fulfillmentStatus || "—"} • Printed{" "}
                          {new Date(r.printedAt).toLocaleString()}
                        </div>
                      </div>
                      <a
                        href={`/orders/${r.id}/dispatch`}
                        className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                        title={
                          r.fulfillmentStatus === "DISPATCHED"
                            ? "Already dispatched"
                            : "Open Dispatch Staging"
                        }
                      >
                        {r.fulfillmentStatus === "DISPATCHED"
                          ? "Dispatched"
                          : "Open Dispatch"}
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
