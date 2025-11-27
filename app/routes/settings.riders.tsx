/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import * as React from "react";
import { db } from "~/utils/db.server";
import { EmployeeRole } from "@prisma/client";
import { requireRole } from "~/utils/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard
  const [riders, vehicles] = await Promise.all([
    db.employee.findMany({
      where: { role: EmployeeRole.RIDER },
      orderBy: [{ active: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
      include: {
        defaultVehicle: { select: { id: true, name: true, type: true } },
      },
    }),
    db.vehicle.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
  ]);
  return json({ riders, vehicles });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["ADMIN"]); // 🔒 guard for writes
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "");
  try {
    if (intent === "create") {
      const firstName = String(fd.get("firstName") || "").trim();
      const lastName = String(fd.get("lastName") || "").trim();
      const alias = (String(fd.get("alias") || "").trim() || null) as
        | string
        | null;
      const phone = String(fd.get("phone") || "").trim();
      const email = (String(fd.get("email") || "").trim() || null) as
        | string
        | null;
      const defaultVehicleId =
        fd.get("defaultVehicleId") && String(fd.get("defaultVehicleId")).length
          ? Number(fd.get("defaultVehicleId"))
          : null;
      if (!firstName || !lastName || !phone)
        throw new Error("Missing required fields.");
      await db.employee.create({
        data: {
          firstName,
          lastName,
          alias,
          phone,
          email,
          role: EmployeeRole.RIDER,
          active: true,
          defaultVehicleId: defaultVehicleId || null,
        },
      });
      return json({ ok: true });
    }
    if (intent === "update") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id)) throw new Error("Invalid id.");
      const firstName = String(fd.get("firstName") || "").trim();
      const lastName = String(fd.get("lastName") || "").trim();
      const alias = (String(fd.get("alias") || "").trim() || null) as
        | string
        | null;
      const phone = String(fd.get("phone") || "").trim();
      const email = (String(fd.get("email") || "").trim() || null) as
        | string
        | null;
      const defaultVehicleId =
        fd.get("defaultVehicleId") && String(fd.get("defaultVehicleId")).length
          ? Number(fd.get("defaultVehicleId"))
          : null;
      await db.employee.update({
        where: { id },
        data: {
          firstName,
          lastName,
          alias,
          phone,
          email,
          defaultVehicleId: defaultVehicleId || null,
        },
      });
      return json({ ok: true });
    }
    if (intent === "toggle") {
      const id = Number(fd.get("id"));
      const cur = await db.employee.findUnique({ where: { id } });
      if (!cur) throw new Error("Rider not found");
      await db.employee.update({
        where: { id },
        data: { active: !cur.active },
      });
      return json({ ok: true });
    }
    if (intent === "delete") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id)) throw new Error("Invalid id.");
      // Light safety: if used by delivery runs, DB will block; catch and message out.
      try {
        await db.employee.delete({ where: { id } });
        return json({ ok: true });
      } catch (e: any) {
        return json(
          {
            ok: false,
            message: "Cannot delete. Rider is referenced by other records.",
          },
          { status: 400 }
        );
      }
    }
    return json({ ok: false, message: "Unknown intent." }, { status: 400 });
  } catch (e: any) {
    return json(
      { ok: false, message: e?.message ?? "Operation failed." },
      { status: 500 }
    );
  }
}

export default function RidersPage() {
  const { riders, vehicles } = useLoaderData<typeof loader>();
  const f = useFetcher<{ ok?: boolean; message?: string }>();
  const [form, setForm] = React.useState<{
    firstName: string;
    lastName: string;
    alias: string;
    phone: string;
    email: string;
    defaultVehicleId: number | "";
  }>({
    firstName: "",
    lastName: "",
    alias: "",
    phone: "",
    email: "",
    defaultVehicleId: vehicles[0]?.id ?? "",
  });

  const vehicleSelectId = React.useId();

  return (
    <main className="min-h-screen bg-[#f7f7fb] p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold text-slate-900">
            Settings — Riders
          </h1>
          <Link to="/settings" className="text-sm underline">
            ← Back
          </Link>
        </header>

        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800 mb-3">Add Rider</h2>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
            <Input
              label="First name"
              value={form.firstName}
              onChange={(v) => setForm({ ...form, firstName: v })}
              span={3}
            />
            <Input
              label="Last name"
              value={form.lastName}
              onChange={(v) => setForm({ ...form, lastName: v })}
              span={3}
            />
            <Input
              label="Alias"
              value={form.alias}
              onChange={(v) => setForm({ ...form, alias: v })}
              span={2}
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
              span={2}
            />
            <Input
              label="Email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              span={2}
            />
            <div className="md:col-span-2">
              <label htmlFor={vehicleSelectId} className="text-sm">
                Default Vehicle
              </label>
              <select
                id={vehicleSelectId}
                className="mt-1 w-full border rounded-md px-2 py-1"
                value={form.defaultVehicleId}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm({
                    ...form,
                    defaultVehicleId: val === "" ? "" : Number(val),
                  });
                }}
              >
                <option value="">—</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.type}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-12 flex justify-end">
              <f.Form method="post">
                <input type="hidden" name="intent" value="create" />
                {Object.entries(form).map(([k, v]) => (
                  <input
                    key={k}
                    type="hidden"
                    name={k}
                    value={String(v ?? "")}
                  />
                ))}
                <button
                  className="rounded-md bg-indigo-600 text-white px-3 py-2 text-sm"
                  type="submit"
                >
                  Add
                </button>
              </f.Form>
            </div>
          </div>
          {f.data?.message ? (
            <p className="mt-2 text-sm text-rose-700">{f.data.message}</p>
          ) : null}
        </section>

        <section className="rounded-xl border bg-white p-0 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-medium text-slate-800">
            Riders ({riders.length})
          </div>
          <div className="divide-y">
            {riders.map((r) => (
              <RiderRow key={r.id} r={r} vehicles={vehicles} />
            ))}
            {riders.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No riders yet.</div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function Input(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  span?: number;
}) {
  const id = React.useId();
  return (
    <div className={`md:col-span-${props.span ?? 3}`}>
      <label htmlFor={id} className="text-sm">
        {props.label}
      </label>
      <input
        className="mt-1 w-full border rounded-md px-2 py-1"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-label={props.label}
      />
    </div>
  );
}

function RiderRow({
  r,
  vehicles,
}: {
  r: any;
  vehicles: { id: number; name: string; type: string }[];
}) {
  const f = useFetcher<{ ok?: boolean; message?: string }>();
  const [edit, setEdit] = React.useState(false);
  const [form, setForm] = React.useState({
    firstName: r.firstName,
    lastName: r.lastName,
    alias: r.alias ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    defaultVehicleId: r.defaultVehicle?.id ?? "",
  });

  const dvSelectId = React.useId();

  return (
    <div className="px-4 py-3 grid grid-cols-12 gap-2 items-center">
      <div className="col-span-4">
        {edit ? (
          <div className="grid grid-cols-2 gap-2">
            <input
              className="border rounded-md px-2 py-1"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              aria-label="First name"
            />
            <input
              className="border rounded-md px-2 py-1"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              aria-label="Last name"
            />
          </div>
        ) : (
          <div className="font-medium text-slate-900">
            {r.lastName}, {r.firstName}{" "}
            {r.alias ? (
              <span className="text-xs text-slate-500">({r.alias})</span>
            ) : null}
          </div>
        )}
      </div>
      <div className="col-span-4 text-sm">
        {edit ? (
          <div className="grid grid-cols-3 gap-2">
            <input
              className="border rounded-md px-2 py-1"
              placeholder="Alias"
              value={form.alias}
              onChange={(e) => setForm({ ...form, alias: e.target.value })}
              aria-label="Alias"
            />
            <input
              className="border rounded-md px-2 py-1"
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              aria-label="Phone"
            />
            <input
              className="border rounded-md px-2 py-1"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              aria-label="Email"
            />
          </div>
        ) : (
          <div className="text-slate-600">
            {r.phone ?? "—"} · {r.email ?? "—"}
          </div>
        )}
      </div>
      <div className="col-span-2">
        {edit ? (
          <>
            <label htmlFor={dvSelectId} className="sr-only">
              Default Vehicle
            </label>
            <select
              id={dvSelectId}
              className="w-full border rounded-md px-2 py-1"
              value={form.defaultVehicleId}
              onChange={(e) =>
                setForm({
                  ...form,
                  defaultVehicleId:
                    e.target.value === "" ? "" : Number(e.target.value),
                })
              }
            >
              <option value="">—</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.type}
                </option>
              ))}
            </select>
          </>
        ) : (
          <div className="text-sm">
            {r.defaultVehicle
              ? `${r.defaultVehicle.name} · ${r.defaultVehicle.type}`
              : "—"}
          </div>
        )}
      </div>
      <div className="col-span-2 flex items-center justify-end gap-2">
        {edit ? (
          <>
            <f.Form method="post">
              <input type="hidden" name="intent" value="update" />
              <input type="hidden" name="id" value={r.id} />
              {Object.entries(form).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={String(v ?? "")} />
              ))}
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
              <input type="hidden" name="id" value={r.id} />
              <button
                className="rounded-md border px-3 py-1 text-sm"
                type="submit"
              >
                {r.active ? "Disable" : "Enable"}
              </button>
            </f.Form>
            <f.Form
              method="post"
              onSubmit={(e) => {
                if (!confirm(`Delete "${r.lastName}, ${r.firstName}"?`))
                  e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="id" value={r.id} />
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
