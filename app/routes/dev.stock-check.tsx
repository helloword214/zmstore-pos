import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";

// Usage: /dev/stock-check?id=123 or /dev/stock-check?ids=123,456
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const ids = url.searchParams.get("ids");

  let where: { id: number } | { id: { in: number[] } } | undefined = undefined;

  if (id) where = { id: Number(id) };
  else if (ids)
    where = { id: { in: ids.split(",").map((s) => Number(s.trim())) } };

  if (!where)
    return json({ error: "Pass ?id=123 or ?ids=123,456" }, { status: 400 });

  const rows = await db.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      allowPackSale: true,
      price: true,
      srp: true,
      stock: true,
      packingStock: true,
      minStock: true,
      packingSize: true,
      unit: { select: { name: true } },
      packingUnit: { select: { name: true } },
      isActive: true,
    },
  });

  const out = rows.map((p) => {
    // normalize like the kiosk loader
    const price = p.price == null ? 0 : Number(p.price);
    const srp = p.srp == null ? 0 : Number(p.srp);
    const stock = p.stock == null ? 0 : Number(p.stock);
    const packingStock = p.packingStock == null ? 0 : Number(p.packingStock);
    const minStock = p.minStock == null ? null : Number(p.minStock);
    const packingSize = p.packingSize == null ? 0 : Number(p.packingSize);

    const retailAvailable = !!p.allowPackSale && stock > 0 && price > 0;
    const packAvailable = packingStock > 0 && srp > 0;
    const isOut = !retailAvailable && !packAvailable;
    const isLowStock =
      !isOut &&
      ((packAvailable && packingStock <= 1) ||
        (p.allowPackSale &&
          minStock != null &&
          stock > 0 &&
          stock <= minStock));

    return {
      id: p.id,
      name: p.name,
      isActive: p.isActive,
      allowPackSale: p.allowPackSale,
      numerics: { price, srp, stock, packingStock, minStock, packingSize },
      units: {
        unit: p.unit?.name ?? null,
        packUnit: p.packingUnit?.name ?? null,
      },
      computed: { retailAvailable, packAvailable, isOut, isLowStock },
    };
  });

  return json(
    { count: out.length, products: out },
    { headers: { "Cache-Control": "no-store" } }
  );
}
