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

  if (withAddresses) {
    const rows = await db.customer.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        alias: true,
        phone: true,
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
            photos: {
              select: {
                slot: true,
                fileUrl: true,
                uploadedAt: true,
              },
              orderBy: [{ slot: "asc" }, { uploadedAt: "desc" }],
            },
          },
          orderBy: [{ id: "desc" }],
          take: 2,
        },
      },
      take: 25,
    });

    const normalizedRows = rows.map((row) => ({
      ...row,
      addresses: row.addresses.map((address) => {
        const uniquePhotos = address.photos.filter((photo, index, list) => {
          const firstIndex = list.findIndex((item) => item.slot === photo.slot);
          return firstIndex === index;
        });
        const coverPhoto = uniquePhotos[0] ?? null;
        const latestPhoto =
          uniquePhotos.length > 0
            ? uniquePhotos.reduce((latest, photo) =>
                photo.uploadedAt > latest.uploadedAt ? photo : latest
              )
            : null;

        return {
          id: address.id,
          label: address.label,
          line1: address.line1,
          barangay: address.barangay,
          city: address.city,
          province: address.province,
          landmark: address.landmark,
          geoLat: address.geoLat,
          geoLng: address.geoLng,
          photoUrl: coverPhoto?.fileUrl ?? null,
          photoUpdatedAt: latestPhoto?.uploadedAt ?? null,
        };
      }),
    }));

    const items = scoreAndSortCustomers(normalizedRows, q).slice(0, 10);
    return json({ items });
  }

  const rows = await db.customer.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      alias: true,
      phone: true,
    },
    take: 25,
  });

  const items = scoreAndSortCustomers(rows, q).slice(0, 10);
  return json({ items });
}
