import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { Prisma } from "@prisma/client";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(50, Number(url.searchParams.get("pageSize") ?? 20));
  const skip = (page - 1) * pageSize;
  // Build OR filters for text/ID search
  const orFilters: Prisma.ProductWhereInput[] = [];
  if (q) {
    orFilters.push({
      name: { contains: q, mode: Prisma.QueryMode.insensitive },
    });
    const asNum = Number(q);
    if (Number.isInteger(asNum)) {
      orFilters.push({ id: asNum });
    }
  }
  // Build WHERE object incrementally
  const where: Prisma.ProductWhereInput = {};
  if (orFilters.length) where.OR = orFilters;

  // Only filter by category if it's set and not the sentinel "__ALL__"
  if (category && category !== "__ALL__") {
    // Use relation filter with `is` to be robust even if `category` relation is nullable
    where.category = { is: { name: { equals: category } } };
    // If your relation is non-nullable, this also works:
    // where.category = { name: { equals: category } };
  }

  const packOnlyWhere: Prisma.ProductWhereInput = {
    isActive: true,
    srp: { gt: 0 },
    // optionally also require stock > 0 to match loadout selection:
    // stock: { gt: 0 },
  };

  const finalWhere: Prisma.ProductWhereInput = Object.keys(where).length
    ? { AND: [where, packOnlyWhere] }
    : packOnlyWhere;

  const [items, total] = await Promise.all([
    db.product.findMany({
      where: finalWhere,
      select: {
        id: true,
        name: true,
        brand: { select: { name: true } },
        category: { select: { name: true } }, // keep for UI display/filter
        srp: true, // optional; useful for pack-only checks
      },
      orderBy: [{ name: "asc" }],
      skip,
      take: pageSize,
    }),
    db.product.count({ where: finalWhere }),
  ]);

  return json({ items, total, page, pageSize });
}
