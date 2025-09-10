// app/routes/api.customers.create.ts
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { db } from "~/utils/db.server";
import { toE164PH } from "~/utils/phone";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return json({ ok: false, error: "POST only" }, { status: 405 });
  const fd = await request.formData();
  const firstName = String(fd.get("firstName") || "").trim();
  const lastName = String(fd.get("lastName") || "").trim();
  const middleName = String(fd.get("middleName") || "").trim() || null;
  const alias = String(fd.get("alias") || "").trim() || null;
  const phoneRaw = String(fd.get("phone") || "").trim();
  const phone = phoneRaw ? toE164PH(phoneRaw) : null;

  if (!firstName && !lastName) {
    return json(
      { ok: false, error: "First or last name is required." },
      { status: 400 }
    );
  }

  if (phoneRaw && !phone) {
    return json(
      { ok: false, error: "Invalid PH mobile number. Use 09xx… or +639xx…" },
      { status: 400 }
    );
  }

  // Optional: address fields (create initial delivery address)
  const addrLabel = String(fd.get("addrLabel") || "").trim() || "Home";
  const addrLine1 = String(fd.get("addrLine1") || "").trim();
  const addrBarangay = String(fd.get("addrBarangay") || "").trim();
  const addrCity = String(fd.get("addrCity") || "").trim();
  const addrProvince = String(fd.get("addrProvince") || "").trim();
  const addrLandmark = String(fd.get("addrLandmark") || "").trim() || null;
  const addrPhotoUrl = String(fd.get("addrPhotoUrl") || "").trim() || null;
  const latRaw = fd.get("addrGeoLat");
  const lngRaw = fd.get("addrGeoLng");
  const geoLat =
    latRaw == null || String(latRaw) === "" ? null : Number(latRaw);
  const geoLng =
    lngRaw == null || String(lngRaw) === "" ? null : Number(lngRaw);
  if (
    (geoLat != null && !Number.isFinite(geoLat)) ||
    (geoLng != null && !Number.isFinite(geoLng))
  ) {
    return json({ ok: false, error: "Invalid coordinates." }, { status: 400 });
  }
  const withAddress = addrLine1 && addrCity; // minimal fields to create an address

  try {
    const customer = await db.customer.create({
      data: {
        firstName,
        lastName,
        middleName,
        alias,
        phone, // normalized E.164 or null
        ...(withAddress
          ? {
              addresses: {
                create: [
                  {
                    label: addrLabel,
                    line1: addrLine1,
                    barangay: addrBarangay,
                    city: addrCity,
                    province: addrProvince,
                    landmark: addrLandmark,
                    geoLat,
                    geoLng,
                    photoUrl: addrPhotoUrl,
                  },
                ],
              },
            }
          : {}),
      },
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
            photoUrl: true,
          },
          orderBy: { id: "desc" },
          take: 5,
        },
      },
    });
    return json({ ok: true, customer });
  } catch (e: any) {
    return json(
      { ok: false, error: e?.message || "Failed to create customer." },
      { status: 400 }
    );
  }
}
