/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import * as React from "react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTEntityFormPanel } from "~/components/ui/SoTEntityFormPanel";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import {
  SoTTable,
  SoTTd,
  SoTTh,
  SoTTableEmptyRow,
  SoTTableHead,
  SoTTableRow,
} from "~/components/ui/SoTTable";
import { requireRole } from "~/utils/auth.server";
import { db } from "~/utils/db.server";

type BasicRow = {
  id: number;
  name: string;
  isActive: boolean;
};

type ActionData = {
  ok?: boolean;
  message?: string;
};

type WorkspaceTab = "municipalities" | "barangays" | "zones" | "landmarks";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const url = new URL(request.url);

  const provinceIdRaw = url.searchParams.get("pid");
  const municipalityIdRaw = url.searchParams.get("mid");
  const barangayIdRaw = url.searchParams.get("bid");

  const provinceId =
    provinceIdRaw && Number.isFinite(Number(provinceIdRaw))
      ? Number(provinceIdRaw)
      : null;
  const municipalityId =
    municipalityIdRaw && Number.isFinite(Number(municipalityIdRaw))
      ? Number(municipalityIdRaw)
      : null;
  const barangayId =
    barangayIdRaw && Number.isFinite(Number(barangayIdRaw))
      ? Number(barangayIdRaw)
      : null;

  const provinces = await db.province.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true },
  });

  const activeProvinceId =
    provinceId != null && provinces.some((p) => p.id === provinceId)
      ? provinceId
      : provinces[0]?.id ?? null;

  const municipalities = activeProvinceId
    ? await db.municipality.findMany({
        where: { provinceId: activeProvinceId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true },
      })
    : [];

  const activeMunicipalityId =
    municipalityId != null && municipalities.some((m) => m.id === municipalityId)
      ? municipalityId
      : null;

  const barangays = activeMunicipalityId
    ? await db.barangay.findMany({
        where: { municipalityId: activeMunicipalityId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, isActive: true },
      })
    : [];

  const activeBarangayId =
    barangayId != null && barangays.some((b) => b.id === barangayId) ? barangayId : null;

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
  await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  const id = fd.get("id") ? Number(fd.get("id")) : null;

  try {
    if (intent === "toggleProvince" && id) {
      const current = await db.province.findUnique({ where: { id } });
      if (!current) throw new Error("Province not found.");
      await db.province.update({ where: { id }, data: { isActive: !current.isActive } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "createMunicipality") {
      const provinceId = Number(fd.get("provinceId"));
      const name = String(fd.get("name") || "").trim();
      if (!provinceId || name.length < 2) throw new Error("Invalid inputs.");

      const province = await db.province.findUnique({
        where: { id: provinceId },
        select: { id: true },
      });
      if (!province) throw new Error("Selected province is invalid.");

      await db.municipality.create({ data: { name, provinceId, isActive: true } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "renameMunicipality" && id) {
      const name = String(fd.get("name") || "").trim();
      if (name.length < 2) throw new Error("Name too short.");
      await db.municipality.update({ where: { id }, data: { name } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "toggleMunicipality" && id) {
      const current = await db.municipality.findUnique({ where: { id } });
      if (!current) throw new Error("Municipality not found.");
      await db.municipality.update({ where: { id }, data: { isActive: !current.isActive } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "deleteMunicipality" && id) {
      const inUse =
        (await db.barangay.count({ where: { municipalityId: id } })) +
        (await db.customerAddress.count({ where: { municipalityId: id } }));
      if (inUse > 0) {
        return json<ActionData>(
          { ok: false, message: `Cannot delete. In use by ${inUse} record(s).` },
          { status: 400 }
        );
      }
      await db.municipality.delete({ where: { id } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "createBarangay") {
      const municipalityId = Number(fd.get("municipalityId"));
      const provinceId = Number(fd.get("provinceId"));
      const name = String(fd.get("name") || "").trim();
      if (!municipalityId || !provinceId || name.length < 2) throw new Error("Invalid inputs.");

      const municipality = await db.municipality.findFirst({
        where: { id: municipalityId, provinceId },
        select: { id: true },
      });
      if (!municipality) throw new Error("Selected municipality is invalid for this province.");

      await db.barangay.create({ data: { name, municipalityId, isActive: true } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "renameBarangay" && id) {
      const name = String(fd.get("name") || "").trim();
      if (name.length < 2) throw new Error("Name too short.");
      await db.barangay.update({ where: { id }, data: { name } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "toggleBarangay" && id) {
      const current = await db.barangay.findUnique({ where: { id } });
      if (!current) throw new Error("Barangay not found.");
      await db.barangay.update({ where: { id }, data: { isActive: !current.isActive } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "deleteBarangay" && id) {
      const inUse =
        (await db.zone.count({ where: { barangayId: id } })) +
        (await db.landmark.count({ where: { barangayId: id } })) +
        (await db.customerAddress.count({ where: { barangayId: id } }));
      if (inUse > 0) {
        return json<ActionData>(
          { ok: false, message: `Cannot delete. In use by ${inUse} record(s).` },
          { status: 400 }
        );
      }
      await db.barangay.delete({ where: { id } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "createZone") {
      const barangayId = Number(fd.get("barangayId"));
      const municipalityId = Number(fd.get("municipalityId"));
      const name = String(fd.get("name") || "").trim();
      if (!barangayId || !municipalityId || name.length < 1)
        throw new Error("Invalid inputs.");

      const barangay = await db.barangay.findFirst({
        where: { id: barangayId, municipalityId },
        select: { id: true },
      });
      if (!barangay) throw new Error("Selected barangay is invalid for this municipality.");

      await db.zone.create({ data: { name, barangayId, isActive: true } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "deleteZone" && id) {
      const used = await db.customerAddress.count({ where: { zoneId: id } });
      if (used > 0) {
        return json<ActionData>(
          { ok: false, message: `Cannot delete. Used by ${used} address(es).` },
          { status: 400 }
        );
      }
      await db.zone.delete({ where: { id } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "createLandmark") {
      const barangayId = Number(fd.get("barangayId"));
      const municipalityId = Number(fd.get("municipalityId"));
      const name = String(fd.get("name") || "").trim();
      if (!barangayId || !municipalityId || name.length < 2)
        throw new Error("Invalid inputs.");

      const barangay = await db.barangay.findFirst({
        where: { id: barangayId, municipalityId },
        select: { id: true },
      });
      if (!barangay) throw new Error("Selected barangay is invalid for this municipality.");

      await db.landmark.create({ data: { name, barangayId, isActive: true } });
      return json<ActionData>({ ok: true });
    }

    if (intent === "deleteLandmark" && id) {
      const used = await db.customerAddress.count({ where: { landmarkId: id } });
      if (used > 0) {
        return json<ActionData>(
          { ok: false, message: `Cannot delete. Used by ${used} address(es).` },
          { status: 400 }
        );
      }
      await db.landmark.delete({ where: { id } });
      return json<ActionData>({ ok: true });
    }

    return json<ActionData>({ ok: false, message: "Unknown intent." }, { status: 400 });
  } catch (e: any) {
    return json<ActionData>(
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

  const fetcher = useFetcher<ActionData>();
  const navigate = useNavigate();

  const [provinceSearch, setProvinceSearch] = React.useState("");
  const [municipalitySearch, setMunicipalitySearch] = React.useState("");
  const [barangaySearch, setBarangaySearch] = React.useState("");
  const [zoneSearch, setZoneSearch] = React.useState("");
  const [landmarkSearch, setLandmarkSearch] = React.useState("");

  const [municipalityName, setMunicipalityName] = React.useState("");
  const [barangayName, setBarangayName] = React.useState("");
  const [zoneName, setZoneName] = React.useState("");
  const [landmarkName, setLandmarkName] = React.useState("");

  const [editingMunicipality, setEditingMunicipality] = React.useState<BasicRow | null>(null);
  const [editingBarangay, setEditingBarangay] = React.useState<BasicRow | null>(null);
  const [editingMunicipalityName, setEditingMunicipalityName] = React.useState("");
  const [editingBarangayName, setEditingBarangayName] = React.useState("");
  const [workspace, setWorkspace] = React.useState<WorkspaceTab>("municipalities");

  React.useEffect(() => {
    if (!editingMunicipality) return;
    setEditingMunicipalityName(editingMunicipality.name);
  }, [editingMunicipality]);

  React.useEffect(() => {
    if (!editingBarangay) return;
    setEditingBarangayName(editingBarangay.name);
  }, [editingBarangay]);

  React.useEffect(() => {
    setEditingMunicipality(null);
    setEditingMunicipalityName("");
  }, [activeProvinceId]);

  React.useEffect(() => {
    setEditingBarangay(null);
    setEditingBarangayName("");
  }, [activeMunicipalityId]);

  React.useEffect(() => {
    if (!activeMunicipalityId && workspace !== "municipalities") {
      setWorkspace("municipalities");
      return;
    }
    if (!activeBarangayId && (workspace === "zones" || workspace === "landmarks")) {
      setWorkspace("barangays");
    }
  }, [activeMunicipalityId, activeBarangayId, workspace]);

  function qs(next: { pid?: number | null; mid?: number | null; bid?: number | null }) {
    const params = new URLSearchParams();
    const pid = next.pid === undefined ? activeProvinceId : next.pid;
    const mid = next.mid === undefined ? activeMunicipalityId : next.mid;
    const bid = next.bid === undefined ? activeBarangayId : next.bid;

    if (pid != null) params.set("pid", String(pid));
    if (mid != null) params.set("mid", String(mid));
    if (bid != null) params.set("bid", String(bid));

    return `?${params.toString()}`;
  }

  const filteredProvinces = filterRows(provinces, provinceSearch);
  const filteredMunicipalities = filterRows(municipalities, municipalitySearch);
  const filteredBarangays = filterRows(barangays, barangaySearch);
  const filteredZones = filterRows(zones, zoneSearch);
  const filteredLandmarks = filterRows(landmarks, landmarkSearch);

  const selectedProvinceName = activeProvinceId
    ? provinces.find((p) => p.id === activeProvinceId)?.name ?? "Unknown Province"
    : "None";
  const selectedMunicipalityName = activeMunicipalityId
    ? municipalities.find((m) => m.id === activeMunicipalityId)?.name ?? "Unknown Municipality"
    : "None";
  const selectedBarangayName = activeBarangayId
    ? barangays.find((b) => b.id === activeBarangayId)?.name ?? "Unknown Barangay"
    : "None";

  const workspaceTabs: Array<{ id: WorkspaceTab; label: string; enabled: boolean }> = [
    { id: "municipalities", label: "Municipalities", enabled: Boolean(activeProvinceId) },
    { id: "barangays", label: "Barangays", enabled: Boolean(activeMunicipalityId) },
    { id: "zones", label: "Zones", enabled: Boolean(activeBarangayId) },
    { id: "landmarks", label: "Landmarks", enabled: Boolean(activeBarangayId) },
  ];

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Creation - Areas"
        subtitle="Compact area hierarchy builder with one active workspace at a time."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        {fetcher.data?.message ? (
          <SoTAlert tone={fetcher.data.ok ? "success" : "danger"}>{fetcher.data.message}</SoTAlert>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <aside className="space-y-5 lg:col-span-4 lg:sticky lg:top-5 lg:self-start">
            <SoTCard interaction="form" className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Hierarchy Navigator</h2>

              <SoTFormField label="Province">
                <select
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  value={activeProvinceId ?? ""}
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    navigate(qs({ pid: value, mid: null, bid: null }));
                  }}
                >
                  {provinces.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </SoTFormField>

              <SoTFormField label="Municipality">
                <select
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  value={activeMunicipalityId ?? ""}
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    navigate(qs({ mid: value, bid: null }));
                  }}
                  disabled={!activeProvinceId || municipalities.length === 0}
                >
                  <option value="">Select municipality</option>
                  {municipalities.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </SoTFormField>

              <SoTFormField label="Barangay">
                <select
                  className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  value={activeBarangayId ?? ""}
                  onChange={(e) => {
                    const value = e.target.value ? Number(e.target.value) : null;
                    navigate(qs({ bid: value }));
                  }}
                  disabled={!activeMunicipalityId || barangays.length === 0}
                >
                  <option value="">Select barangay</option>
                  {barangays.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </SoTFormField>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p>
                  <span className="font-semibold text-slate-800">Current:</span> {selectedProvinceName}
                </p>
                <p>{selectedMunicipalityName}</p>
                <p>{selectedBarangayName}</p>
              </div>

              <Link
                to="/creation/areas"
                className="inline-flex h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
              >
                Reset Selection
              </Link>
            </SoTCard>

            <SoTEntityFormPanel title="Province Directory">
              <SoTInput
                label="Search"
                value={provinceSearch}
                placeholder="Search province"
                onChange={(e) => setProvinceSearch(e.target.value)}
              />

              <div className="mt-3 max-h-[260px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                <SoTTable>
                  <SoTTableHead>
                    <SoTTableRow>
                      <SoTTh>Province</SoTTh>
                      <SoTTh>Status</SoTTh>
                      <SoTTh align="right">Action</SoTTh>
                    </SoTTableRow>
                  </SoTTableHead>
                  <tbody>
                    {filteredProvinces.length === 0 ? (
                      <SoTTableEmptyRow colSpan={3} message="No provinces found." />
                    ) : (
                      filteredProvinces.map((province) => (
                        <SoTTableRow key={province.id}>
                          <SoTTd>
                            <Link
                              to={qs({ pid: province.id, mid: null, bid: null })}
                              className="font-medium text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                            >
                              {province.name}
                            </Link>
                          </SoTTd>
                          <SoTTd>
                            <StatusPill active={province.isActive} />
                          </SoTTd>
                          <SoTTd align="right">
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="toggleProvince" />
                              <input type="hidden" name="id" value={province.id} />
                              <SoTButton
                                type="submit"
                                variant="secondary"
                                className="h-8 px-2 py-0 text-xs"
                              >
                                {province.isActive ? "Disable" : "Enable"}
                              </SoTButton>
                            </fetcher.Form>
                          </SoTTd>
                        </SoTTableRow>
                      ))
                    )}
                  </tbody>
                </SoTTable>
              </div>
            </SoTEntityFormPanel>
          </aside>

          <section className="space-y-5 lg:col-span-8">
            <SoTCard interaction="static">
              <p className="text-sm font-semibold text-slate-900">Workspace</p>
              <p className="mt-1 text-xs text-slate-600">
                One section at a time. Select hierarchy first, then manage the active list.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {workspaceTabs.map((tab) => (
                  <SoTButton
                    key={tab.id}
                    type="button"
                    variant={workspace === tab.id ? "primary" : "secondary"}
                    className="h-8 px-2 py-0 text-xs"
                    disabled={!tab.enabled}
                    onClick={() => setWorkspace(tab.id)}
                  >
                    {tab.label}
                  </SoTButton>
                ))}
              </div>
            </SoTCard>

            {workspace === "municipalities" ? (
              <SoTEntityFormPanel title="Municipalities">
                {activeProvinceId ? (
                  <>
                    <p className="mb-3 text-xs text-slate-600">
                      Managing municipalities under <span className="font-semibold">{selectedProvinceName}</span>.
                    </p>

                    <fetcher.Form method="post" className="grid grid-cols-1 gap-2 md:grid-cols-12">
                      <input type="hidden" name="intent" value="createMunicipality" />
                      <input type="hidden" name="provinceId" value={activeProvinceId} />
                      <div className="md:col-span-9">
                        <SoTInput
                          name="name"
                          label="Add Municipality"
                          value={municipalityName}
                          placeholder="e.g. San Carlos City"
                          onChange={(e) => setMunicipalityName(e.target.value)}
                        />
                      </div>
                      <div className="md:col-span-3 md:flex md:items-end">
                        <SoTButton type="submit" className="w-full">
                          Add
                        </SoTButton>
                      </div>
                    </fetcher.Form>

                    {editingMunicipality ? (
                      <fetcher.Form method="post" className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-12">
                        <input type="hidden" name="intent" value="renameMunicipality" />
                        <input type="hidden" name="id" value={editingMunicipality.id} />
                        <div className="md:col-span-8">
                          <SoTInput
                            name="name"
                            label={`Edit #${editingMunicipality.id}`}
                            value={editingMunicipalityName}
                            onChange={(e) => setEditingMunicipalityName(e.target.value)}
                          />
                        </div>
                        <div className="md:col-span-4 flex items-end gap-2">
                          <SoTButton type="submit" className="w-full">
                            Update
                          </SoTButton>
                          <SoTButton
                            type="button"
                            variant="secondary"
                            className="w-full"
                            onClick={() => setEditingMunicipality(null)}
                          >
                            Cancel
                          </SoTButton>
                        </div>
                      </fetcher.Form>
                    ) : null}

                    <div className="mt-3">
                      <SoTInput
                        label="Search"
                        value={municipalitySearch}
                        placeholder="Search municipality"
                        onChange={(e) => setMunicipalitySearch(e.target.value)}
                      />
                    </div>

                    <div className="mt-3 max-h-[360px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                      <SoTTable>
                        <SoTTableHead>
                          <SoTTableRow>
                            <SoTTh>Municipality</SoTTh>
                            <SoTTh>Status</SoTTh>
                            <SoTTh align="right">Actions</SoTTh>
                          </SoTTableRow>
                        </SoTTableHead>
                        <tbody>
                          {filteredMunicipalities.length === 0 ? (
                            <SoTTableEmptyRow colSpan={3} message="No municipalities found." />
                          ) : (
                            filteredMunicipalities.map((municipality) => (
                              <SoTTableRow key={municipality.id}>
                                <SoTTd>
                                  <Link
                                    to={qs({ mid: municipality.id, bid: null })}
                                    className="font-medium text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                  >
                                    {municipality.name}
                                  </Link>
                                </SoTTd>
                                <SoTTd>
                                  <StatusPill active={municipality.isActive} />
                                </SoTTd>
                                <SoTTd align="right">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <SoTButton
                                      type="button"
                                      variant="secondary"
                                      className="h-8 px-2 py-0 text-xs"
                                      onClick={() => setEditingMunicipality(municipality)}
                                    >
                                      Edit
                                    </SoTButton>

                                    <fetcher.Form method="post">
                                      <input
                                        type="hidden"
                                        name="intent"
                                        value="toggleMunicipality"
                                      />
                                      <input type="hidden" name="id" value={municipality.id} />
                                      <SoTButton
                                        type="submit"
                                        variant="secondary"
                                        className="h-8 px-2 py-0 text-xs"
                                      >
                                        {municipality.isActive ? "Disable" : "Enable"}
                                      </SoTButton>
                                    </fetcher.Form>

                                    <fetcher.Form
                                      method="post"
                                      onSubmit={(e) => {
                                        if (!confirm(`Delete "${municipality.name}"?`)) {
                                          e.preventDefault();
                                        }
                                      }}
                                    >
                                      <input
                                        type="hidden"
                                        name="intent"
                                        value="deleteMunicipality"
                                      />
                                      <input type="hidden" name="id" value={municipality.id} />
                                      <SoTButton
                                        type="submit"
                                        variant="danger"
                                        className="h-8 px-2 py-0 text-xs"
                                      >
                                        Delete
                                      </SoTButton>
                                    </fetcher.Form>
                                  </div>
                                </SoTTd>
                              </SoTTableRow>
                            ))
                          )}
                        </tbody>
                      </SoTTable>
                    </div>
                  </>
                ) : (
                  <SoTAlert tone="info">Select a province first.</SoTAlert>
                )}
              </SoTEntityFormPanel>
            ) : null}

            {workspace === "barangays" ? (
              <SoTEntityFormPanel title="Barangays">
                {activeMunicipalityId ? (
                  <>
                    <p className="mb-3 text-xs text-slate-600">
                      Managing barangays under <span className="font-semibold">{selectedMunicipalityName}</span>.
                    </p>

                    <fetcher.Form method="post" className="grid grid-cols-1 gap-2 md:grid-cols-12">
                      <input type="hidden" name="intent" value="createBarangay" />
                      <input type="hidden" name="municipalityId" value={activeMunicipalityId} />
                      <input type="hidden" name="provinceId" value={activeProvinceId ?? ""} />
                      <div className="md:col-span-9">
                        <SoTInput
                          name="name"
                          label="Add Barangay"
                          value={barangayName}
                          placeholder="e.g. Poblacion"
                          onChange={(e) => setBarangayName(e.target.value)}
                        />
                      </div>
                      <div className="md:col-span-3 md:flex md:items-end">
                        <SoTButton type="submit" className="w-full">
                          Add
                        </SoTButton>
                      </div>
                    </fetcher.Form>

                    {editingBarangay ? (
                      <fetcher.Form method="post" className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-12">
                        <input type="hidden" name="intent" value="renameBarangay" />
                        <input type="hidden" name="id" value={editingBarangay.id} />
                        <div className="md:col-span-8">
                          <SoTInput
                            name="name"
                            label={`Edit #${editingBarangay.id}`}
                            value={editingBarangayName}
                            onChange={(e) => setEditingBarangayName(e.target.value)}
                          />
                        </div>
                        <div className="md:col-span-4 flex items-end gap-2">
                          <SoTButton type="submit" className="w-full">
                            Update
                          </SoTButton>
                          <SoTButton
                            type="button"
                            variant="secondary"
                            className="w-full"
                            onClick={() => setEditingBarangay(null)}
                          >
                            Cancel
                          </SoTButton>
                        </div>
                      </fetcher.Form>
                    ) : null}

                    <div className="mt-3">
                      <SoTInput
                        label="Search"
                        value={barangaySearch}
                        placeholder="Search barangay"
                        onChange={(e) => setBarangaySearch(e.target.value)}
                      />
                    </div>

                    <div className="mt-3 max-h-[360px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                      <SoTTable>
                        <SoTTableHead>
                          <SoTTableRow>
                            <SoTTh>Barangay</SoTTh>
                            <SoTTh>Status</SoTTh>
                            <SoTTh align="right">Actions</SoTTh>
                          </SoTTableRow>
                        </SoTTableHead>
                        <tbody>
                          {filteredBarangays.length === 0 ? (
                            <SoTTableEmptyRow colSpan={3} message="No barangays found." />
                          ) : (
                            filteredBarangays.map((barangay) => (
                              <SoTTableRow key={barangay.id}>
                                <SoTTd>
                                  <Link
                                    to={qs({ bid: barangay.id })}
                                    className="font-medium text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                                  >
                                    {barangay.name}
                                  </Link>
                                </SoTTd>
                                <SoTTd>
                                  <StatusPill active={barangay.isActive} />
                                </SoTTd>
                                <SoTTd align="right">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <SoTButton
                                      type="button"
                                      variant="secondary"
                                      className="h-8 px-2 py-0 text-xs"
                                      onClick={() => setEditingBarangay(barangay)}
                                    >
                                      Edit
                                    </SoTButton>

                                    <fetcher.Form method="post">
                                      <input type="hidden" name="intent" value="toggleBarangay" />
                                      <input type="hidden" name="id" value={barangay.id} />
                                      <SoTButton
                                        type="submit"
                                        variant="secondary"
                                        className="h-8 px-2 py-0 text-xs"
                                      >
                                        {barangay.isActive ? "Disable" : "Enable"}
                                      </SoTButton>
                                    </fetcher.Form>

                                    <fetcher.Form
                                      method="post"
                                      onSubmit={(e) => {
                                        if (!confirm(`Delete "${barangay.name}"?`)) {
                                          e.preventDefault();
                                        }
                                      }}
                                    >
                                      <input
                                        type="hidden"
                                        name="intent"
                                        value="deleteBarangay"
                                      />
                                      <input type="hidden" name="id" value={barangay.id} />
                                      <SoTButton
                                        type="submit"
                                        variant="danger"
                                        className="h-8 px-2 py-0 text-xs"
                                      >
                                        Delete
                                      </SoTButton>
                                    </fetcher.Form>
                                  </div>
                                </SoTTd>
                              </SoTTableRow>
                            ))
                          )}
                        </tbody>
                      </SoTTable>
                    </div>
                  </>
                ) : (
                  <SoTAlert tone="info">Select a municipality first.</SoTAlert>
                )}
              </SoTEntityFormPanel>
            ) : null}

            {workspace === "zones" ? (
              <SoTEntityFormPanel title="Zones">
                {activeBarangayId ? (
                  <>
                    <fetcher.Form method="post" className="grid grid-cols-1 gap-2 md:grid-cols-12">
                      <input type="hidden" name="intent" value="createZone" />
                      <input type="hidden" name="barangayId" value={activeBarangayId} />
                      <input
                        type="hidden"
                        name="municipalityId"
                        value={activeMunicipalityId ?? ""}
                      />
                      <div className="md:col-span-9">
                        <SoTInput
                          name="name"
                          label="Add Zone"
                          value={zoneName}
                          placeholder="e.g. Purok 4"
                          onChange={(e) => setZoneName(e.target.value)}
                        />
                      </div>
                      <div className="md:col-span-3 md:flex md:items-end">
                        <SoTButton type="submit" className="w-full">
                          Add
                        </SoTButton>
                      </div>
                    </fetcher.Form>

                    <div className="mt-3">
                      <SoTInput
                        label="Search"
                        value={zoneSearch}
                        placeholder="Search zone"
                        onChange={(e) => setZoneSearch(e.target.value)}
                      />
                    </div>

                    <div className="mt-3 max-h-[360px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                      <SoTTable>
                        <SoTTableHead>
                          <SoTTableRow>
                            <SoTTh>Zone</SoTTh>
                            <SoTTh align="right">Actions</SoTTh>
                          </SoTTableRow>
                        </SoTTableHead>
                        <tbody>
                          {filteredZones.length === 0 ? (
                            <SoTTableEmptyRow colSpan={2} message="No zones found." />
                          ) : (
                            filteredZones.map((zone) => (
                              <SoTTableRow key={zone.id}>
                                <SoTTd>
                                  <span className="font-medium text-slate-900">{zone.name}</span>
                                </SoTTd>
                                <SoTTd align="right">
                                  <fetcher.Form
                                    method="post"
                                    onSubmit={(e) => {
                                      if (!confirm(`Delete "${zone.name}"?`)) {
                                        e.preventDefault();
                                      }
                                    }}
                                  >
                                    <input type="hidden" name="intent" value="deleteZone" />
                                    <input type="hidden" name="id" value={zone.id} />
                                    <SoTButton
                                      type="submit"
                                      variant="danger"
                                      className="h-8 px-2 py-0 text-xs"
                                    >
                                      Delete
                                    </SoTButton>
                                  </fetcher.Form>
                                </SoTTd>
                              </SoTTableRow>
                            ))
                          )}
                        </tbody>
                      </SoTTable>
                    </div>
                  </>
                ) : (
                  <SoTAlert tone="info">Select a barangay first.</SoTAlert>
                )}
              </SoTEntityFormPanel>
            ) : null}

            {workspace === "landmarks" ? (
              <SoTEntityFormPanel title="Landmarks">
                {activeBarangayId ? (
                  <>
                    <fetcher.Form method="post" className="grid grid-cols-1 gap-2 md:grid-cols-12">
                      <input type="hidden" name="intent" value="createLandmark" />
                      <input type="hidden" name="barangayId" value={activeBarangayId} />
                      <input
                        type="hidden"
                        name="municipalityId"
                        value={activeMunicipalityId ?? ""}
                      />
                      <div className="md:col-span-9">
                        <SoTInput
                          name="name"
                          label="Add Landmark"
                          value={landmarkName}
                          placeholder="e.g. Public Market"
                          onChange={(e) => setLandmarkName(e.target.value)}
                        />
                      </div>
                      <div className="md:col-span-3 md:flex md:items-end">
                        <SoTButton type="submit" className="w-full">
                          Add
                        </SoTButton>
                      </div>
                    </fetcher.Form>

                    <div className="mt-3">
                      <SoTInput
                        label="Search"
                        value={landmarkSearch}
                        placeholder="Search landmark"
                        onChange={(e) => setLandmarkSearch(e.target.value)}
                      />
                    </div>

                    <div className="mt-3 max-h-[360px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                      <SoTTable>
                        <SoTTableHead>
                          <SoTTableRow>
                            <SoTTh>Landmark</SoTTh>
                            <SoTTh align="right">Actions</SoTTh>
                          </SoTTableRow>
                        </SoTTableHead>
                        <tbody>
                          {filteredLandmarks.length === 0 ? (
                            <SoTTableEmptyRow colSpan={2} message="No landmarks found." />
                          ) : (
                            filteredLandmarks.map((landmark) => (
                              <SoTTableRow key={landmark.id}>
                                <SoTTd>
                                  <span className="font-medium text-slate-900">{landmark.name}</span>
                                </SoTTd>
                                <SoTTd align="right">
                                  <fetcher.Form
                                    method="post"
                                    onSubmit={(e) => {
                                      if (!confirm(`Delete "${landmark.name}"?`)) {
                                        e.preventDefault();
                                      }
                                    }}
                                  >
                                    <input
                                      type="hidden"
                                      name="intent"
                                      value="deleteLandmark"
                                    />
                                    <input type="hidden" name="id" value={landmark.id} />
                                    <SoTButton
                                      type="submit"
                                      variant="danger"
                                      className="h-8 px-2 py-0 text-xs"
                                    >
                                      Delete
                                    </SoTButton>
                                  </fetcher.Form>
                                </SoTTd>
                              </SoTTableRow>
                            ))
                          )}
                        </tbody>
                      </SoTTable>
                    </div>
                  </>
                ) : (
                  <SoTAlert tone="info">Select a barangay first.</SoTAlert>
                )}
              </SoTEntityFormPanel>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function filterRows<T extends { name: string }>(rows: T[], query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(keyword));
}
