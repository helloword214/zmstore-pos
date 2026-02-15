// app/routes/api.quote-pricing.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { computeUnitPriceForCustomer } from "~/services/pricing";

type ReqBody = {
  customerId: number | null;
  items: Array<{
    productId: number;
    qty: number;
    unitKind?: "PACK" | "RETAIL";
  }>;
};

const clamp0 = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["EMPLOYEE", "STORE_MANAGER", "ADMIN"]);

  const body = (await request.json().catch(() => null)) as ReqBody | null;
  const customerId =
    body?.customerId != null && Number(body.customerId) > 0
      ? Number(body.customerId)
      : null;

  const itemsIn = Array.isArray(body?.items) ? body!.items : [];
  const items = itemsIn
    .map((it) => ({
      productId: Number(it.productId),
      qty: Math.max(0, Number(it.qty ?? 0)),
      unitKind: (it.unitKind ?? "PACK") as "PACK" | "RETAIL",
    }))
    .filter((it) => Number.isFinite(it.productId) && it.productId > 0);

  if (items.length === 0) {
    return json({ items: [], total: 0 }, { status: 200 });
  }

  const pids = Array.from(new Set(items.map((i) => i.productId)));
  const products = await db.product.findMany({
    where: { id: { in: pids } },
    select: {
      id: true,
      price: true,
      srp: true,
      packingSize: true,
      allowPackSale: true, // NOTE: legacy flag name; treated as "allow retail" in your latest order create
    },
  });

  const prodByPid = new Map<number, (typeof products)[number]>();
  for (const p of products) prodByPid.set(p.id, p);

  const outItems: Array<{
    productId: number;
    unitKind: "PACK" | "RETAIL";
    baseUnitPrice: number;
    effectiveUnitPrice: number;
    discountPerUnit: number;
    lineTotal: number;
  }> = [];

  let total = 0;

  for (const it of items) {
    const p = prodByPid.get(it.productId);
    if (!p) continue;

    // Normalize
    const price = clamp0(Number(p.price ?? 0));
    const srp = clamp0(Number(p.srp ?? 0));
    const allowRetail = Boolean(p.allowPackSale ?? true); // legacy flag name; treated as "allow retail"

    // ✅ UPDATED CANONICAL BASE (matches your final rule)
    // - baseRetail = product.price (explicit retail base)
    // - basePack   = product.srp if set else product.price
    const basePack = clamp0(srp > 0 ? srp : price);
    const baseRetail = clamp0(price);
    // Retail enabled: allowRetail + price exists
    // NOTE: packingSize is NOT required anymore for base pricing.
    const retailEnabled = allowRetail && baseRetail > 0;

    // Decide requested base. Fallback to PACK base if RETAIL not enabled.
    // (This matches your order-create guard behavior.)
    const baseUnitPrice =
      it.unitKind === "RETAIL"
        ? retailEnabled
          ? baseRetail
          : basePack
        : basePack > 0
        ? basePack
        : baseRetail;

    const eff = await computeUnitPriceForCustomer(db as any, {
      customerId,
      productId: it.productId,
      unitKind: it.unitKind === "RETAIL" ? "RETAIL" : "PACK",
      baseUnitPrice,
    });

    const effectiveUnitPrice = Number(eff ?? baseUnitPrice) || 0;
    const discountPerUnit = Math.max(
      0,
      Number((baseUnitPrice - effectiveUnitPrice).toFixed(2))
    );
    const lineTotal = Number((it.qty * effectiveUnitPrice).toFixed(2));
    total += lineTotal;

    outItems.push({
      productId: it.productId,
      unitKind: it.unitKind,
      baseUnitPrice: Number(baseUnitPrice.toFixed(2)),
      effectiveUnitPrice: Number(effectiveUnitPrice.toFixed(2)),
      discountPerUnit: discountPerUnit > 0.009 ? discountPerUnit : 0,
      lineTotal,
    });
  }

  return json({ items: outItems, total: Number(total.toFixed(2)) });
}
