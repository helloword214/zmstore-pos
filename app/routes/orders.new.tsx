import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { generateShortCode } from "~/utils/orderCode";

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const rawItems = formData.get("items");
  const terminalId = (formData.get("terminalId") || "KIOSK-01") as string;

  if (!rawItems) {
    return json({ ok: false, error: "Missing items" }, { status: 400 });
  }

  let items: Array<{
    id: number;
    name: string;
    qty: number;
    unitPrice: number;
  }>;
  try {
    items = JSON.parse(String(rawItems));
  } catch {
    return json({ ok: false, error: "items must be JSON" }, { status: 400 });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return json({ ok: false, error: "Cart is empty" }, { status: 400 });
  }

  // basic validation
  for (const it of items) {
    if (!it?.id || !it?.name) {
      return json(
        { ok: false, error: "Invalid item payload" },
        { status: 400 }
      );
    }
    if (Number(it.qty) <= 0) {
      return json(
        { ok: false, error: `Invalid qty for ${it.name}` },
        { status: 400 }
      );
    }
    if (Number(it.unitPrice) < 0) {
      return json(
        { ok: false, error: `Invalid price for ${it.name}` },
        { status: 400 }
      );
    }
  }

  const subtotal = items.reduce(
    (s, i) => s + Number(i.qty) * Number(i.unitPrice),
    0
  );
  const now = new Date();
  const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const order = await db.order.create({
    data: {
      orderCode: generateShortCode(),
      status: "UNPAID",
      subtotal,
      totalBeforeDiscount: subtotal,
      printCount: 1,
      printedAt: now,
      expiryAt: expiry,
      terminalId,
      items: {
        create: items.map((i) => ({
          productId: i.id,
          name: i.name,
          qty: Number(i.qty),
          unitPrice: Number(i.unitPrice),
          lineTotal: Number(i.qty) * Number(i.unitPrice),
        })),
      },
    },
    select: { id: true, orderCode: true },
  });

  // next step (separate task): render printable slip at /orders/:id/slip
  return redirect(`/orders/${order.id}/slip`);
}

export default function NewOrder() {
  return null; // action-only route
}
