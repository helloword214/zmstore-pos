// app/routes/products.api.ts
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";

export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  if (!q) {
    const products = await db.product.findMany({
      include: { category: true, brand: true },
      orderBy: { createdAt: "desc" },
    });
    return json({ products });
  }

  const products = await db.$queryRawUnsafe(
    `
  SELECT 
    p.*, 
    c.name AS "categoryName", 
    b.name AS "brandName",
    similarity(p.name, $1) AS score
  FROM "Product" p
  LEFT JOIN "Category" c ON c.id = p."categoryId"
  LEFT JOIN "Brand" b ON b.id = p."brandId"
  LEFT JOIN "ProductIndication" pi ON pi."productId" = p.id
  LEFT JOIN "Indication" i ON i.id = pi."indicationId"
  LEFT JOIN "ProductTarget" pt ON pt."productId" = p.id
  LEFT JOIN "Target" t ON t.id = pt."targetId"
  WHERE 
    p.name ILIKE '%' || $1 || '%' OR
    p.description ILIKE '%' || $1 || '%' OR
    b.name ILIKE '%' || $1 || '%' OR
    i.name ILIKE '%' || $1 || '%' OR
    t.name ILIKE '%' || $1 || '%' OR
    similarity(p.name, $1) > 0.2 OR
    word_similarity(p.name, $1) > 0.2 OR
    similarity(b.name, $1) > 0.2 OR
    word_similarity(b.name, $1) > 0.2
  GROUP BY p.id, c.name, b.name
  ORDER BY score DESC
  LIMIT 50;
  `,
    q
  );

  return json({ products });
};
