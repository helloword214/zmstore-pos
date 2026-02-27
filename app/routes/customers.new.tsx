/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData } from "@remix-run/react";
import * as React from "react";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { db } from "~/utils/db.server";
import { requireRole } from "~/utils/auth.server";
import { storage } from "~/utils/storage.server";

type Province = { id: number; name: string; isActive: boolean };
type Municipality = {
  id: number;
  name: string;
  isActive: boolean;
  provinceId: number;
};
type Barangay = {
  id: number;
  name: string;
  isActive: boolean;
  municipalityId: number;
};
type Zone = { id: number; name: string; isActive: boolean; barangayId: number };
type Landmark = {
  id: number;
  name: string;
  isActive: boolean;
  barangayId: number | null;
};

type LoaderData = {
  provinces: Province[];
  municipalities: Municipality[];
  barangays: Barangay[];
  zones: Zone[];
  landmarks: Landmark[];
  ctx: "admin";
};

type AddressPhotoUpload = {
  addressIndex: number;
  slot: number;
  caption: string | null;
  file: File;
};

const MAX_ADDRESS_PHOTO_MB = Math.max(
  1,
  Number.parseFloat(
    process.env.MAX_ADDRESS_PHOTO_MB || process.env.MAX_UPLOAD_MB || "10"
  ) || 10
);
const MAX_ADDRESS_PHOTO_BYTES = Math.floor(MAX_ADDRESS_PHOTO_MB * 1024 * 1024);
const ALLOWED_ADDRESS_PHOTO_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function readOptionalUpload(raw: FormDataEntryValue | null): File | null {
  if (!(raw instanceof File)) return null;
  if (!raw.size) return null;
  return raw;
}

function parseAddressPhotoUploads(formData: FormData, addressCount: number) {
  const uploads: AddressPhotoUpload[] = [];
  for (let addressIndex = 0; addressIndex < addressCount; addressIndex += 1) {
    for (let slot = 1; slot <= 4; slot += 1) {
      const file = readOptionalUpload(
        formData.get(`addrPhotoFile_${addressIndex}_${slot}`)
      );
      if (!file) continue;
      const captionRaw = String(
        formData.get(`addrPhotoCaption_${addressIndex}_${slot}`) || ""
      ).trim();
      uploads.push({
        addressIndex,
        slot,
        caption: captionRaw || null,
        file,
      });
    }
  }
  return uploads;
}

function validateAddressPhotoUpload(file: File) {
  if (!ALLOWED_ADDRESS_PHOTO_MIME.has(file.type)) {
    return "Only JPG, PNG, and WEBP files are allowed.";
  }
  if (file.size > MAX_ADDRESS_PHOTO_BYTES) {
    return `File is too large. Limit is ${MAX_ADDRESS_PHOTO_MB}MB.`;
  }
  return null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const ctx = "admin";
  const [provinces, municipalities, barangays, zones, landmarks] =
    await Promise.all([
      db.province.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true },
      }),
      db.municipality.findMany({
        where: { isActive: true },
        orderBy: [{ provinceId: "asc" }, { name: "asc" }],
        select: { id: true, name: true, isActive: true, provinceId: true },
      }),
      db.barangay.findMany({
        where: { isActive: true },
        orderBy: [{ municipalityId: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          isActive: true,
          municipalityId: true,
        },
      }),
      db.zone.findMany({
        where: { isActive: true },
        orderBy: [{ barangayId: "asc" }, { name: "asc" }],
        select: { id: true, name: true, isActive: true, barangayId: true },
      }),
      db.landmark.findMany({
        where: { isActive: true },
        orderBy: [{ barangayId: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          isActive: true,
          barangayId: true,
        },
      }),
    ]);

  return json<LoaderData>({
    provinces,
    municipalities,
    barangays,
    zones,
    landmarks,
    ctx,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const firstName = String(fd.get("firstName") || "").trim();
  const middleName = (String(fd.get("middleName") || "").trim() || null) as
    | string
    | null;
  const lastName = String(fd.get("lastName") || "").trim();
  const suffix = (String(fd.get("suffix") || "").trim() || null) as
    | string
    | null;
  const alias = (String(fd.get("alias") || "").trim() || null) as string | null;
  const phone = (String(fd.get("phone") || "").trim() || null) as string | null;
  const email = (String(fd.get("email") || "").trim() || null) as string | null;

  if (!firstName || !lastName) {
    return json(
      { ok: false, message: "First name and Last name are required." },
      { status: 400 }
    );
  }

  let addresses: any[] = [];
  try {
    const raw = String(fd.get("addressesJson") || "[]");
    addresses = JSON.parse(raw);
    if (!Array.isArray(addresses)) addresses = [];
  } catch {
    addresses = [];
  }
  const photoUploads = parseAddressPhotoUploads(fd, addresses.length);
  for (const upload of photoUploads) {
    const photoError = validateAddressPhotoUpload(upload.file);
    if (photoError) {
      return json(
        {
          ok: false,
          message: `Address #${upload.addressIndex + 1} photo slot ${upload.slot}: ${photoError}`,
        },
        { status: 400 }
      );
    }
  }

  // Collect unique IDs to snapshot names server-side
  const pIds = Array.from(
    new Set(addresses.map((a) => Number(a.provinceId)).filter(Boolean))
  ) as number[];
  const mIds = Array.from(
    new Set(addresses.map((a) => Number(a.municipalityId)).filter(Boolean))
  ) as number[];
  const bIds = Array.from(
    new Set(addresses.map((a) => Number(a.barangayId)).filter(Boolean))
  ) as number[];

  const [pRows, mRows, bRows] = await Promise.all([
    pIds.length
      ? db.province.findMany({
          where: { id: { in: pIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: number; name: string }[]),
    mIds.length
      ? db.municipality.findMany({
          where: { id: { in: mIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: number; name: string }[]),
    bIds.length
      ? db.barangay.findMany({
          where: { id: { in: bIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: number; name: string }[]),
  ]);
  const pMap = new Map(pRows.map((r) => [r.id, r.name]));
  const mMap = new Map(mRows.map((r) => [r.id, r.name]));
  const bMap = new Map(bRows.map((r) => [r.id, r.name]));

  let customerId: number | null = null;
  const addressIdsByIndex = new Map<number, number>();

  await db.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        firstName,
        middleName,
        lastName,
        suffix,
        alias,
        phone,
        email,
        isActive: true,
      },
      select: { id: true },
    });
    customerId = customer.id;

    for (let index = 0; index < addresses.length; index += 1) {
      const a = addresses[index];
      if (String(a?.line1 || "").trim().length === 0) continue;

      const provinceId = a.provinceId ? Number(a.provinceId) : null;
      const municipalityId = a.municipalityId ? Number(a.municipalityId) : null;
      const barangayId = a.barangayId ? Number(a.barangayId) : null;
      const zoneId = a.zoneId ? Number(a.zoneId) : null;
      const landmarkId = a.landmarkId ? Number(a.landmarkId) : null;
      const parsedGeo = normalizeCoords(a.geoLat, a.geoLng);

      const createdAddress = await tx.customerAddress.create({
        data: {
          customerId: customer.id,
          label: String(a.label || "Home").slice(0, 64),
          line1: String(a.line1 || "").slice(0, 255),
          provinceId,
          municipalityId,
          barangayId,
          zoneId,
          landmarkId,
          province: provinceId ? pMap.get(provinceId) || "" : "",
          city: municipalityId ? mMap.get(municipalityId) || "" : "",
          barangay: barangayId ? bMap.get(barangayId) || "" : "",
          purok: a.purok ? String(a.purok).slice(0, 64) : null,
          postalCode: a.postalCode ? String(a.postalCode).slice(0, 16) : null,
          landmark: a.landmarkText ? String(a.landmarkText).slice(0, 255) : null,
          geoLat: parsedGeo?.geoLat ?? null,
          geoLng: parsedGeo?.geoLng ?? null,
        },
        select: { id: true },
      });
      addressIdsByIndex.set(index, createdAddress.id);
    }
  });

  if (!customerId) {
    return json(
      { ok: false, message: "Customer create failed." },
      { status: 500 }
    );
  }

  const updatedAddressIds = new Set<number>();
  for (const upload of photoUploads) {
    const addressId = addressIdsByIndex.get(upload.addressIndex);
    if (!addressId) continue;
    try {
      const saved = await storage.save(upload.file, {
        keyPrefix: `customers/${customerId}/addresses/${addressId}/photos`,
      });
      await db.customerAddressPhoto.upsert({
        where: {
          customerAddressId_slot: {
            customerAddressId: addressId,
            slot: upload.slot,
          },
        },
        create: {
          customerAddressId: addressId,
          slot: upload.slot,
          fileKey: saved.key,
          fileUrl: saved.url,
          mimeType: saved.contentType,
          sizeBytes: saved.size,
          caption: upload.caption?.slice(0, 160) || null,
        },
        update: {
          fileKey: saved.key,
          fileUrl: saved.url,
          mimeType: saved.contentType,
          sizeBytes: saved.size,
          caption: upload.caption?.slice(0, 160) || null,
          uploadedAt: new Date(),
        },
      });
      updatedAddressIds.add(addressId);
    } catch (error) {
      console.error("[customer-address-photo] create upload failed", error);
    }
  }

  for (const addressId of updatedAddressIds) {
    const cover = await db.customerAddressPhoto.findFirst({
      where: { customerAddressId: addressId },
      orderBy: [{ slot: "asc" }, { uploadedAt: "desc" }],
      select: { fileUrl: true, fileKey: true },
    });
    await db.customerAddress.update({
      where: { id: addressId },
      data: {
        photoUrl: cover?.fileUrl ?? null,
        photoKey: cover?.fileKey ?? null,
        photoUpdatedAt: cover ? new Date() : null,
      },
    });
  }

  return redirect(`/customers/${customerId}?ctx=admin`);
}

type AddressRow = {
  label: string;
  line1: string;
  provinceId: number | "";
  municipalityId: number | "";
  barangayId: number | "";
  zoneId: number | "";
  landmarkId: number | "";
  purok?: string;
  postalCode?: string;
  landmarkText?: string;
  mapUrl: string;
  geoLat: number | null;
  geoLng: number | null;
};

type ActionData = { ok: false; message: string };

function normalizeCoords(latRaw: string | number, lngRaw: string | number) {
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return {
    geoLat: Number(lat.toFixed(6)),
    geoLng: Number(lng.toFixed(6)),
  };
}

function extractCoordsFromText(text: string) {
  const atMatch = text.match(
    /@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i
  );
  if (atMatch) {
    return normalizeCoords(atMatch[1], atMatch[2]);
  }

  const dMatch = text.match(
    /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/i
  );
  if (dMatch) {
    return normalizeCoords(dMatch[1], dMatch[2]);
  }

  const pairMatch = text.match(
    /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/i
  );
  if (pairMatch) {
    return normalizeCoords(pairMatch[1], pairMatch[2]);
  }

  return null;
}

function parseGoogleMapsCoordinates(raw: string) {
  const value = raw.trim();
  if (!value) return null;

  const direct = extractCoordsFromText(value);
  if (direct) return direct;

  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url) return null;

  const q = url.searchParams.get("q");
  if (q) {
    const parsed = extractCoordsFromText(decodeURIComponent(q));
    if (parsed) return parsed;
  }
  const ll = url.searchParams.get("ll");
  if (ll) {
    const parsed = extractCoordsFromText(decodeURIComponent(ll));
    if (parsed) return parsed;
  }
  const center = url.searchParams.get("center");
  if (center) {
    const parsed = extractCoordsFromText(decodeURIComponent(center));
    if (parsed) return parsed;
  }

  const decodedHref = decodeURIComponent(url.href);
  return extractCoordsFromText(decodedHref);
}

export default function NewCustomerPage() {
  const { provinces, municipalities, barangays, zones, landmarks } =
    useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const backHref = "/customers?ctx=admin";

  // --- Basic info ---
  const [firstName, setFirstName] = React.useState("");
  const [middleName, setMiddleName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [suffix, setSuffix] = React.useState("");
  const [alias, setAlias] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");

  // --- Addresses (multi-row) ---
  const defaultProvince = provinces[0]?.id ?? "";
  const initialMuni =
    municipalities.find((m) => m.provinceId === defaultProvince)?.id ?? "";
  const initialBrgy =
    barangays.find((b) => b.municipalityId === initialMuni)?.id ?? "";

  const [addresses, setAddresses] = React.useState<AddressRow[]>([
    {
      label: "Home",
      line1: "",
      provinceId: defaultProvince,
      municipalityId: initialMuni,
      barangayId: initialBrgy,
      zoneId: "",
      landmarkId: "",
      purok: "",
      postalCode: "",
      landmarkText: "",
      mapUrl: "",
      geoLat: null,
      geoLng: null,
    },
  ]);

  const addRow = () => {
    const prov = provinces[0]?.id ?? "";
    const muni = municipalities.find((m) => m.provinceId === prov)?.id ?? "";
    const brgy = barangays.find((b) => b.municipalityId === muni)?.id ?? "";
    setAddresses((rows) => [
      ...rows,
      {
        label: "Other",
        line1: "",
        provinceId: prov,
        municipalityId: muni,
        barangayId: brgy,
        zoneId: "",
        landmarkId: "",
        purok: "",
        postalCode: "",
        landmarkText: "",
        mapUrl: "",
        geoLat: null,
        geoLng: null,
      },
    ]);
  };
  const removeRow = (idx: number) =>
    setAddresses((rows) => rows.filter((_, i) => i !== idx));

  const updateRow = <K extends keyof AddressRow>(
    idx: number,
    key: K,
    value: AddressRow[K]
  ) => {
    setAddresses((rows) => {
      const next = [...rows];
      const cur = { ...next[idx] };
      // cascade resets
      if (key === "provinceId") {
        const prov = value as number | "";
        const muni =
          municipalities.find((m) => m.provinceId === prov)?.id ?? "";
        const brgy = barangays.find((b) => b.municipalityId === muni)?.id ?? "";
        cur.provinceId = prov;
        cur.municipalityId = muni;
        cur.barangayId = brgy;
        cur.zoneId = "";
        cur.landmarkId = "";
      } else if (key === "municipalityId") {
        const muni = value as number | "";
        const brgy = barangays.find((b) => b.municipalityId === muni)?.id ?? "";
        cur.municipalityId = muni;
        cur.barangayId = brgy;
        cur.zoneId = "";
        cur.landmarkId = "";
      } else if (key === "barangayId") {
        const b = value as number | "";
        cur.barangayId = b;
        cur.zoneId = "";
        cur.landmarkId = "";
      } else {
        // normal assign
        (cur as any)[key] = value;
      }
      next[idx] = cur;
      return next;
    });
  };

  const updateMapUrl = (idx: number, mapUrl: string) => {
    setAddresses((rows) => {
      const next = [...rows];
      const cur = { ...next[idx] };
      cur.mapUrl = mapUrl;
      const parsed = parseGoogleMapsCoordinates(mapUrl);
      cur.geoLat = parsed?.geoLat ?? null;
      cur.geoLng = parsed?.geoLng ?? null;
      next[idx] = cur;
      return next;
    });
  };

  const clearMapPin = (idx: number) => {
    setAddresses((rows) => {
      const next = [...rows];
      const cur = { ...next[idx] };
      cur.mapUrl = "";
      cur.geoLat = null;
      cur.geoLng = null;
      next[idx] = cur;
      return next;
    });
  };

  // For submit, serialize addresses to JSON
  const addressesJson = React.useMemo(
    () => JSON.stringify(addresses),
    [addresses]
  );

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="New Customer"
        subtitle="Create customer master record for pricing and dispatch setup."
        backTo={backHref}
        backLabel="Customers"
        maxWidthClassName="max-w-5xl"
      />

      <Form
        method="post"
        encType="multipart/form-data"
        className="mx-auto max-w-5xl space-y-4 px-5 py-6"
      >
        {actionData?.message ? (
          <SoTAlert tone="danger">{actionData.message}</SoTAlert>
        ) : null}

        <SoTCard interaction="form">
          <h2 className="mb-3 text-sm font-medium text-slate-800">
            Basic Information
          </h2>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
            <Field
              label="First name"
              id="firstName"
              span={3}
              value={firstName}
              onChange={setFirstName}
              required
            />
            <Field
              label="Middle name"
              id="middleName"
              span={3}
              value={middleName}
              onChange={setMiddleName}
            />
            <Field
              label="Last name"
              id="lastName"
              span={3}
              value={lastName}
              onChange={setLastName}
              required
            />
            <Field
              label="Suffix"
              id="suffix"
              span={3}
              value={suffix}
              onChange={setSuffix}
            />
            <Field
              label="Alias"
              id="alias"
              span={3}
              value={alias}
              onChange={setAlias}
            />
            <Field
              label="Phone"
              id="phone"
              span={3}
              value={phone}
              onChange={setPhone}
            />
            <Field
              label="Email"
              id="email"
              span={6}
              value={email}
              onChange={setEmail}
            />
          </div>
          <input type="hidden" name="firstName" value={firstName} />
          <input type="hidden" name="middleName" value={middleName} />
          <input type="hidden" name="lastName" value={lastName} />
          <input type="hidden" name="suffix" value={suffix} />
          <input type="hidden" name="alias" value={alias} />
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="addressesJson" value={addressesJson} />
        </SoTCard>

        <SoTCard interaction="form" className="space-y-3">
          <SoTActionBar
            left={
              <h2 className="text-sm font-medium text-slate-800">
                Addresses ({addresses.length})
              </h2>
            }
            right={
              <SoTButton type="button" variant="secondary" onClick={addRow}>
                Add Address
              </SoTButton>
            }
          />

          <div className="space-y-3">
            {addresses.map((row, idx) => {
              const muniOptions = municipalities.filter(
                (m) => m.provinceId === (row.provinceId || -1)
              );
              const brgyOptions = barangays.filter(
                (b) => b.municipalityId === (row.municipalityId || -1)
              );
              const zoneOptions = zones.filter(
                (z) => z.barangayId === (row.barangayId || -1)
              );
              const lmOptions = landmarks.filter(
                (l) => (l.barangayId || -1) === (row.barangayId || -1)
              );

              return (
                <SoTCard
                  key={idx}
                  interaction="form"
                  compact
                  className="border-slate-200 bg-slate-50/70"
                >
                  <SoTActionBar
                    className="mb-2"
                    left={
                      <div className="text-sm font-medium text-slate-800">
                        Address #{idx + 1}
                      </div>
                    }
                    right={
                      addresses.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="text-xs font-medium text-rose-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                        >
                          Remove
                        </button>
                      ) : null
                    }
                  />

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
                    <Field
                      label="Label"
                      id={`addr-${idx}-label`}
                      span={3}
                      value={row.label}
                      onChange={(v) => updateRow(idx, "label", v)}
                    />
                    <Field
                      label="House/Street"
                      id={`addr-${idx}-line1`}
                      span={9}
                      value={row.line1}
                      onChange={(v) => updateRow(idx, "line1", v)}
                    />

                    <SelectField
                      label="Province"
                      id={`addr-${idx}-prov`}
                      span={3}
                      value={row.provinceId}
                      onChange={(v) =>
                        updateRow(idx, "provinceId", Number(v) || "")
                      }
                      options={provinces.map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                    />

                    <SelectField
                      label="Municipality/City"
                      id={`addr-${idx}-muni`}
                      span={3}
                      value={row.municipalityId}
                      onChange={(v) =>
                        updateRow(idx, "municipalityId", Number(v) || "")
                      }
                      options={muniOptions.map((m) => ({
                        value: m.id,
                        label: m.name,
                      }))}
                    />

                    <SelectField
                      label="Barangay"
                      id={`addr-${idx}-brgy`}
                      span={3}
                      value={row.barangayId}
                      onChange={(v) =>
                        updateRow(idx, "barangayId", Number(v) || "")
                      }
                      options={brgyOptions.map((b) => ({
                        value: b.id,
                        label: b.name,
                      }))}
                    />

                    <SelectField
                      label="Zone/Purok"
                      id={`addr-${idx}-zone`}
                      span={3}
                      value={row.zoneId}
                      onChange={(v) => updateRow(idx, "zoneId", Number(v) || "")}
                      options={zoneOptions.map((z) => ({
                        value: z.id,
                        label: z.name,
                      }))}
                      allowEmpty
                    />

                    <SelectField
                      label="Landmark (ref)"
                      id={`addr-${idx}-lm`}
                      span={4}
                      value={row.landmarkId}
                      onChange={(v) =>
                        updateRow(idx, "landmarkId", Number(v) || "")
                      }
                      options={lmOptions.map((l) => ({
                        value: l.id,
                        label: l.name,
                      }))}
                      allowEmpty
                    />
                    <Field
                      label="Landmark (text)"
                      id={`addr-${idx}-lmtext`}
                      span={4}
                      value={row.landmarkText || ""}
                      onChange={(v) => updateRow(idx, "landmarkText", v)}
                    />
                    <Field
                      label="Purok (text)"
                      id={`addr-${idx}-purok`}
                      span={2}
                      value={row.purok || ""}
                      onChange={(v) => updateRow(idx, "purok", v)}
                    />
                    <Field
                      label="Postal Code"
                      id={`addr-${idx}-pc`}
                      span={2}
                      value={row.postalCode || ""}
                      onChange={(v) => updateRow(idx, "postalCode", v)}
                    />

                    <div className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-3">
                      <SoTActionBar
                        className="mb-2"
                        left={
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Map Pin (Optional)
                          </div>
                        }
                        right={
                          <Link
                            to="https://maps.google.com"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                          >
                            Open Google Maps
                          </Link>
                        }
                      />

                      <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
                        <div className="md:col-span-8">
                          <SoTFormField
                            label="Google Maps Pin URL"
                            hint='Open Google Maps, click location, then paste copied link (works without API key).'
                          >
                            <input
                              id={`addr-${idx}-mapurl`}
                              value={row.mapUrl}
                              onChange={(e) => updateMapUrl(idx, e.target.value)}
                              placeholder="https://www.google.com/maps/..."
                              className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            />
                          </SoTFormField>
                        </div>

                        <div className="md:col-span-2">
                          <SoTFormField label="Latitude">
                            <input
                              value={row.geoLat ?? ""}
                              readOnly
                              className="h-9 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700"
                            />
                          </SoTFormField>
                        </div>

                        <div className="md:col-span-2">
                          <SoTFormField label="Longitude">
                            <input
                              value={row.geoLng ?? ""}
                              readOnly
                              className="h-9 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700"
                            />
                          </SoTFormField>
                        </div>
                      </div>

                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-slate-500">
                          {row.geoLat != null && row.geoLng != null
                            ? "Coordinates captured from map link."
                            : row.mapUrl
                            ? "No coordinates detected from this link. Paste a pin URL with coordinates."
                            : "No map pin yet."}
                        </p>
                        {row.mapUrl || row.geoLat != null || row.geoLng != null ? (
                          <button
                            type="button"
                            onClick={() => clearMapPin(idx)}
                            className="inline-flex h-7 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                          >
                            Clear Pin
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="md:col-span-12 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Location Photos (Optional)
                      </div>
                      <p className="mb-2 text-[11px] text-slate-500">
                        Up to 4 photos per address (road, kanto, gate, house front). No upload is also allowed.
                      </p>

                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {[1, 2, 3, 4].map((slot) => (
                          <div
                            key={`addr-${idx}-photo-slot-${slot}`}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-2"
                          >
                            <SoTFormField label={`Photo Slot ${slot}`}>
                              <input
                                type="file"
                                name={`addrPhotoFile_${idx}_${slot}`}
                                accept="image/jpeg,image/png,image/webp"
                                className="w-full text-xs text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                              />
                            </SoTFormField>
                            <SoTFormField label="Caption (optional)">
                              <input
                                name={`addrPhotoCaption_${idx}_${slot}`}
                                placeholder="ex: Kanto view / Gate color"
                                className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200"
                              />
                            </SoTFormField>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </SoTCard>
              );
            })}
          </div>
        </SoTCard>

        <SoTActionBar
          right={
            <>
              <Link
                to={backHref}
                className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Cancel
              </Link>
              <SoTButton type="submit" variant="primary">
                Save Customer
              </SoTButton>
            </>
          }
        />
      </Form>
    </main>
  );
}

function spanClass(span?: number) {
  const map: Record<number, string> = {
    1: "md:col-span-1",
    2: "md:col-span-2",
    3: "md:col-span-3",
    4: "md:col-span-4",
    5: "md:col-span-5",
    6: "md:col-span-6",
    7: "md:col-span-7",
    8: "md:col-span-8",
    9: "md:col-span-9",
    10: "md:col-span-10",
    11: "md:col-span-11",
    12: "md:col-span-12",
  };
  return map[span ?? 3] ?? "md:col-span-3";
}

function Field(props: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  span?: number;
  required?: boolean;
}) {
  return (
    <div className={spanClass(props.span)}>
      <SoTFormField
        label={
          <>
            {props.label}
            {props.required ? <span className="ml-1 text-rose-600">*</span> : null}
          </>
        }
      >
        <input
          id={props.id}
          className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          required={props.required}
        />
      </SoTFormField>
    </div>
  );
}

function SelectField(props: {
  label: string;
  id: string;
  value: number | "";
  onChange: (v: string) => void;
  options: { value: number; label: string }[];
  span?: number;
  allowEmpty?: boolean;
}) {
  return (
    <div className={spanClass(props.span)}>
      <SoTFormField label={props.label}>
        <select
          id={props.id}
          className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        >
          {props.allowEmpty ? <option value="">—</option> : null}
          {props.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </SoTFormField>
    </div>
  );
}
