/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const provinceId = url.searchParams.get("pid")
    ? Number(url.searchParams.get("pid"))
    : null;
  const municipalityId = url.searchParams.get("mid")
    ? Number(url.searchParams.get("mid"))
    : null;
  const barangayId = url.searchParams.get("bid")
    ? Number(url.searchParams.get("bid"))
    : null;

  const provinces = await db.province.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true },
  });
  const activeProvinceId = provinceId ?? provinces[0]?.id ?? null;

  const municipalities = activeProvinceId
    ? await db.municipality.findMany({
        where: { provinceId: activeProvinceId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true },
      })
    : [];
  const activeMunicipalityId = municipalityId ?? municipalities[0]?.id ?? null;

  const barangays = activeMunicipalityId
    ? await db.barangay.findMany({
        where: { municipalityId: activeMunicipalityId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true },
      })
    : [];
  const activeBarangayId = barangayId ?? barangays[0]?.id ?? null;

  const [zones, landmarks] = activeBarangayId
    ? await Promise.all([
        db.zone.findMany({
          where: { barangayId: activeBarangayId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, isActive: true },
        }),
        db.landmark.findMany({
          where: { barangayId: activeBarangayId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, isActive: true },
        }),
      ])
    : [[], []];

  return json({
    provinces,
    municipalities,
    barangays,
    zones,
    landmarks,
    activeProvinceId,
    activeMunicipalityId,
    activeBarangayId,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  try {
    // Province is managed in /settings/province (keep here to toggle if needed)
    if (intent === "toggleProvince" && id) {
      const current = await db.province.findUnique({ where: { id } });
      if (!current) throw new Error("Province not found");
      await db.province.update({
        where: { id },
        data: { isActive: !current.isActive },
      });
      return json({ ok: true });
    }

    // Municipality
    if (intent === "createMunicipality") {
      const provinceId = Number(fd.get("provinceId"));
      const name = String(fd.get("name") || "").trim();
      if (!provinceId || name.length < 2) throw new Error("Invalid inputs.");
      await db.municipality.create({
        data: { name, provinceId, isActive: true },
      });
      return json({ ok: true });
    }
    if (intent === "renameMunicipality" && id) {
      const name = String(fd.get("name") || "").trim();
      if (name.length < 2) throw new Error("Name too short.");
      await db.municipality.update({ where: { id }, data: { name } });
      return json({ ok: true });
    }
    if (intent === "toggleMunicipality" && id) {
      const cur = await db.municipality.findUnique({ where: { id } });
      if (!cur) throw new Error("Not found");
      await db.municipality.update({
        where: { id },
        data: { isActive: !cur.isActive },
      });
      return json({ ok: true });
    }
    if (intent === "deleteMunicipality" && id) {
      const inUse =
        (await db.barangay.count({ where: { municipalityId: id } })) +
        (await db.customerAddress.count({ where: { municipalityId: id } }));
      if (inUse > 0)
        return json(
          {
            ok: false,
            message: `Cannot delete. In use by ${inUse} record(s).`,
          },
          { status: 400 }
        );
      await db.municipality.delete({ where: { id } });
      return json({ ok: true });
    }

    // Barangay
    if (intent === "createBarangay") {
      const municipalityId = Number(fd.get("municipalityId"));
      const name = String(fd.get("name") || "").trim();
      if (!municipalityId || name.length < 2)
        throw new Error("Invalid inputs.");
      await db.barangay.create({
        data: { name, municipalityId, isActive: true },
      });
      return json({ ok: true });
    }
    if (intent === "renameBarangay" && id) {
      const name = String(fd.get("name") || "").trim();
      if (name.length < 2) throw new Error("Name too short.");
      await db.barangay.update({ where: { id }, data: { name } });
      return json({ ok: true });
    }
    if (intent === "toggleBarangay" && id) {
      const cur = await db.barangay.findUnique({ where: { id } });
      if (!cur) throw new Error("Not found");
      await db.barangay.update({
        where: { id },
        data: { isActive: !cur.isActive },
      });
      return json({ ok: true });
    }
    if (intent === "deleteBarangay" && id) {
      const inUse =
        (await db.zone.count({ where: { barangayId: id } })) +
        (await db.landmark.count({ where: { barangayId: id } })) +
        (await db.customerAddress.count({ where: { barangayId: id } }));
      if (inUse > 0)
        return json(
          {
            ok: false,
            message: `Cannot delete. In use by ${inUse} record(s).`,
          },
          { status: 400 }
        );
      await db.barangay.delete({ where: { id } });
      return json({ ok: true });
    }

    // Zone
    if (intent === "createZone") {
      const barangayId = Number(fd.get("barangayId"));
      const name = String(fd.get("name") || "").trim();
      if (!barangayId || name.length < 1) throw new Error("Invalid inputs.");
      await db.zone.create({ data: { name, barangayId, isActive: true } });
      return json({ ok: true });
    }
    if (intent === "deleteZone" && id) {
      const used = await db.customerAddress.count({ where: { zoneId: id } });
      if (used > 0)
        return json(
          { ok: false, message: `Cannot delete. Used by ${used} address(es).` },
          { status: 400 }
        );
      await db.zone.delete({ where: { id } });
      return json({ ok: true });
    }

    // Landmark
    if (intent === "createLandmark") {
      const barangayId = Number(fd.get("barangayId"));
      const name = String(fd.get("name") || "").trim();
      if (!barangayId || name.length < 2) throw new Error("Invalid inputs.");
      await db.landmark.create({ data: { name, barangayId, isActive: true } });
      return json({ ok: true });
    }
    if (intent === "deleteLandmark" && id) {
      const used = await db.customerAddress.count({
        where: { landmarkId: id },
      });
      if (used > 0)
        return json(
          { ok: false, message: `Cannot delete. Used by ${used} address(es).` },
          { status: 400 }
        );
      await db.landmark.delete({ where: { id } });
      return json({ ok: true });
    }

    return json({ ok: false, message: "Unknown intent." }, { status: 400 });
  } catch (e: any) {
    return json(
      { ok: false, message: e?.message ?? "Operation failed." },
      { status: 500 }
    );
  }
}

export default function AreasPage() {
  const {
    provinces,
    municipalities,
    barangays,
    zones,
    landmarks,
    activeProvinceId,
    activeMunicipalityId,
    activeBarangayId,
  } = useLoaderData<typeof loader>();
  const f = useFetcher<{ ok?: boolean; message?: string }>();
  const navigate = useNavigate();

  const [munName, setMunName] = React.useState("");
  const [brgyName, setBrgyName] = React.useState("");
  const [zoneName, setZoneName] = React.useState("");
  const [lmName, setLmName] = React.useState("");

  // Improved: allow explicit null to clear lower-level selections
  function qs(next: {
    pid?: number | null;
    mid?: number | null;
    bid?: number | null;
  }) {
    const params = new URLSearchParams();
    const pid = next.pid === undefined ? activeProvinceId : next.pid;
    const mid = next.mid === undefined ? activeMunicipalityId : next.mid;
    const bid = next.bid === undefined ? activeBarangayId : next.bid;
    if (pid != null) params.set("pid", String(pid));
    if (mid != null) params.set("mid", String(mid));
    if (bid != null) params.set("bid", String(bid));
    return `?${params.toString()}`;
  }

  // a11y-safe ids for labels
  const provSelId = React.useId();
  const munSelId = React.useId();
  const brgySelId = React.useId();

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-900">
            Settings — Areas
          </h1>
          <Link to="/settings" className="text-sm underline">
            ← Back
          </Link>
        </header>
        {/* Cascading selectors */}
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold mb-3">Select Area</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Province */}
            <div>
              <label htmlFor={provSelId} className="text-sm">
                Province
              </label>
              <select
                id={provSelId}
                className="mt-1 w-full border rounded-md px-2 py-1"
                value={activeProvinceId ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  navigate(qs({ pid: val, mid: null, bid: null }));
                }}
              >
                {provinces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {/* Municipality */}
            <div>
              <label htmlFor={munSelId} className="text-sm">
                Municipality
              </label>
              <select
                id={munSelId}
                className="mt-1 w-full border rounded-md px-2 py-1"
                value={activeMunicipalityId ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  navigate(qs({ mid: val, bid: null }));
                }}
                disabled={!activeProvinceId || municipalities.length === 0}
              >
                {municipalities.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            {/* Barangay */}
            <div>
              <label htmlFor={brgySelId} className="text-sm">
                Barangay
              </label>
              <select
                id={brgySelId}
                className="mt-1 w-full border rounded-md px-2 py-1"
                value={activeBarangayId ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  navigate(qs({ bid: val }));
                }}
                disabled={!activeMunicipalityId || barangays.length === 0}
              >
                {barangays.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Provinces */}
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold mb-3">Provinces</h2>
            <ul className="divide-y border rounded-md">
              {provinces.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between px-2 py-1"
                >
                  <Link
                    to={qs({ pid: p.id, mid: null, bid: null })}
                    className="hover:underline"
                  >
                    {p.name}
                  </Link>
                  <f.Form method="post">
                    <input type="hidden" name="intent" value="toggleProvince" />
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      className="text-xs text-indigo-600 hover:underline"
                      type="submit"
                    >
                      {p.isActive ? "Disable" : "Enable"}
                    </button>
                  </f.Form>
                </li>
              ))}
            </ul>
          </section>

          {/* Municipalities */}
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold mb-2">Municipalities</h2>
            {activeProvinceId ? (
              <>
                <div className="flex gap-2 mb-3">
                  <input
                    value={munName}
                    onChange={(e) => setMunName(e.target.value)}
                    placeholder="Add municipality"
                    className="flex-1 border rounded-md px-2 py-1"
                  />
                  <f.Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="createMunicipality"
                    />
                    <input
                      type="hidden"
                      name="provinceId"
                      value={activeProvinceId}
                    />
                    <button
                      type="submit"
                      onClick={() => setMunName(munName.trim())}
                      className="border rounded-md px-3"
                      name="name"
                      value={munName}
                    >
                      Add
                    </button>
                  </f.Form>
                </div>
                <ul className="divide-y border rounded-md">
                  {municipalities.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between px-2 py-1"
                    >
                      <Link
                        to={qs({ mid: m.id, bid: null })}
                        className="hover:underline"
                      >
                        {m.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        <f.Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="toggleMunicipality"
                          />
                          <input type="hidden" name="id" value={m.id} />
                          <button
                            className="text-xs text-indigo-600 hover:underline"
                            type="submit"
                          >
                            {m.isActive ? "Disable" : "Enable"}
                          </button>
                        </f.Form>
                        <f.Form
                          method="post"
                          onSubmit={(e) => {
                            if (!confirm(`Delete "${m.name}"?`))
                              e.preventDefault();
                          }}
                        >
                          <input
                            type="hidden"
                            name="intent"
                            value="deleteMunicipality"
                          />
                          <input type="hidden" name="id" value={m.id} />
                          <button
                            className="text-xs text-rose-600 hover:underline"
                            type="submit"
                          >
                            Delete
                          </button>
                        </f.Form>
                      </div>
                    </li>
                  ))}
                  {municipalities.length === 0 ? (
                    <li className="px-2 py-2 text-sm text-gray-500">
                      No items
                    </li>
                  ) : null}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-500">Select a province.</p>
            )}
          </section>

          {/* Barangays */}
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold mb-2">Barangays</h2>
            {activeMunicipalityId ? (
              <>
                <div className="flex gap-2 mb-3">
                  <input
                    value={brgyName}
                    onChange={(e) => setBrgyName(e.target.value)}
                    placeholder="Add barangay"
                    className="flex-1 border rounded-md px-2 py-1"
                  />
                  <f.Form method="post">
                    <input type="hidden" name="intent" value="createBarangay" />
                    <input
                      type="hidden"
                      name="municipalityId"
                      value={activeMunicipalityId}
                    />
                    <button
                      type="submit"
                      onClick={() => setBrgyName(brgyName.trim())}
                      className="border rounded-md px-3"
                      name="name"
                      value={brgyName}
                    >
                      Add
                    </button>
                  </f.Form>
                </div>
                <ul className="divide-y border rounded-md">
                  {barangays.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center justify-between px-2 py-1"
                    >
                      <Link to={qs({ bid: b.id })} className="hover:underline">
                        {b.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        <f.Form method="post">
                          <input
                            type="hidden"
                            name="intent"
                            value="toggleBarangay"
                          />
                          <input type="hidden" name="id" value={b.id} />
                          <button
                            className="text-xs text-indigo-600 hover:underline"
                            type="submit"
                          >
                            {b.isActive ? "Disable" : "Enable"}
                          </button>
                        </f.Form>
                        <f.Form
                          method="post"
                          onSubmit={(e) => {
                            if (!confirm(`Delete "${b.name}"?`))
                              e.preventDefault();
                          }}
                        >
                          <input
                            type="hidden"
                            name="intent"
                            value="deleteBarangay"
                          />
                          <input type="hidden" name="id" value={b.id} />
                          <button
                            className="text-xs text-rose-600 hover:underline"
                            type="submit"
                          >
                            Delete
                          </button>
                        </f.Form>
                      </div>
                    </li>
                  ))}
                  {barangays.length === 0 ? (
                    <li className="px-2 py-2 text-sm text-gray-500">
                      No items
                    </li>
                  ) : null}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-500">Select a municipality.</p>
            )}
          </section>

          {/* Zone & Landmarks */}
          <section className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold mb-3">Zone · Landmarks</h2>
            {activeBarangayId ? (
              <>
                <div className="mb-4">
                  <h3 className="text-sm font-medium mb-1">Zones</h3>
                  <div className="flex gap-2 mb-2">
                    <input
                      value={zoneName}
                      onChange={(e) => setZoneName(e.target.value)}
                      placeholder="Add zone (e.g. Purok 4)"
                      className="flex-1 border rounded-md px-2 py-1"
                    />
                    <f.Form method="post">
                      <input type="hidden" name="intent" value="createZone" />
                      <input
                        type="hidden"
                        name="barangayId"
                        value={activeBarangayId}
                      />
                      <button
                        type="submit"
                        onClick={() => setZoneName(zoneName.trim())}
                        className="border rounded-md px-3"
                        name="name"
                        value={zoneName}
                      >
                        Add
                      </button>
                    </f.Form>
                  </div>
                  <ul className="divide-y border rounded-md">
                    {zones.map((z) => (
                      <li
                        key={z.id}
                        className="flex items-center justify-between px-2 py-1"
                      >
                        <span>{z.name}</span>
                        <f.Form
                          method="post"
                          onSubmit={(e) => {
                            if (!confirm(`Delete "${z.name}"?`))
                              e.preventDefault();
                          }}
                        >
                          <input
                            type="hidden"
                            name="intent"
                            value="deleteZone"
                          />
                          <input type="hidden" name="id" value={z.id} />
                          <button
                            className="text-xs text-rose-600 hover:underline"
                            type="submit"
                          >
                            Delete
                          </button>
                        </f.Form>
                      </li>
                    ))}
                    {zones.length === 0 ? (
                      <li className="px-2 py-2 text-sm text-gray-500">
                        No items
                      </li>
                    ) : null}
                  </ul>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-1">Landmarks</h3>
                  <div className="flex gap-2 mb-2">
                    <input
                      value={lmName}
                      onChange={(e) => setLmName(e.target.value)}
                      placeholder="Add landmark (e.g. Public Market)"
                      className="flex-1 border rounded-md px-2 py-1"
                    />
                    <f.Form method="post">
                      <input
                        type="hidden"
                        name="intent"
                        value="createLandmark"
                      />
                      <input
                        type="hidden"
                        name="barangayId"
                        value={activeBarangayId}
                      />
                      <button
                        type="submit"
                        onClick={() => setLmName(lmName.trim())}
                        className="border rounded-md px-3"
                        name="name"
                        value={lmName}
                      >
                        Add
                      </button>
                    </f.Form>
                  </div>
                  <ul className="divide-y border rounded-md">
                    {landmarks.map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between px-2 py-1"
                      >
                        <span>{l.name}</span>
                        <f.Form
                          method="post"
                          onSubmit={(e) => {
                            if (!confirm(`Delete "${l.name}"?`))
                              e.preventDefault();
                          }}
                        >
                          <input
                            type="hidden"
                            name="intent"
                            value="deleteLandmark"
                          />
                          <input type="hidden" name="id" value={l.id} />
                          <button
                            className="text-xs text-rose-600 hover:underline"
                            type="submit"
                          >
                            Delete
                          </button>
                        </f.Form>
                      </li>
                    ))}
                    {landmarks.length === 0 ? (
                      <li className="px-2 py-2 text-sm text-gray-500">
                        No items
                      </li>
                    ) : null}
                  </ul>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Select a barangay.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
