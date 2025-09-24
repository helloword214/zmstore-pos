// app/routes/resources.pricing.allowed.ts
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { computeUnitPriceForCustomer } from "~/services/pricing";
import { UnitKind } from "@prisma/client";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const pid = Number(url.searchParams.get("pid"));
  const cid = url.searchParams.has("cid")
    ? Number(url.searchParams.get("cid"))
    : null;
  const unitParam = String(
    url.searchParams.get("unit") || "PACK"
  ).toUpperCase();
  const unit = unitParam === "RETAIL" ? UnitKind.RETAIL : UnitKind.PACK;

  if (!Number.isFinite(pid) || pid <= 0) {
    return json({ ok: false, error: "Invalid pid" }, { status: 400 });
  }

  // Get base price for the requested unit kind
  const p = await db.product.findUnique({
    where: { id: pid },
    select: { price: true, srp: true },
  });
  if (!p)
    return json({ ok: false, error: "Product not found" }, { status: 404 });

  const base =
    unit === UnitKind.RETAIL
      ? Number(p.price ?? 0)
      : Number(p.srp ?? p.price ?? 0);

  if (!base || !Number.isFinite(base)) {
    return json({ ok: false, error: "No base price" }, { status: 400 });
  }

  const allowed = await computeUnitPriceForCustomer(db as any, {
    customerId: Number.isFinite(cid!) ? Number(cid) : null,
    productId: pid,
    unitKind: unit,
    baseUnitPrice: base,
  });

  return json({ ok: true, allowed, base, unit });
}
