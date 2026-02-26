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
} from "@remix-run/react";
import React from "react";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import {
  SoTTable,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
  SoTTh,
  SoTTd,
} from "~/components/ui/SoTTable";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";
import { assertActiveShiftWritable } from "~/utils/shiftGuards.server";

// Lock TTL: how long a cashier can hold an order before it becomes claimable again
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function loader({ request }: LoaderFunctionArgs) {
  // ✅ use same identity source as action (prevents "locked by you" mismatch)
  const me = await requireOpenShift(request);
  // ✅ HARD GUARD: block queue access if shift is LOCKED (count submitted)
  await assertActiveShiftWritable({ request, next: "/cashier/pos" });

  // 🔒 Follow delivery lock format: lockedBy = userId (string)
  const meId = String(me.userId);

  const nowMs = Date.now();
  // ✅ WALK-IN / PICKUP tickets only (cashier queue is for walk-in flow)
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

  return json({ pickups, meId }, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  // 🔒 Enforce open shift for CASHIER actions (ADMIN bypasses inside helper)
  // ✅ always define me first (we use me.userId for locking)
  const me = await requireOpenShift(request);
  // ✅ HARD GUARD: block if shift is locked (count submitted)
  await assertActiveShiftWritable({ request, next: "/cashier/pos" });
  const fd = await request.formData();
  const action = String(fd.get("_action") || "");
  const id = Number(fd.get("id") || 0);
  // 🔒 Follow delivery lock format: lockedBy = userId (string)
  const meId = String(me.userId);

  // Cancel an UNPAID slip (safe, reversible by reprinting later if needed)
  if (action === "cancelSlip") {
    if (!id) return json({ ok: false, error: "Invalid id" }, { status: 400 });
    const reason = String(fd.get("cancelReason") || "").trim();
    if (!reason) {
      return json(
        { ok: false, error: "Reason is required to cancel a ticket." },
        { status: 400 },
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
          { lockedBy: meId },
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
        { status: 423 },
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
        { status: 400 },
      );
    }
  }

  if (action === "openByCode") {
    const code = String(fd.get("code") || "").trim();
    if (!code)
      return json({ ok: false, error: "Enter a code" }, { status: 400 });

    // ✅ Cashier queue is WALK-IN only.
    // Delivery has its own dispatch/remit routes (do not route delivery from here).
    const found = await db.order.findFirst({
      where: {
        orderCode: code,
        channel: "PICKUP",
        status: "UNPAID",
      },
      select: {
        id: true,
        lockedAt: true,
        lockedBy: true,
      },
    });
    if (!found) {
      return json(
        {
          ok: false,
          error:
            "No UNPAID PICKUP ticket with that code. (Delivery orders are handled in Dispatch/Delivery routes.)",
        },
        { status: 404 },
      );
    }

    // ✅ DO NOT claim lock from queue (Approach B)
    // Lock is claimed explicitly inside /cashier/:id via "Start settlement".
    return redirect(`/cashier/${found.id}`);
  }

  if (action === "openById") {
    const id = Number(fd.get("id") || 0);
    if (!id) return json({ ok: false, error: "Invalid id" }, { status: 400 });

    // ✅ Walk-in only: only allow PICKUP here
    const existing = await db.order.findUnique({
      where: { id },
      select: { status: true, channel: true, lockedBy: true, lockedAt: true },
    });
    if (!existing)
      return json({ ok: false, error: "Order not found" }, { status: 404 });
    if (existing.channel !== "PICKUP") {
      return json(
        {
          ok: false,
          error:
            "This is a DELIVERY order. Open it in Dispatch / Delivery Remit routes, not in Walk-in cashier queue.",
        },
        { status: 400 },
      );
    }

    // PICKUP must be UNPAID to open at cashier
    if (existing.status !== "UNPAID") {
      return json({ ok: false, error: "Order is not UNPAID" }, { status: 400 });
    }

    // ✅ DO NOT claim lock from queue (Approach B)
    // Lock is claimed explicitly inside /cashier/:id via "Start settlement".
    return redirect(`/cashier/${id}`);
  }

  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CashierQueue() {
  const { pickups, meId } = useLoaderData<typeof loader>() as any;
  const MY_ID = String(meId || "");
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
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Cashier Queue"
        subtitle="Walk-in / PICKUP tickets only."
        backTo="/cashier"
        backLabel="Dashboard"
        maxWidthClassName="max-w-4xl"
      />

      <div className="mx-auto max-w-4xl px-5 py-6">
        <SoTActionBar
          right={
            <Link to="/pad-order">
              <SoTButton variant="primary">Add to cart (Order Pad)</SoTButton>
            </Link>
          }
        />

        {/* Open by code (PICKUP only) */}
        <Form method="post" className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-end gap-2">
            <SoTFormField label="Order Code (PICKUP only)" className="min-w-[260px] flex-1">
              <input
                name="code"
                placeholder="Scan or type Order Code (PICKUP)"
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
              />
            </SoTFormField>
            <input type="hidden" name="_action" value="openByCode" />
            <SoTButton type="submit" disabled={nav.state !== "idle"}>
              Open
            </SoTButton>
          </div>
        </Form>

        {actionData && "error" in actionData && (
          <SoTAlert tone="danger" className="mb-4 text-sm">
            {actionData.error}
          </SoTAlert>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-medium tracking-wide text-slate-700">
              Pickup tickets
            </h2>
            <span className="text-[11px] text-slate-500">
              {pickups.length} item(s)
            </span>
          </div>

          <SoTTable>
            <SoTTableHead>
              <tr>
                <SoTTh>Ticket</SoTTh>
                <SoTTh>Printed</SoTTh>
                <SoTTh>Lock</SoTTh>
                <SoTTh align="right">Actions</SoTTh>
              </tr>
            </SoTTableHead>
            <tbody>
              {pickups.length === 0 ? (
                <SoTTableEmptyRow colSpan={4} message="No pickup tickets." />
              ) : (
                pickups.map((r) => {
                  const isMineLock = r.isLocked && String(r.lockedBy) === MY_ID;
                  const lockedByOther = r.isLocked && !isMineLock;
                  const lockTone = lockedByOther
                    ? "warning"
                    : isMineLock
                      ? "info"
                      : "success";
                  const lockLabel = lockedByOther
                    ? `LOCKED · ${r.lockRemainingSec}s`
                    : isMineLock
                      ? `LOCKED (you) · ${r.lockRemainingSec}s`
                      : "OPEN";

                  return (
                    <SoTTableRow key={r.id}>
                      <SoTTd>
                        <Form method="post">
                          <input type="hidden" name="_action" value="openById" />
                          <input type="hidden" name="id" value={r.id} />
                          <button
                            type="submit"
                            className="text-left disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            disabled={lockedByOther}
                            title={
                              r.isLocked
                                ? isMineLock
                                  ? "Locked by YOU (re-open allowed)"
                                  : `Locked by ${r.lockedBy ?? "someone"}`
                                : "Open at cashier"
                            }
                          >
                            <div className="font-mono text-slate-700">{r.orderCode}</div>
                            <div className="text-[11px] text-slate-500">
                              Ticket #{r.printCount}
                            </div>
                          </button>
                        </Form>
                      </SoTTd>
                      <SoTTd className="text-xs text-slate-500">
                        {new Date(r.printedAt).toLocaleString()}
                      </SoTTd>
                      <SoTTd>
                        <SoTStatusBadge tone={lockTone}>{lockLabel}</SoTStatusBadge>
                      </SoTTd>
                      <SoTTd align="right">
                        <div className="flex justify-end gap-2">
                          <Form
                            method="post"
                            onSubmit={(e) => {
                              const reason = prompt("Reason for cancelling this ticket?");
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
                            <input type="hidden" name="_action" value="cancelSlip" />
                            <input type="hidden" name="id" value={r.id} />
                            <SoTButton
                              type="submit"
                              disabled={lockedByOther}
                              className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                              title="Cancel this ticket (moves to CANCELLED; auto-purges later)"
                            >
                              Cancel
                            </SoTButton>
                          </Form>

                          <Form
                            method="post"
                            onSubmit={(e) => {
                              if (
                                !confirm(
                                  `Delete ticket ${r.orderCode}? This cannot be undone.`,
                                )
                              ) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="_action" value="deleteSlip" />
                            <input type="hidden" name="id" value={r.id} />
                            <SoTButton
                              type="submit"
                              variant="danger"
                              disabled={lockedByOther}
                              title="Permanently delete this UNPAID ticket"
                            >
                              Delete
                            </SoTButton>
                          </Form>
                        </div>
                      </SoTTd>
                    </SoTTableRow>
                  );
                })
              )}
            </tbody>
          </SoTTable>
        </div>
      </div>
    </main>
  );
}
