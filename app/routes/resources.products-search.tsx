import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { Prisma } from "@prisma/client";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const pageSize = Math.min(50, Number(url.searchParams.get("pageSize") ?? 20));
  const skip = (page - 1) * pageSize;
  // Build a typed OR array so Prisma is happy
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
  const where: Prisma.ProductWhereInput | undefined =
    orFilters.length > 0 ? { OR: orFilters } : undefined;

  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      select: { id: true, name: true, brand: { select: { name: true } } },
      orderBy: [{ name: "asc" }],
      skip,
      take: pageSize,
    }),
    db.product.count({ where }),
  ]);

  return json({ items, total, page, pageSize });
}
