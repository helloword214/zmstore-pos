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
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTStatusBadge } from "~/components/ui/SoTStatusBadge";
import { db } from "~/utils/db.server";
import { requireOpenShift } from "~/utils/auth.server";
import { assertActiveShiftWritable } from "~/utils/shiftGuards.server";

// Lock TTL: how long a cashier can hold an order before it becomes claimable again
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

function formatPrintedAt(value: string | Date | null) {
  if (!value) return "Not printed";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  const meId = String(me.userId);

  // Hard delete an accidental UNPAID slip (irreversible)
  if (action === "deleteSlip") {
    if (!id) return json({ ok: false, error: "Invalid id" }, { status: 400 });
    try {
      await db.$transaction(async (tx) => {
        const o = await tx.order.findUnique({
          where: { id },
          select: {
            channel: true,
            status: true,
            isOnCredit: true,
            lockedAt: true,
            lockedBy: true,
            _count: { select: { payments: true } },
          },
        });
        if (!o || o.channel !== "PICKUP" || o.status !== "UNPAID") {
          throw new Error("Only unpaid walk-in slips can be deleted here.");
        }
        if (o.isOnCredit) {
          throw new Error("Credit slips cannot be deleted from cashier queue.");
        }
        if (o._count.payments > 0) {
          throw new Error("Slip already has payment history. Void/refund flow is required.");
        }

        const freshLockByOther =
          !!o.lockedAt &&
          Date.now() - o.lockedAt.getTime() < LOCK_TTL_MS &&
          String(o.lockedBy ?? "") !== meId;

        if (freshLockByOther) {
          throw new Error("Slip is being handled by another cashier.");
        }
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        await tx.order.delete({ where: { id } });
      });
      return redirect("/cashier/pos");
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Delete failed";
      return json(
        { ok: false, error: errorMessage },
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
  const { pickups, meId } = useLoaderData<typeof loader>();
  const MY_ID = String(meId || "");
  const nav = useNavigation();
  const actionData = useActionData<typeof action>();
  const [openActionOrderId, setOpenActionOrderId] = React.useState<number | null>(
    null,
  );

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
        title="Walk-in Cashier Queue"
        subtitle="Unpaid walk-in orders."
        backTo="/cashier"
        backLabel="Dashboard"
        maxWidthClassName="max-w-4xl"
      />

      <div className="mx-auto max-w-4xl space-y-3 px-4 py-4 sm:px-5">
        <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:grid-cols-[1fr_auto] lg:items-end">
          <Form method="post" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <SoTFormField label="Order code" className="min-w-[220px] flex-1">
              <input
                name="code"
                placeholder="Scan or type walk-in order code"
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
              />
            </SoTFormField>
            <input type="hidden" name="_action" value="openByCode" />
            <SoTButton
              type="submit"
              disabled={nav.state !== "idle"}
              className="w-full sm:w-auto"
            >
              Open
            </SoTButton>
          </Form>
          <Link to="/pad-order" className="block">
            <SoTButton
              type="button"
              variant="secondary"
              className="w-full lg:w-auto"
            >
              Create Walk-in Order
            </SoTButton>
          </Link>
        </div>

        {actionData && "error" in actionData && (
          <SoTAlert tone="danger" className="mb-4 text-sm">
            {actionData.error}
          </SoTAlert>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                Ready for settlement
              </h2>
              <p className="text-xs text-slate-500">
                {pickups.length} unpaid walk-in order
                {pickups.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {pickups.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                No walk-in orders waiting for cashier.
              </div>
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
                  ? `In use · ${r.lockRemainingSec}s`
                  : isMineLock
                    ? `In use by you · ${r.lockRemainingSec}s`
                    : "Available";
                const actionRailOpen = openActionOrderId === r.id;

                return (
                  <div
                    key={r.id}
                    className="px-4 py-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold tracking-wide text-slate-900">
                            {r.orderCode}
                          </span>
                          <SoTStatusBadge tone={lockTone}>{lockLabel}</SoTStatusBadge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span>Ticket #{r.printCount}</span>
                          <span>Printed {formatPrintedAt(r.printedAt)}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <Form method="post">
                          <input type="hidden" name="_action" value="openById" />
                          <input type="hidden" name="id" value={r.id} />
                          <SoTButton
                            type="submit"
                            variant="primary"
                            size="compact"
                            disabled={lockedByOther}
                            title={
                              r.isLocked
                                ? isMineLock
                                  ? "Locked by you. Re-open allowed."
                                  : `Locked by ${r.lockedBy ?? "another cashier"}`
                                : "Open cashier settlement"
                            }
                          >
                            {isMineLock ? "Resume" : "Settle"}
                          </SoTButton>
                        </Form>

                        <SoTButton
                          type="button"
                          size="compact"
                          disabled={lockedByOther}
                          onClick={() =>
                            setOpenActionOrderId((current) =>
                              current === r.id ? null : r.id,
                            )
                          }
                          className={
                            actionRailOpen
                              ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                              : ""
                          }
                          aria-expanded={actionRailOpen}
                        >
                          Options
                        </SoTButton>
                      </div>
                    </div>

                    {actionRailOpen ? (
                      <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/50 px-3 py-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-xs font-semibold text-rose-700">
                              Delete unpaid slip
                            </div>
                            <div className="text-[11px] text-rose-600">
                              Use only for accidental walk-in tickets with no payment.
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                          <Form
                            method="post"
                            onSubmit={(e) => {
                              if (
                                !confirm(
                                  `Delete unpaid slip ${r.orderCode}? This cannot be undone.`,
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
                              size="compact"
                              disabled={lockedByOther}
                              className="h-8 rounded-lg px-3 text-[11px]"
                              title="Permanently delete this unpaid ticket"
                            >
                              Delete slip
                            </SoTButton>
                          </Form>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
