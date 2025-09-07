import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";
import type { Prisma } from "@prisma/client";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ items: [] });

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return json({ items: [] });

  // Build a strongly-typed Prisma where input
  const where: Prisma.CustomerWhereInput = {
    AND: tokens.map<Prisma.CustomerWhereInput>((t) => ({
      OR: [
        { firstName: { contains: t, mode: "insensitive" as const } },
        { lastName: { contains: t, mode: "insensitive" as const } },
        { alias: { contains: t, mode: "insensitive" as const } },
        { phone: { contains: t } },
      ],
    })),
    // Optional: only active customers
    // isActive: true,
  };

  const items = await db.customer.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 10,
  });

  return json({ items });
}
