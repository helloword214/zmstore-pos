/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";

// Run-centric bridge:
//  - URL pa rin: /orders/:id/dispatch
//  - Pero hindi na siya may sariling UI.
//  - Hanapin (or gumawa) ng DeliveryRun, tapos i-redirect sa /runs/:runId/dispatch.

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Same idea as store dispatch queue: manager/admin lang
  await requireRole(request, ["ADMIN", "STORE_MANAGER"]);

  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    throw new Response("Invalid ID", { status: 400 });
  }

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderCode: true,
      channel: true,
      runOrders: {
        select: { runId: true },
        take: 1,
      },
    },
  });

  if (!order) {
    throw new Response("Not found", { status: 404 });
  }

  // Safety: kung hindi DELIVERY, balik sa cashier dispatch tab (gaya ng dati)
  if (order.channel !== "DELIVERY") {
    return redirect("/cashier?tab=dispatch");
  }

  // 1️⃣ Kung meron nang naka-link na run → diretsong punta sa run dispatch UI
  const existing = order.runOrders[0];
  if (existing) {
    return redirect(`/runs/${existing.runId}/dispatch`);
  }

  // 2️⃣ Wala pang run → gumawa ng PLANNED DeliveryRun + link sa order
  const run = await db.$transaction(async (tx) => {
    const newRun = await tx.deliveryRun.create({
      data: {
        // Simple: tie to orderCode; unique rin to sa DeliveryRun.runCode
        runCode: `RUN-${order.orderCode}`,
        status: "PLANNED",
      },
      select: { id: true },
    });

    await tx.deliveryRunOrder.create({
      data: {
        runId: newRun.id,
        orderId: order.id,
      },
    });

    return newRun;
  });

  // 3️⃣ Iisang dispatch UI na gagamitin: /runs/:id/dispatch
  return redirect(`/runs/${run.id}/dispatch`);
}

// Normally hindi na ito nagre-render dahil loader laging nagre-redirect.
export default function OrderDispatchRedirectPage() {
  return null;
}
