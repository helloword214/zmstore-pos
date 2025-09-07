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

// Ticket validity for reprints
const TICKET_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Format milliseconds → "m:ss"
function toMMSS(ms: number): string {
  if (!Number.isFinite(ms) || ms === Infinity) return "";
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

export async function loader() {
  // ── Auto-cancel expired UNPAID slips (unlocked or stale-locked) ─────────────
  // ── 1) Auto-cancel expired UNPAID (unlocked or stale-locked) ───────────────
  const nowMs = Date.now();
  const now = new Date(nowMs);
  const cancelableLockBefore = new Date(nowMs - LOCK_TTL_MS);
  const autoCancel = await db.order.updateMany({
    where: {
      status: "UNPAID",
      expiryAt: { lt: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: cancelableLockBefore } }],
    },
    data: {
      status: "CANCELLED",
      lockedAt: null,
      lockedBy: null,
      lockNote: "Auto-cancel: ticket expired",
    },
  });

  // ── 2) Purge CANCELLED older than 24h (no reliance on updatedAt) ──────────
  const purgeCutoff = new Date(nowMs - 24 * 60 * 60 * 1000);
  // If your schema has updatedAt: prefer `updatedAt: { lt: purgeCutoff }`.
  // Here we fall back to printedAt/expiryAt for age signal.
  const doomed = await db.order.findMany({
    where: {
      status: "CANCELLED",
      OR: [
        { printedAt: { lt: purgeCutoff } },
        { expiryAt: { lt: purgeCutoff } },
      ],
    },
    select: { id: true },
  });

  const doomedIds = doomed.map((o) => o.id);
  let purgedCancelledCount = 0;
  if (doomedIds.length) {
    await db.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: { in: doomedIds } } });
      await tx.payment
        .deleteMany({ where: { orderId: { in: doomedIds } } })
        .catch(() => {});
      await tx.order.deleteMany({ where: { id: { in: doomedIds } } });
    });
    purgedCancelledCount = doomedIds.length;
  }

  // Pull recent UNPAID tickets (some may have null expiryAt)
  const orders = await db.order.findMany({
    where: { status: "UNPAID", NOT: { isOnCredit: true } },
    orderBy: { printedAt: "desc" },
    take: 50,
    select: {
      id: true,
      orderCode: true,
      subtotal: true,
      printedAt: true,
      expiryAt: true,
      printCount: true,
      lockedAt: true,
      lockedBy: true,
    },
  });

  const rowsAll = orders.map((o) => {
    const expMs = o.expiryAt ? o.expiryAt.getTime() : Infinity; // treat null as non-expiring
    return {
      ...o,
      isExpired: expMs < nowMs,
      isLocked: !!o.lockedAt && nowMs - o.lockedAt.getTime() < LOCK_TTL_MS,
    };
  });
  // Only show active (not expired) tickets in the queue
  const rows = rowsAll.filter((r) => !r.isExpired);

  // Recently auto-cancelled (last 60 minutes; identified by lockNote)
  const expiredWindow = new Date(nowMs - 60 * 60 * 1000);
  const recentlyExpired = await db.order.findMany({
    where: {
      status: "CANCELLED",
      lockNote: { startsWith: "Auto-cancel:" },
      // show only fairly recent ones to avoid clutter
      OR: [
        { expiryAt: { gte: expiredWindow } },
        { printedAt: { gte: expiredWindow } },
      ],
    },
    orderBy: { expiryAt: "desc" },
    take: 50,
    select: {
      id: true,
      orderCode: true,
      subtotal: true,
      printedAt: true,
      expiryAt: true,
      printCount: true,
      lockNote: true,
    },
  });

  return json(
    {
      rows,
      autoCancelledCount: autoCancel.count,
      purgedCancelledCount,
      recentlyExpired,
      ticketTtlMs: TICKET_TTL_MS,
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
  // Reprint (revive) a recently CANCELLED slip back to UNPAID and open slip print
  if (action === "reprintCancelled") {
    if (!id) return json({ ok: false, error: "Invalid id" }, { status: 400 });
    const now = new Date();
    const expiryAt = new Date(Date.now() + TICKET_TTL_MS);
    // Only allow if still CANCELLED (hasn't been turned into an order another way)
    const updated = await db.order.updateMany({
      where: { id, status: "CANCELLED" },
      data: {
        status: "UNPAID",
        lockedAt: null,
        lockedBy: null,
        lockNote: "Reprinted by cashier",
        printCount: { increment: 1 },
        printedAt: now,
        expiryAt,
      },
    });
    if (updated.count !== 1) {
      return json(
        { ok: false, error: "Unable to reprint this ticket." },
        { status: 400 }
      );
    }
    // Send straight to slip page for auto-print
    return redirect(`/orders/${id}/slip?autoprint=1&autoback=1`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CashierQueue() {
  const { rows, autoCancelledCount, purgedCancelledCount, recentlyExpired } =
    useLoaderData<typeof loader>() as any;

  const nav = useNavigation();
  const actionData = useActionData<typeof action>();

  const revalidator = useRevalidator();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "expired" ? "expired" : "active";

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

  // Live clock to update per-row expiry countdowns
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-4xl px-5 py-4">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Cashier Queue
          </h1>
          {(autoCancelledCount > 0 || purgedCancelledCount > 0) && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800">
              {autoCancelledCount > 0 ? (
                <>
                  Auto-cancelled {autoCancelledCount} expired ticket
                  {autoCancelledCount === 1 ? "" : "s"}.
                </>
              ) : null}
              {autoCancelledCount > 0 && purgedCancelledCount > 0 ? (
                <span>•</span>
              ) : null}
              {purgedCancelledCount > 0 ? (
                <>Purged {purgedCancelledCount} CANCELLED &gt;24h.</>
              ) : null}
            </div>
          )}

          {/* Tabs */}
          <div className="mt-3 inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
            <button
              className={`px-3 py-1.5 ${
                tab === "active"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => {
                sp.set("tab", "active");
                setSp(sp, { replace: true });
              }}
            >
              Active
            </button>
            <button
              className={`px-3 py-1.5 border-l border-slate-200 ${
                tab === "expired"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => {
                sp.set("tab", "expired");
                setSp(sp, { replace: true });
              }}
            >
              Recently Expired
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-5 py-6">
        {/* Open by code (only show on Active tab) */}
        {tab === "active" && (
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
        {tab === "active" ? (
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
                const expMs = r.expiryAt
                  ? new Date(r.expiryAt).getTime()
                  : Infinity;
                const leftMs = expMs - nowMs;
                const isExpiredLive = Number.isFinite(expMs) && leftMs <= 0;
                const isExpiringSoon =
                  Number.isFinite(expMs) && leftMs > 0 && leftMs <= 60_000;
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
                          disabled={r.isLocked || isExpiredLive}
                          title={
                            r.isLocked
                              ? `Locked by ${r.lockedBy ?? "someone"}`
                              : isExpiredLive
                              ? "Expired"
                              : ""
                          }
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-mono text-slate-700">
                              {r.orderCode}
                            </div>
                            <div className="text-sm">
                              {Number.isFinite(expMs) && (
                                <span
                                  className={
                                    "mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 " +
                                    (isExpiredLive
                                      ? "bg-red-50 text-red-700 ring-red-200"
                                      : isExpiringSoon
                                      ? "bg-amber-50 text-amber-700 ring-amber-200"
                                      : "bg-slate-50 text-slate-700 ring-slate-200")
                                  }
                                >
                                  {isExpiredLive
                                    ? "EXPIRED"
                                    : `Expires ${toMMSS(leftMs)}`}
                                </span>
                              )}
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
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-medium tracking-wide text-slate-700">
                Recently auto-cancelled (last 60 min)
              </h2>
              <span className="text-[11px] text-slate-500">
                {recentlyExpired.length} item(s)
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {recentlyExpired.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-600">
                  Nothing here. Fresh!
                </div>
              ) : (
                recentlyExpired.map((r: any) => (
                  <div key={r.id} className="px-4 py-3 hover:bg-slate-50/60">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="font-mono text-slate-700">
                            {r.orderCode}
                          </div>
                          <div className="text-sm text-slate-600">
                            <span className="mr-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200">
                              CANCELLED
                            </span>
                            <span className="text-slate-600">
                              Ticket #{r.printCount}
                            </span>
                          </div>
                        </div>
                        <div className="text-xs text-slate-500">
                          Printed {new Date(r.printedAt).toLocaleString()}
                          {r.expiryAt
                            ? ` • Expired ${new Date(
                                r.expiryAt
                              ).toLocaleString()}`
                            : ""}
                          {r.lockNote ? ` • ${r.lockNote}` : ""}
                        </div>
                      </div>
                      <Form method="post" className="shrink-0">
                        <input
                          type="hidden"
                          name="_action"
                          value="reprintCancelled"
                        />
                        <input type="hidden" name="id" value={r.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700"
                          title="Revive this ticket and print again"
                        >
                          Reprint
                        </button>
                      </Form>
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
