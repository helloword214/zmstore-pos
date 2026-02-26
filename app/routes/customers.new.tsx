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
  ctx: "admin" | null;
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);
  const ctx = url.searchParams.get("ctx") === "admin" ? "admin" : null;
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
  const url = new URL(request.url);
  const ctx = url.searchParams.get("ctx") === "admin" ? "admin" : null;
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

  const ctxSuffix = ctx === "admin" ? "?ctx=admin" : "";
  return redirect(`/customers/${customer.id}${ctxSuffix}`);
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

type ActionData = { ok: false; message: string };

export default function NewCustomerPage() {
  const { provinces, municipalities, barangays, zones, landmarks, ctx } =
    useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const backHref = ctx === "admin" ? "/customers?ctx=admin" : "/customers";

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
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="New Customer"
        subtitle="Create customer master record for pricing and dispatch setup."
        backTo={backHref}
        backLabel="Customers"
        maxWidthClassName="max-w-5xl"
      />

      <Form method="post" className="mx-auto max-w-5xl space-y-4 px-5 py-6">
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
