import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";

export async function loader() {
  const brands = await db.brand.findMany();
  return json({ brands });
}
