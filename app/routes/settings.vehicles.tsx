/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { VehicleType } from "@prisma/client";
import { requireRole } from "~/utils/auth.server";

const LPG_TANK_NET_KG = 11;
function computeLpgSlots(capKg: number) {
  return Math.floor((capKg || 0) / LPG_TANK_NET_KG);
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const vehicles = await db.vehicle.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      capacityProfiles: {
        where: { key: "TAG:LPG" },
        select: { id: true, key: true, maxUnits: true },
      },
    },
  });
  return json({ vehicles, vehicleTypes: Object.keys(VehicleType) });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  try {
    if (intent === "create") {
      const name = String(fd.get("name") || "").trim();
      const type = String(fd.get("type") || "") as keyof typeof VehicleType;
      const capacityUnits = Number(fd.get("capacityUnits"));
      const notes = String(fd.get("notes") || "").trim() || null;
      if (!name || !type || !Number.isFinite(capacityUnits)) {
        throw new Error("Invalid inputs.");
      }
      const v = await db.vehicle.create({
        data: { name, type, capacityUnits, notes, active: true },
      });
      await db.vehicleCapacityProfile.upsert({
        where: { vehicleId_key: { vehicleId: v.id, key: "TAG:LPG" } },
        update: { maxUnits: computeLpgSlots(capacityUnits) },
        create: {
          vehicleId: v.id,
          key: "TAG:LPG",
          maxUnits: computeLpgSlots(capacityUnits),
        },
      });
      return json({ ok: true });
    }
    if (intent === "update") {
      const id = Number(fd.get("id"));
      const name = String(fd.get("name") || "").trim();
      const type = String(fd.get("type") || "") as keyof typeof VehicleType;
      const capacityUnits = Number(fd.get("capacityUnits"));
      const notes = String(fd.get("notes") || "").trim() || null;
      if (!Number.isFinite(id)) throw new Error("Invalid id.");
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
      return json({ ok: true });
    }
    if (intent === "toggle") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id)) throw new Error("Invalid id.");
      const cur = await db.vehicle.findUnique({ where: { id } });
      if (!cur) throw new Error("Not found");
      await db.vehicle.update({
        where: { id },
        data: { active: !cur.active },
      });
      return json({ ok: true });
    }
    if (intent === "delete") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id)) throw new Error("Invalid id.");
      // Guard lightly: make sure no employee is defaulting to this vehicle
      const riders = await db.employee.count({
        where: { defaultVehicleId: id },
      });
      if (riders > 0) {
        return json(
          { ok: false, message: `Cannot delete. Used by ${riders} rider(s).` },
          { status: 400 }
        );
      }
      await db.vehicleCapacityProfile.deleteMany({ where: { vehicleId: id } });
      await db.vehicle.delete({ where: { id } });
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

export default function VehiclesPage() {
  const { vehicles, vehicleTypes } = useLoaderData<typeof loader>();
  const f = useFetcher<{ ok?: boolean; message?: string }>();
  const [form, setForm] = React.useState({
    name: "",
    type: vehicleTypes[0] ?? "TRICYCLE",
    capacityUnits: 150,
    notes: "",
  });

  // A11y ids for create form controls
  const nameId = React.useId();
  const typeId = React.useId();
  const capId = React.useId();
  const notesId = React.useId();

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-900">
            Settings — Vehicles
          </h1>
          <Link to="/settings" className="text-sm underline">
            ← Back
          </Link>
        </header>

        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800 mb-3">
            Add Vehicle
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
            <div className="md:col-span-4">
              <label htmlFor={nameId} className="text-sm">
                Name
              </label>
              <input
                id={nameId}
                className="mt-1 w-full border rounded-md px-2 py-1"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <label htmlFor={typeId} className="text-sm">
                Type
              </label>
              <select
                id={typeId}
                className="mt-1 w-full border rounded-md px-2 py-1"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {vehicleTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label htmlFor={capId} className="text-sm">
                Capacity (kg)
              </label>
              <input
                id={capId}
                type="number"
                className="mt-1 w-full border rounded-md px-2 py-1"
                value={form.capacityUnits}
                onChange={(e) =>
                  setForm({ ...form, capacityUnits: Number(e.target.value) })
                }
              />
              <p className="text-xs text-slate-500 mt-1">
                LPG slots ≈ {computeLpgSlots(Number(form.capacityUnits) || 0)}
              </p>
            </div>
            <div className="md:col-span-2">
              <label htmlFor={notesId} className="text-sm">
                Notes
              </label>
              <input
                id={notesId}
                className="mt-1 w-full border rounded-md px-2 py-1"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="md:col-span-12">
              <f.Form method="post" className="flex justify-end">
                <input type="hidden" name="intent" value="create" />
                <input type="hidden" name="name" value={form.name} />
                <input type="hidden" name="type" value={form.type} />
                <input
                  type="hidden"
                  name="capacityUnits"
                  value={String(form.capacityUnits)}
                />
                <input type="hidden" name="notes" value={form.notes} />
                <button className="rounded-md bg-indigo-600 text-white px-3 py-2 text-sm">
                  Add
                </button>
              </f.Form>
              {f.data && f.data.message ? (
                <p className="mt-2 text-sm text-rose-700">{f.data.message}</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-0 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-medium text-slate-800">
            Vehicles ({vehicles.length})
          </div>
          <div className="divide-y">
            {vehicles.map((v) => (
              <VehicleRow key={v.id} v={v} />
            ))}
            {vehicles.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No vehicles yet.</div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function VehicleRow({ v }: { v: any }) {
  const f = useFetcher<{ ok?: boolean; message?: string }>();
  const [edit, setEdit] = React.useState(false);
  const [form, setForm] = React.useState({
    name: v.name,
    type: v.type,
    capacityUnits: v.capacityUnits,
    notes: v.notes ?? "",
  });
  const lpgSlots = (v.capacityProfiles?.[0]?.maxUnits ??
    Math.floor((v.capacityUnits || 0) / 11)) as number;

  // A11y ids per row edit controls
  const rowNameId = React.useId();
  const rowTypeId = React.useId();
  const rowCapId = React.useId();
  const rowNotesId = React.useId();

  return (
    <div className="px-4 py-3 grid grid-cols-12 gap-2 items-center">
      {/* name/type */}
      <div className="col-span-4">
        {edit ? (
          <div className="grid grid-cols-2 gap-2">
            <label htmlFor={rowNameId} className="sr-only">
              Name
            </label>
            <input
              id={rowNameId}
              className="border rounded-md px-2 py-1"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <label htmlFor={rowTypeId} className="sr-only">
              Type
            </label>
            <select
              id={rowTypeId}
              className="border rounded-md px-2 py-1"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {Object.keys(VehicleType).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="font-medium text-slate-900">
            {v.name} <span className="text-xs text-slate-500">· {v.type}</span>
          </div>
        )}
      </div>
      {/* cap/slots */}
      <div className="col-span-3">
        {edit ? (
          <div>
            <label htmlFor={rowCapId} className="text-xs text-slate-600">
              Capacity (kg)
            </label>
            <input
              id={rowCapId}
              type="number"
              className="w-full border rounded-md px-2 py-1"
              value={form.capacityUnits}
              onChange={(e) =>
                setForm({ ...form, capacityUnits: Number(e.target.value) })
              }
            />
            <p className="text-xs text-slate-500 mt-1">
              LPG slots ≈ {computeLpgSlots(Number(form.capacityUnits) || 0)}
            </p>
          </div>
        ) : (
          <div className="text-sm">
            {v.capacityUnits} kg ·{" "}
            <span className="text-slate-500">LPG slots {lpgSlots}</span>
          </div>
        )}
      </div>
      {/* notes */}
      <div className="col-span-3">
        {edit ? (
          <>
            <label htmlFor={rowNotesId} className="sr-only">
              Notes
            </label>
            <input
              id={rowNotesId}
              className="w-full border rounded-md px-2 py-1"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </>
        ) : (
          <div className="text-sm text-slate-600">{v.notes ?? "—"}</div>
        )}
      </div>
      {/* actions */}
      <div className="col-span-2 flex items-center justify-end gap-2">
        {edit ? (
          <>
            <f.Form method="post">
              <input type="hidden" name="intent" value="update" />
              <input type="hidden" name="id" value={v.id} />
              <input type="hidden" name="name" value={form.name} />
              <input type="hidden" name="type" value={form.type} />
              <input
                type="hidden"
                name="capacityUnits"
                value={String(form.capacityUnits)}
              />
              <input type="hidden" name="notes" value={form.notes} />
              <button
                className="rounded-md bg-indigo-600 text-white px-3 py-1 text-sm"
                type="submit"
              >
                Save
              </button>
            </f.Form>
            <button
              className="text-sm underline"
              onClick={() => setEdit(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="text-sm underline" onClick={() => setEdit(true)}>
              Edit
            </button>
            <f.Form method="post">
              <input type="hidden" name="intent" value="toggle" />
              <input type="hidden" name="id" value={v.id} />
              <button
                className="rounded-md border px-3 py-1 text-sm"
                type="submit"
              >
                {v.active ? "Disable" : "Enable"}
              </button>
            </f.Form>
            <f.Form
              method="post"
              onSubmit={(e) => {
                if (!confirm(`Delete "${v.name}"?`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={v.id} />
              <button className="text-sm text-rose-600 underline" type="submit">
                Delete
              </button>
            </f.Form>
          </>
        )}
      </div>
    </div>
  );
}
