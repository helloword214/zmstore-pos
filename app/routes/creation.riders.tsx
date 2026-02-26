/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { EmployeeRole } from "@prisma/client";
import { Form, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import * as React from "react";
import { SoTActionBar } from "~/components/ui/SoTActionBar";
import { SoTAlert } from "~/components/ui/SoTAlert";
import { SoTButton } from "~/components/ui/SoTButton";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTFormField } from "~/components/ui/SoTFormField";
import { SoTInput } from "~/components/ui/SoTInput";
import { SoTNonDashboardHeader } from "~/components/ui/SoTNonDashboardHeader";
import { SoTSectionHeader } from "~/components/ui/SoTSectionHeader";
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

type StatusFilter = "all" | "active" | "inactive";

type RiderRow = {
  id: number;
  firstName: string;
  lastName: string;
  alias: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  defaultVehicle: { id: number; name: string; type: string } | null;
};

type ActionData =
  | { ok: true; action?: string; id?: number }
  | { ok: false; message: string };

function parseStatus(value: string | null): StatusFilter {
  if (value === "active" || value === "inactive") return value;
  return "all";
}

function parsePage(value: string | null) {
  const parsed = Number(value ?? "1");
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["ADMIN"]);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const status = parseStatus(url.searchParams.get("status"));
  const requestedPage = parsePage(url.searchParams.get("page"));

  const where: any = { role: EmployeeRole.RIDER };

  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { alias: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }
  if (status === "active") where.active = true;
  if (status === "inactive") where.active = false;

  const total = await db.employee.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const [riders, vehicles] = await Promise.all([
    db.employee.findMany({
      where,
      orderBy: [{ active: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
      include: {
        defaultVehicle: { select: { id: true, name: true, type: true } },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.vehicle.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
  ]);

  return json({
    riders: riders as RiderRow[],
    vehicles,
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
      const firstName = String(fd.get("firstName") || "").trim();
      const lastName = String(fd.get("lastName") || "").trim();
      const alias = String(fd.get("alias") || "").trim() || null;
      const phone = String(fd.get("phone") || "").trim() || null;
      const email = String(fd.get("email") || "").trim() || null;
      const defaultVehicleRaw = String(fd.get("defaultVehicleId") || "").trim();
      const defaultVehicleId = defaultVehicleRaw ? Number(defaultVehicleRaw) : null;

      if (!firstName || !lastName || !phone) {
        throw new Error("First name, last name, and phone are required.");
      }

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

      return json<ActionData>({ ok: true, action: "create" });
    }

    if (intent === "update") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id)) throw new Error("Invalid rider id.");

      const firstName = String(fd.get("firstName") || "").trim();
      const lastName = String(fd.get("lastName") || "").trim();
      const alias = String(fd.get("alias") || "").trim() || null;
      const phone = String(fd.get("phone") || "").trim() || null;
      const email = String(fd.get("email") || "").trim() || null;
      const defaultVehicleRaw = String(fd.get("defaultVehicleId") || "").trim();
      const defaultVehicleId = defaultVehicleRaw ? Number(defaultVehicleRaw) : null;

      if (!firstName || !lastName || !phone) {
        throw new Error("First name, last name, and phone are required.");
      }

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

      return json<ActionData>({ ok: true, action: "update", id });
    }

    if (intent === "toggle") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id)) throw new Error("Invalid rider id.");

      const current = await db.employee.findUnique({ where: { id } });
      if (!current) throw new Error("Rider not found.");

      await db.employee.update({
        where: { id },
        data: { active: !current.active },
      });

      return json<ActionData>({ ok: true, action: "toggle", id });
    }

    if (intent === "delete") {
      const id = Number(fd.get("id"));
      if (!Number.isFinite(id)) throw new Error("Invalid rider id.");

      try {
        await db.employee.delete({ where: { id } });
        return json<ActionData>({ ok: true, action: "delete", id });
      } catch {
        return json<ActionData>(
          { ok: false, message: "Cannot delete. Rider is referenced by other records." },
          { status: 400 }
        );
      }
    }

    return json<ActionData>(
      { ok: false, message: "Unknown intent." },
      { status: 400 }
    );
  } catch (e: any) {
    return json<ActionData>(
      { ok: false, message: e?.message ?? "Operation failed." },
      { status: 500 }
    );
  }
}

export default function RidersPage() {
  const { riders, vehicles, q, status, page, pageSize, total, totalPages } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = React.useState(false);
  const [createForm, setCreateForm] = React.useState({
    firstName: "",
    lastName: "",
    alias: "",
    phone: "",
    email: "",
    defaultVehicleId: "",
  });

  const [editing, setEditing] = React.useState<RiderRow | null>(null);
  const [editForm, setEditForm] = React.useState({
    firstName: "",
    lastName: "",
    alias: "",
    phone: "",
    email: "",
    defaultVehicleId: "",
  });

  React.useEffect(() => {
    if (!editing) return;
    setEditForm({
      firstName: editing.firstName,
      lastName: editing.lastName,
      alias: editing.alias ?? "",
      phone: editing.phone ?? "",
      email: editing.email ?? "",
      defaultVehicleId: editing.defaultVehicle?.id
        ? String(editing.defaultVehicle.id)
        : "",
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
        title="Creation - Riders"
        subtitle="Scalable rider directory for assignment and dispatch readiness."
        backTo="/"
        backLabel="Dashboard"
        maxWidthClassName="max-w-6xl"
      />

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        <SoTCard interaction="static">
          <SoTActionBar
            left={
              <Form method="get" className="flex flex-wrap items-end gap-2">
                <SoTFormField label="Search">
                  <input
                    name="q"
                    defaultValue={q}
                    placeholder="Search rider"
                    className="h-9 w-56 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  />
                </SoTFormField>
                <SoTFormField label="Status">
                  <select
                    name="status"
                    defaultValue={status}
                    className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </SoTFormField>
                <SoTButton type="submit" variant="secondary" className="h-9">
                  Apply
                </SoTButton>
                <SoTButton
                  type="button"
                  variant="secondary"
                  className="h-9"
                  onClick={() => navigate("/creation/riders")}
                >
                  Reset
                </SoTButton>
              </Form>
            }
            right={
              <SoTButton
                type="button"
                variant="primary"
                onClick={() => setShowCreate((v) => !v)}
              >
                {showCreate ? "Hide Add Form" : "Add Rider"}
              </SoTButton>
            }
          />

          <SoTAlert tone="info">
            Showing {start}-{end} of {total} rider entries.
          </SoTAlert>
        </SoTCard>

        {showCreate ? (
          <SoTCard interaction="form">
            <SoTSectionHeader title="Create Rider" />
            <fetcher.Form method="post" className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <input type="hidden" name="intent" value="create" />

              <div className="md:col-span-3">
                <SoTInput
                  name="firstName"
                  label="First Name"
                  value={createForm.firstName}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, firstName: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-3">
                <SoTInput
                  name="lastName"
                  label="Last Name"
                  value={createForm.lastName}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, lastName: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <SoTInput
                  name="alias"
                  label="Alias"
                  value={createForm.alias}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, alias: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <SoTInput
                  name="phone"
                  label="Phone"
                  value={createForm.phone}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, phone: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <SoTInput
                  name="email"
                  label="Email"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                />
              </div>

              <div className="md:col-span-4">
                <SoTFormField label="Default Vehicle">
                  <select
                    name="defaultVehicleId"
                    value={createForm.defaultVehicleId}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        defaultVehicleId: e.target.value,
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    <option value="">-</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} - {v.type}
                      </option>
                    ))}
                  </select>
                </SoTFormField>
              </div>

              <div className="md:col-span-2 md:flex md:items-end">
                <SoTButton type="submit" variant="primary" className="w-full">
                  Save
                </SoTButton>
              </div>
            </fetcher.Form>
          </SoTCard>
        ) : null}

        {editing ? (
          <SoTCard interaction="form">
            <SoTSectionHeader title={`Edit Rider #${editing.id}`} />
            <fetcher.Form method="post" className="grid grid-cols-1 gap-3 md:grid-cols-12">
              <input type="hidden" name="intent" value="update" />
              <input type="hidden" name="id" value={editing.id} />

              <div className="md:col-span-3">
                <SoTInput
                  name="firstName"
                  label="First Name"
                  value={editForm.firstName}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, firstName: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-3">
                <SoTInput
                  name="lastName"
                  label="Last Name"
                  value={editForm.lastName}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, lastName: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <SoTInput
                  name="alias"
                  label="Alias"
                  value={editForm.alias}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, alias: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <SoTInput
                  name="phone"
                  label="Phone"
                  value={editForm.phone}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, phone: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <SoTInput
                  name="email"
                  label="Email"
                  value={editForm.email}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                />
              </div>

              <div className="md:col-span-4">
                <SoTFormField label="Default Vehicle">
                  <select
                    name="defaultVehicleId"
                    value={editForm.defaultVehicleId}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        defaultVehicleId: e.target.value,
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition-colors duration-150 focus-visible:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-1"
                  >
                    <option value="">-</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} - {v.type}
                      </option>
                    ))}
                  </select>
                </SoTFormField>
              </div>

              <div className="md:col-span-4 flex items-end gap-2">
                <SoTButton type="submit" variant="primary" className="w-full">
                  Update
                </SoTButton>
                <SoTButton
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </SoTButton>
              </div>
            </fetcher.Form>
          </SoTCard>
        ) : null}

        {fetcher.data && !fetcher.data.ok ? (
          <SoTAlert tone="danger">{fetcher.data.message}</SoTAlert>
        ) : null}

        <SoTCard interaction="static" className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Rider Directory
            </h2>
          </div>

          <SoTTable>
            <SoTTableHead>
              <SoTTableRow>
                <SoTTh>Rider</SoTTh>
                <SoTTh>Contact</SoTTh>
                <SoTTh>Default Vehicle</SoTTh>
                <SoTTh>Status</SoTTh>
                <SoTTh align="right">Actions</SoTTh>
              </SoTTableRow>
            </SoTTableHead>
            <tbody>
              {riders.length === 0 ? (
                <SoTTableEmptyRow colSpan={5} message="No riders found." />
              ) : (
                riders.map((r) => (
                  <SoTTableRow key={r.id}>
                    <SoTTd>
                      <div className="font-medium text-slate-900">
                        {r.lastName}, {r.firstName}
                      </div>
                      {r.alias ? <p className="text-xs text-slate-500">Alias: {r.alias}</p> : null}
                    </SoTTd>
                    <SoTTd>
                      <p>{r.phone ?? "-"}</p>
                      <p className="text-xs text-slate-500">{r.email ?? "-"}</p>
                    </SoTTd>
                    <SoTTd>
                      {r.defaultVehicle
                        ? `${r.defaultVehicle.name} - ${r.defaultVehicle.type}`
                        : "-"}
                    </SoTTd>
                    <SoTTd>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {r.active ? "Active" : "Inactive"}
                      </span>
                    </SoTTd>
                    <SoTTd align="right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <SoTButton
                          type="button"
                          variant="secondary"
                          className="h-8 px-2 py-0 text-xs"
                          onClick={() => setEditing(r)}
                        >
                          Edit
                        </SoTButton>

                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="toggle" />
                          <input type="hidden" name="id" value={r.id} />
                          <SoTButton
                            type="submit"
                            variant="secondary"
                            className="h-8 px-2 py-0 text-xs"
                          >
                            {r.active ? "Disable" : "Enable"}
                          </SoTButton>
                        </fetcher.Form>

                        <fetcher.Form
                          method="post"
                          onSubmit={(e) => {
                            if (!confirm(`Delete "${r.lastName}, ${r.firstName}"?`)) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={r.id} />
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

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <SoTButton
                type="button"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => gotoPage(page - 1)}
                className="h-8 px-2 py-0 text-xs"
              >
                Previous
              </SoTButton>
              <SoTButton
                type="button"
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => gotoPage(page + 1)}
                className="h-8 px-2 py-0 text-xs"
              >
                Next
              </SoTButton>
            </div>
          </div>
        </SoTCard>
      </div>
    </main>
  );
}
