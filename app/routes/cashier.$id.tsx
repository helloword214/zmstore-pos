import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import { db } from "~/utils/db.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  const order = await db.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) throw new Response("Not found", { status: 404 });
  const now = Date.now();
  const isStale = order.lockedAt
    ? now - order.lockedAt.getTime() > 5 * 60 * 1000
    : true;
  return json({ order, isStale });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params.id);
  const fd = await request.formData();
  const act = String(fd.get("_action") || "");
  if (act === "reprint") {
    await db.order.update({
      where: { id },
      data: { printCount: { increment: 1 }, printedAt: new Date() },
    });
    return json({ ok: true, didReprint: true });
  }
  if (act === "release") {
    await db.order.update({
      where: { id },
      data: { lockedAt: null, lockedBy: null },
    });
    return redirect("/cashier");
  }
  return json({ ok: false, error: "Unknown action" }, { status: 400 });
}

export default function CashierOrder() {
  const { order, isStale } = useLoaderData<typeof loader>();
  const peso = (n: number) =>
    new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
    }).format(n);
  return (
    <main className="max-w-3xl mx-auto p-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Order {order.orderCode}</h1>
          <div className="text-xs text-gray-600">
            {order.lockedBy ? `Locked by ${order.lockedBy}` : "Unlocked"}
            {isStale && " • stale"}
          </div>
        </div>
        <div className="flex gap-2">
          <Form method="post">
            <input type="hidden" name="_action" value="reprint" />
            <button className="px-3 py-1.5 rounded border">Reprint</button>
          </Form>
          <Form method="post">
            <input type="hidden" name="_action" value="release" />
            <button className="px-3 py-1.5 rounded border">Release</button>
          </Form>
        </div>
      </div>
      <div className="mt-3 border rounded divide-y">
        {order.items.map((it) => (
          <div
            key={it.id}
            className="flex items-center justify-between px-3 py-2 text-sm"
          >
            <div>
              <div className="font-medium">{it.name}</div>
              <div className="text-xs text-gray-600">
                {it.qty} × {peso(Number(it.unitPrice))}
              </div>
            </div>
            <div className="font-semibold">{peso(Number(it.lineTotal))}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="font-medium">{peso(Number(order.subtotal))}</span>
        </div>
        <div className="flex justify-between">
          <span>Total (before discounts)</span>
          <span className="font-semibold">
            {peso(Number(order.totalBeforeDiscount))}
          </span>
        </div>
      </div>
    </main>
  );
}
