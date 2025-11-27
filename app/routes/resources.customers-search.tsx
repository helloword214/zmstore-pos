/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";
// ⤵️ Adjust this import path if your file lives elsewhere
import {
  buildCustomerSearchWhere,
  scoreAndSortCustomers,
} from "~/services/customerSearch.server";
import { requireUser } from "~/utils/auth.server";

import type { Prisma } from "@prisma/client";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request); // 🔒 anyone logged-in may search
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const withAddresses = url.searchParams.get("withAddresses") === "1";
  const mustHaveOpenOrders = url.searchParams.get("mustHaveOpenOrders") === "1";

  if (!q) {
    return json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const where = buildCustomerSearchWhere({ q, mustHaveOpenOrders });

  const baseSelect: Prisma.CustomerSelect = {
    id: true,
    firstName: true,
    middleName: true,
    lastName: true,
    alias: true,
    phone: true,
  };
  const select: Prisma.CustomerSelect = withAddresses
    ? {
        ...baseSelect,
        addresses: {
          select: {
            id: true,
            label: true,
            line1: true,
            barangay: true,
            city: true,
            province: true,
            landmark: true,
          },
          take: 5,
          // Your Address model likely lacks `updatedAt`; sort by id instead.
          orderBy: { id: "desc" },
        },
      }
    : baseSelect;

  const rows = await db.customer.findMany({
    where,
    select,
    take: 30,
    // `updatedAt` doesn’t exist on Customer in your schema; use id desc.
    orderBy: [{ id: "desc" }],
  });

  // Reuse your scorer for consistent ranking
  const items = scoreAndSortCustomers(rows as any, q);

  return json({ items }, { headers: { "Cache-Control": "no-store" } });
}

// loader-only route (no UI)
export default function _NoUI() {
  return null;
}
