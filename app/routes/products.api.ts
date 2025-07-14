// app/routes.products.api.ts
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";

export const loader = async () => {
  const products = await db.product.findMany({
    include: { category: true, brand: true },
  });

  return json({ products });
};
