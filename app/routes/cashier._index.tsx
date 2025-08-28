import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";

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
    isLocked: !!o.lockedAt && now - o.lockedAt.getTime() < 5 * 60 * 1000,
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
    const order = await db.order.findFirst({
      where: { orderCode: code, status: "UNPAID" },
    });
    if (!order)
      return json(
        { ok: false, error: "No UNPAID order with that code" },
        { status: 404 }
      );
    const now = new Date();
    const stale = order.lockedAt
      ? now.getTime() - order.lockedAt.getTime() > 5 * 60 * 1000
      : true;
    if (order.lockedAt && !stale)
      return json(
        { ok: false, error: `Locked by ${order.lockedBy}` },
        { status: 423 }
      );
    await db.order.update({
      where: { id: order.id },
      data: { lockedAt: now, lockedBy: "CASHIER-01" },
    });
    return redirect(`/cashier/${order.id}`);
  }
  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CashierQueue() {
  const { rows } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const action = useActionData<typeof action>();
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
      {action && "error" in action && (
        <div className="text-sm text-red-600 mb-2">{action.error}</div>
      )}
      <div className="divide-y border rounded">
        {rows.map((r) => (
          <a
            key={r.id}
            href={`/cashier/${r.id}`}
            className="block px-3 py-2 hover:bg-gray-50"
          >
            <div className="flex items-center justify-between">
              <div className="font-mono">{r.orderCode}</div>
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
          </a>
        ))}
      </div>
    </main>
  );
}
