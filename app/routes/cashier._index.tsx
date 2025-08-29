import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useNavigation,
  useActionData,
  useRevalidator,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";

// Lock TTL: how long a cashier can hold an order before it becomes claimable again
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
      lockNote: "Auto-cancel: slip expired",
    },
  });

  // ── 2) Purge CANCELLED older than 24h ──────────────────────────────────────
  const purgeCutoff = new Date(nowMs - 24 * 60 * 60 * 1000);
  const doomed = await db.order.findMany({
    where: { status: "CANCELLED", updatedAt: { lt: purgeCutoff } },
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

  const orders = await db.order.findMany({
    // Only show active UNPAID that haven't expired
    where: { status: "UNPAID", expiryAt: { gte: new Date(now) } },
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

  const rows = orders.map((o) => ({
    ...o,
    isExpired: o.expiryAt.getTime() < nowMs,
    isLocked: !!o.lockedAt && nowMs - o.lockedAt.getTime() < LOCK_TTL_MS,
  }));
  return json(
    {
      rows,
      autoCancelledCount: autoCancel.count,
      purgedCancelledCount,
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
        lockNote: "Cancelled at cashier",
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
  const { rows, autoCancelledCount, purgedCancelledCount } = useLoaderData<
    typeof loader
  >() as any;

  const nav = useNavigation();
  const actionData = useActionData<typeof action>();

  const revalidator = useRevalidator();

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
    <main className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Cashier Queue</h1>
      {(autoCancelledCount > 0 || purgedCancelledCount > 0) && (
        <div className="mb-3 text-xs rounded border border-amber-200 bg-amber-50 text-amber-800 px-2 py-1">
          {autoCancelledCount > 0 ? (
            <>
              Auto-cancelled {autoCancelledCount} expired slip
              {autoCancelledCount === 1 ? "" : "s"}.
            </>
          ) : null}
          {autoCancelledCount > 0 && purgedCancelledCount > 0 ? " " : null}
          {purgedCancelledCount > 0 ? (
            <>Purged {purgedCancelledCount} CANCELLED older than 24h.</>
          ) : null}
        </div>
      )}
      <Form method="post" className="flex gap-2 mb-4">
        <input
          name="code"
          placeholder="Scan or type Order Code"
          className="border rounded px-3 py-2 flex-1"
          autoFocus
        />
        <input type="hidden" name="_action" value="openByCode" />
        <button
          className="px-3 py-2 rounded bg-black text-white"
          disabled={nav.state !== "idle"}
        >
          Open
        </button>
      </Form>
      {actionData && "error" in actionData && (
        <div className="text-sm text-red-600 mb-2">{actionData.error}</div>
      )}
      <div className="divide-y border rounded">
        {rows.map((r) => (
          <div key={r.id} className="px-3 py-2 hover:bg-gray-50">
            <div className="flex items-start justify-between gap-2">
              {/* Open */}
              <Form method="post" className="flex-1">
                <input type="hidden" name="_action" value="openById" />
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  className="text-left w-full disabled:opacity-60"
                  disabled={r.isLocked}
                  title={
                    r.isLocked ? `Locked by ${r.lockedBy ?? "someone"}` : ""
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-slate-600">
                      {r.orderCode}
                    </div>
                    <div className="text-sm">
                      {r.isExpired && (
                        <span className="text-red-600 mr-2">EXPIRED</span>
                      )}
                      {r.isLocked && (
                        <span className="text-amber-600 mr-2">LOCKED</span>
                      )}
                      <span className="text-gray-600">
                        Slip #{r.printCount}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-600">
                    Printed {new Date(r.printedAt).toLocaleString()}
                  </div>
                </button>
              </Form>

              {/* Actions: Cancel / Delete */}
              <div className="shrink-0 flex items-center gap-2">
                <Form method="post">
                  <input type="hidden" name="_action" value="cancelSlip" />
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
                    disabled={r.isLocked}
                    title="Cancel this slip (moves to CANCELLED; auto-purges later)"
                  >
                    Cancel
                  </button>
                </Form>
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        `Delete slip ${r.orderCode}? This cannot be undone.`
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="_action" value="deleteSlip" />
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50"
                    disabled={r.isLocked}
                    title="Permanently delete this UNPAID slip"
                  >
                    Delete
                  </button>
                </Form>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
