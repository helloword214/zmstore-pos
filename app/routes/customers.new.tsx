/* eslint-disable @typescript-eslint/no-explicit-any */
import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";

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
};

export async function loader() {
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
  });
}

export async function action({ request }: ActionFunctionArgs) {
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

  const customer = await db.customer.create({
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

  if (addresses.length) {
    await db.customerAddress.createMany({
      data: addresses
        .filter((a) => String(a.line1 || "").trim().length > 0)
        .map((a) => {
          const provinceId = a.provinceId ? Number(a.provinceId) : null;
          const municipalityId = a.municipalityId
            ? Number(a.municipalityId)
            : null;
          const barangayId = a.barangayId ? Number(a.barangayId) : null;
          const zoneId = a.zoneId ? Number(a.zoneId) : null;
          const landmarkId = a.landmarkId ? Number(a.landmarkId) : null;
          return {
            customerId: customer.id,
            label: String(a.label || "Home").slice(0, 64),
            line1: String(a.line1 || "").slice(0, 255),
            provinceId,
            municipalityId,
            barangayId,
            zoneId,
            landmarkId,
            // snapshots
            province: provinceId ? pMap.get(provinceId) || "" : "",
            city: municipalityId ? mMap.get(municipalityId) || "" : "",
            barangay: barangayId ? bMap.get(barangayId) || "" : "",
            purok: a.purok ? String(a.purok).slice(0, 64) : null,
            postalCode: a.postalCode ? String(a.postalCode).slice(0, 16) : null,
            landmark: a.landmarkText
              ? String(a.landmarkText).slice(0, 255)
              : null,
          };
        }),
    });
  }

  return redirect(`/customers/${customer.id}`);
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
};

export default function NewCustomerPage() {
  const { provinces, municipalities, barangays, zones, landmarks } =
    useLoaderData<LoaderData>();

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

  // For submit, serialize addresses to JSON
  const addressesJson = React.useMemo(
    () => JSON.stringify(addresses),
    [addresses]
  );

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-900">
            New Customer
          </h1>
          <Link to="/customers" className="text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1">
            ← Back
          </Link>
        </header>

        <Form method="post" className="space-y-6">
          {/* Basic Info */}
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-sm font-medium text-slate-800 mb-3">
              Basic Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
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
              {/* Hidden fields for submit */}
              <input type="hidden" name="firstName" value={firstName} />
              <input type="hidden" name="middleName" value={middleName} />
              <input type="hidden" name="lastName" value={lastName} />
              <input type="hidden" name="suffix" value={suffix} />
              <input type="hidden" name="alias" value={alias} />
              <input type="hidden" name="phone" value={phone} />
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="addressesJson" value={addressesJson} />
            </div>
          </section>

          {/* Addresses */}
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-800">
                Addresses ({addresses.length})
              </h2>
              <button
                type="button"
                onClick={addRow}
                className="rounded-md border px-3 py-1 text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                + Add address
              </button>
            </div>

            <div className="space-y-4">
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
                  <div
                    key={idx}
                    className="rounded-lg border p-3 bg-slate-50/50"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-medium">
                        Address #{idx + 1}
                      </div>
                      {addresses.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="text-xs text-rose-600 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
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
                        onChange={(v) =>
                          updateRow(idx, "zoneId", Number(v) || "")
                        }
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
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex justify-end gap-2">
            <Link to="/customers" className="text-sm underline px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1">
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-md bg-indigo-600 text-white px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
            >
              Save Customer
            </button>
          </div>
        </Form>
      </div>
    </main>
  );
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
    <div className={`md:col-span-${props.span ?? 3}`}>
      <label htmlFor={props.id} className="text-sm">
        {props.label}{" "}
        {props.required ? <span className="text-rose-600">*</span> : null}
      </label>
      <input
        id={props.id}
        className="mt-1 w-full border rounded-md px-2 py-1 outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required={props.required}
      />
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
    <div className={`md:col-span-${props.span ?? 3}`}>
      <label htmlFor={props.id} className="text-sm">
        {props.label}
      </label>
      <select
        id={props.id}
        className="mt-1 w-full border rounded-md px-2 py-1 outline-none focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
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
    </div>
  );
}
