import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { db } from "~/utils/db.server";
import {
  buildCustomerSearchWhere,
  scoreAndSortCustomers,
} from "~/services/customerSearch.server";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["CASHIER", "ADMIN", "STORE_MANAGER", "EMPLOYEE"]);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const withAddresses = url.searchParams.get("withAddresses") === "1";
  const mustHaveOpenOrders = url.searchParams.get("openOnly") === "1";

  if (!q) return json({ items: [] });

  const where = buildCustomerSearchWhere({ q, mustHaveOpenOrders });

  const rows = await db.customer.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
      ...(withAddresses
        ? {
            addresses: {
              select: {
                id: true,
                label: true,
                line1: true,
                barangay: true,
                city: true,
                province: true,
                landmark: true,
                geoLat: true,
                geoLng: true,
                photoUrl: true,
                photoUpdatedAt: true,
              },
              orderBy: [{ photoUpdatedAt: "desc" }, { id: "desc" }],
              take: 2,
            },
          }
        : {}),
    },
    take: 25,
  });

  const items = scoreAndSortCustomers(rows, q).slice(0, 10);
  return json({ items });
}
