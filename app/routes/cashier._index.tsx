import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import { db } from "~/utils/db.server";

// Lock TTL: how long a cashier can hold an order before it becomes claimable again
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function loader() {
  const orders = await db.order.findMany({
    where: { status: "UNPAID" },
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
  const now = Date.now();
  const rows = orders.map((o) => ({
    ...o,
    isExpired: o.expiryAt.getTime() < now,
    isLocked: !!o.lockedAt && now - o.lockedAt.getTime() < LOCK_TTL_MS,
  }));
  return json({ rows });
}

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const action = String(fd.get("_action") || "");
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
  const { rows } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const actionData = useActionData<typeof action>();
  return (
    <main className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Cashier Queue</h1>
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
          <Form key={r.id} method="post" className="block">
            <input type="hidden" name="_action" value="openById" />
            <input type="hidden" name="id" value={r.id} />
            <button
              type="submit"
              className="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:opacity-60"
              disabled={r.isLocked}
              title={r.isLocked ? `Locked by ${r.lockedBy ?? "someone"}` : ""}
            >
              <div className="flex items-center justify-between">
                <div className="font-mono text-slate-500">{r.orderCode}</div>
                <div className="text-sm">
                  {r.isExpired && (
                    <span className="text-red-600 mr-2">EXPIRED</span>
                  )}
                  {r.isLocked && (
                    <span className="text-amber-600 mr-2">LOCKED</span>
                  )}
                  <span className="text-gray-600">Slip #{r.printCount}</span>
                </div>
              </div>
              <div className="text-xs text-gray-600">
                Printed {new Date(r.printedAt).toLocaleString()}
              </div>
            </button>
          </Form>
        ))}
      </div>
    </main>
  );
}
