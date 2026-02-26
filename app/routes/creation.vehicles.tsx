/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { VehicleType } from "@prisma/client";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import * as React from "react";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTEntityFormPanel } from "~/components/ui/SoTEntityFormPanel";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTListToolbar } from "~/components/ui/SoTListToolbar";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTPagedTableFooter } from "~/components/ui/SoTPagedTableFooter";
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

const PAGE_SIZE = 12;
const LPG_TANK_NET_KG = 11;

type StatusFilter = "all" | "active" | "inactive";

type VehicleRow = {
  id: number;
  name: string;
  type: VehicleType;
  capacityUnits: number;
  notes: string | null;
  active: boolean;
  capacityProfiles: { id: number; key: string; maxUnits: number }[];
};

type ActionData =
  | { ok: true; action: string; id?: number }
  | { ok: false; error: string };

function parseStatus(value: string | null): StatusFilter {
  if (value === "active" || value === "inactive") return value;
  return "all";
}

function parsePage(value: string | null) {
  const parsed = Number(value ?? "1");
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function computeLpgSlots(capKg: number) {
  return Math.floor((capKg || 0) / LPG_TANK_NET_KG);
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const status = parseStatus(url.searchParams.get("status"));
  const requestedPage = parsePage(url.searchParams.get("page"));

  const where: Record<string, unknown> = {};

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { type: { equals: q as VehicleType } },
    ];
  }
  if (status === "active") where.active = true;
  if (status === "inactive") where.active = false;

  const total = await db.vehicle.count({ where: where as any });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const vehicles = await db.vehicle.findMany({
    where: where as any,
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      capacityProfiles: {
        where: { key: "TAG:LPG" },
        select: { id: true, key: true, maxUnits: true },
      },
    },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return json({
    vehicles: vehicles as VehicleRow[],
    vehicleTypes: Object.keys(VehicleType),
    q,
    status,
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]);
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");

  try {
    if (intent === "create") {
      const name = String(fd.get("name") || "").trim();
      const type = String(fd.get("type") || "") as keyof typeof VehicleType;
      const capacityUnits = Number(fd.get("capacityUnits"));
      const notes = String(fd.get("notes") || "").trim() || null;

      if (!name || !type || !Number.isFinite(capacityUnits) || capacityUnits <= 0) {
        return json<ActionData>(
          { ok: false, error: "Name, type, and valid capacity are required." },
          { status: 400 }
        );
      }

      const created = await db.vehicle.create({
        data: { name, type, capacityUnits, notes, active: true },
      });

      await db.vehicleCapacityProfile.upsert({
        where: { vehicleId_key: { vehicleId: created.id, key: "TAG:LPG" } },
        update: { maxUnits: computeLpgSlots(capacityUnits) },
        create: {
          vehicleId: created.id,
          key: "TAG:LPG",
          maxUnits: computeLpgSlots(capacityUnits),
        },
      });

      return json<ActionData>({ ok: true, action: "create", id: created.id });
    }

    if (intent === "update") {
      const id = Number(fd.get("id"));
      const name = String(fd.get("name") || "").trim();
      const type = String(fd.get("type") || "") as keyof typeof VehicleType;
      const capacityUnits = Number(fd.get("capacityUnits"));
      const notes = String(fd.get("notes") || "").trim() || null;

      if (!Number.isFinite(id)) {
        return json<ActionData>({ ok: false, error: "Invalid id." }, { status: 400 });
      }
      if (!name || !type || !Number.isFinite(capacityUnits) || capacityUnits <= 0) {
        return json<ActionData>(
          { ok: false, error: "Name, type, and valid capacity are required." },
          { status: 400 }
        );
      }

      await db.vehicle.update({
        where: { id },
        data: { name, type, capacityUnits, notes },
      });

      await db.vehicleCapacityProfile.upsert({
        where: { vehicleId_key: { vehicleId: id, key: "TAG:LPG" } },
        update: { maxUnits: computeLpgSlots(capacityUnits) },
        create: {
          vehicleId: id,
          key: "TAG:LPG",
          maxUnits: computeLpgSlots(capacityUnits),
        },
      });

      return json<ActionData>({ ok: true, action: "update", id });
    }

    if (intent === "toggle") {
      const id = Number(fd.get("id"));
      const valRaw = fd.get("value");

      if (!Number.isFinite(id)) {
        return json<ActionData>({ ok: false, error: "Invalid id." }, { status: 400 });
      }

      if (valRaw != null) {
        await db.vehicle.update({
          where: { id },
          data: { active: String(valRaw) === "true" },
        });
        return json<ActionData>({ ok: true, action: "toggle", id });
      }

      const current = await db.vehicle.findUnique({ where: { id } });
      if (!current) {
        return json<ActionData>({ ok: false, error: "Vehicle not found." }, { status: 404 });
      }

      await db.vehicle.update({
        where: { id },
        data: { active: !current.active },
      });
      return json<ActionData>({ ok: true, action: "toggle", id });
    }

    if (intent === "delete") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id)) {
        return json<ActionData>({ ok: false, error: "Invalid id." }, { status: 400 });
      }

      const riders = await db.employee.count({ where: { defaultVehicleId: id } });
      if (riders > 0) {
        return json<ActionData>(
          { ok: false, error: `Cannot delete. Used by ${riders} rider(s).` },
          { status: 400 }
        );
      }

      await db.vehicleCapacityProfile.deleteMany({ where: { vehicleId: id } });
      await db.vehicle.delete({ where: { id } });
      return json<ActionData>({ ok: true, action: "delete", id });
    }

    return json<ActionData>({ ok: false, error: "Unknown intent." }, { status: 400 });
  } catch (e: any) {
    return json<ActionData>(
      { ok: false, error: e?.message ?? "Operation failed." },
      { status: 500 }
    );
  }
}

export default function VehiclesPage() {
  const { vehicles, vehicleTypes, q, status, page, pageSize, total, totalPages } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = React.useState(false);
  const [createForm, setCreateForm] = React.useState({
    name: "",
    type: vehicleTypes[0] ?? "TRICYCLE",
    capacityUnits: "150",
    notes: "",
  });

  const [editing, setEditing] = React.useState<VehicleRow | null>(null);
  const [editForm, setEditForm] = React.useState({
    name: "",
    type: vehicleTypes[0] ?? "TRICYCLE",
    capacityUnits: "150",
    notes: "",
  });

  React.useEffect(() => {
    if (!editing) return;
    setEditForm({
      name: editing.name,
      type: editing.type,
      capacityUnits: String(editing.capacityUnits),
      notes: editing.notes ?? "",
    });
  }, [editing]);

  function gotoPage(nextPage: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    params.set("page", String(nextPage));
    navigate(`?${params.toString()}`);
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <main className="min-h-screen bg-[#f7f7fb]">
      <SoTNonDashboardHeader
        title="Creation - Vehicles"
        subtitle="Scalable vehicle master list for dispatch and rider assignment."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        <SoTCard interaction="static">
          <SoTListToolbar
            query={q}
            status={status}
            resetTo="/creation/vehicles"
            addOpen={showCreate}
            onToggleAdd={() => setShowCreate((value) => !value)}
            addLabel="Add Vehicle"
            searchPlaceholder="Search vehicle"
          />
          <SoTAlert tone="info">Showing {start}-{end} of {total} vehicle entries.</SoTAlert>
        </SoTCard>

        {showCreate ? (
          <SoTEntityFormPanel title="Create Vehicle">
            <fetcher.Form method="post" className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <input type="hidden" name="intent" value="create" />

              <div className="md:col-span-4">
                <SoTInput
                  name="name"
                  label="Vehicle Name"
                  placeholder="e.g. Unit 04"
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>

              <div className="md:col-span-3">
                <SoTFormField label="Type">
                  <select
                    name="type"
                    value={createForm.type}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, type: e.target.value }))
                    }
                    className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    {vehicleTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </SoTFormField>
              </div>

              <div className="md:col-span-2">
                <SoTInput
                  name="capacityUnits"
                  label="Capacity (kg)"
                  type="number"
                  min={1}
                  value={createForm.capacityUnits}
                  onChange={(e) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      capacityUnits: e.target.value,
                    }))
                  }
                />
                <p className="mt-1 text-xs text-slate-500">
                  LPG slots ≈ {computeLpgSlots(Number(createForm.capacityUnits) || 0)}
                </p>
              </div>

              <div className="md:col-span-3">
                <SoTInput
                  name="notes"
                  label="Notes"
                  placeholder="Optional"
                  value={createForm.notes}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                />
              </div>

              <div className="md:col-span-12 flex justify-end">
                <SoTButton type="submit" variant="primary">
                  Save Vehicle
                </SoTButton>
              </div>
            </fetcher.Form>
          </SoTEntityFormPanel>
        ) : null}

        {editing ? (
          <SoTEntityFormPanel title={`Edit Vehicle #${editing.id}`}>
            <fetcher.Form method="post" className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <input type="hidden" name="intent" value="update" />
              <input type="hidden" name="id" value={editing.id} />

              <div className="md:col-span-4">
                <SoTInput
                  name="name"
                  label="Vehicle Name"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>

              <div className="md:col-span-3">
                <SoTFormField label="Type">
                  <select
                    name="type"
                    value={editForm.type}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, type: e.target.value }))
                    }
                    className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    {vehicleTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </SoTFormField>
              </div>

              <div className="md:col-span-2">
                <SoTInput
                  name="capacityUnits"
                  label="Capacity (kg)"
                  type="number"
                  min={1}
                  value={editForm.capacityUnits}
                  onChange={(e) =>
                    setEditForm((prev) => ({
                      ...prev,
                      capacityUnits: e.target.value,
                    }))
                  }
                />
                <p className="mt-1 text-xs text-slate-500">
                  LPG slots ≈ {computeLpgSlots(Number(editForm.capacityUnits) || 0)}
                </p>
              </div>

              <div className="md:col-span-3">
                <SoTInput
                  name="notes"
                  label="Notes"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                />
              </div>

              <div className="md:col-span-12 flex flex-wrap justify-end gap-2">
                <SoTButton type="submit" variant="primary">
                  Update Vehicle
                </SoTButton>
                <SoTButton
                  type="button"
                  variant="secondary"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </SoTButton>
              </div>
            </fetcher.Form>
          </SoTEntityFormPanel>
        ) : null}

        {fetcher.data && !fetcher.data.ok ? (
          <SoTAlert tone="danger">{fetcher.data.error}</SoTAlert>
        ) : null}

        <SoTCard interaction="static" className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Vehicle Directory
            </h2>
          </div>

          <SoTTable>
            <SoTTableHead>
              <SoTTableRow>
                <SoTTh>Name</SoTTh>
                <SoTTh>Type</SoTTh>
                <SoTTh align="right">Capacity</SoTTh>
                <SoTTh align="right">LPG Slots</SoTTh>
                <SoTTh>Notes</SoTTh>
                <SoTTh>Status</SoTTh>
                <SoTTh align="right">Actions</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {vehicles.length === 0 ? (
                <SoTTableEmptyRow colSpan={7} message="No vehicles found." />
              ) : (
                vehicles.map((vehicle) => {
                  const lpgSlots =
                    vehicle.capacityProfiles?.[0]?.maxUnits ??
                    computeLpgSlots(vehicle.capacityUnits);

                  return (
                    <SoTTableRow key={vehicle.id}>
                      <SoTTd>
                        <span className="font-medium text-slate-900">{vehicle.name}</span>
                      </SoTTd>
                      <SoTTd>{vehicle.type}</SoTTd>
                      <SoTTd align="right" className="font-mono tabular-nums">
                        {vehicle.capacityUnits} kg
                      </SoTTd>
                      <SoTTd align="right" className="font-mono tabular-nums">
                        {lpgSlots}
                      </SoTTd>
                      <SoTTd>
                        <span className="text-slate-600">{vehicle.notes ?? "-"}</span>
                      </SoTTd>
                      <SoTTd>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            vehicle.active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {vehicle.active ? "Active" : "Inactive"}
                        </span>
                      </SoTTd>
                      <SoTTd align="right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <SoTButton
                            type="button"
                            variant="secondary"
                            className="h-8 px-2 py-0 text-xs"
                            onClick={() => setEditing(vehicle)}
                          >
                            Edit
                          </SoTButton>

                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="toggle" />
                            <input type="hidden" name="id" value={vehicle.id} />
                            <input
                              type="hidden"
                              name="value"
                              value={String(!vehicle.active)}
                            />
                            <SoTButton
                              type="submit"
                              variant="secondary"
                              className="h-8 px-2 py-0 text-xs"
                            >
                              {vehicle.active ? "Disable" : "Enable"}
                            </SoTButton>
                          </fetcher.Form>

                          <fetcher.Form
                            method="post"
                            onSubmit={(e) => {
                              if (!confirm(`Delete "${vehicle.name}"?`)) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={vehicle.id} />
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
                  );
                })
              )}
            </tbody>
          </SoTTable>

          <SoTPagedTableFooter
            page={page}
            totalPages={totalPages}
            onPrev={() => gotoPage(page - 1)}
            onNext={() => gotoPage(page + 1)}
          />
        </SoTCard>
      </div>
    </main>
  );
}
